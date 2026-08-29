import {createHash} from 'node:crypto';
import process from 'node:process';
import {createClient} from '@supabase/supabase-js';
import dotenv from 'dotenv';

const EXPECTED_PROJECT_REF = 'bypedtyxtnmmdsyrgwpj';
const PRIVATE_BUCKET = 'hero-ad-drafts';
const PUBLIC_BUCKET = 'videos';
const JOBS = Object.freeze({
  'ff01fc74-6c3c-4ea8-a2fd-904fc2a72223': ['vertical', 'horizontal'],
  '8753b83f-9983-4471-9f3b-220a6817447a': ['vertical'],
});

const mode = process.env.HERO_AD_MIGRATION_MODE ?? process.argv[2] ?? '--dry-run';
const allowedModes = new Set(['--dry-run', '--copy-private', '--verify-private', '--delete-public']);
if (!allowedModes.has(mode)) {
  throw new Error(`Unsupported mode: ${mode}`);
}

dotenv.config({path: process.env.HERO_AD_ENV_FILE ?? '.vercel/.env.production.local'});
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== EXPECTED_PROJECT_REF) {
  throw new Error(`Refusing project ${projectRef}; expected ${EXPECTED_PROJECT_REF}`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {persistSession: false, autoRefreshToken: false},
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const objectPath = (jobId, format) => `hero-ads/${jobId}/${format}.mp4`;

async function download(bucket, path) {
  const {data, error} = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`download ${bucket}/${path}: ${error.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return {bytes, sha256: sha256(bytes), size: bytes.length};
}

async function inspectJobs() {
  const ids = Object.keys(JOBS);
  const {data, error} = await supabase
    .from('mkt_ad_jobs')
    .select('id,format,status,output_bucket,output_url,output_urls')
    .in('id', ids)
    .order('created_at');
  if (error) throw new Error(`inspect jobs: ${error.message}`);
  if (data.length !== ids.length) throw new Error(`Expected ${ids.length} jobs, found ${data.length}`);
  for (const job of data) {
    if (job.status !== 'READY_FOR_REVIEW') throw new Error(`Job ${job.id} is ${job.status}`);
    if (job.format === 'both' ? JOBS[job.id].length !== 2 : JOBS[job.id].length !== 1) {
      throw new Error(`Unexpected format contract for ${job.id}`);
    }
  }
  return data;
}

async function copyPrivate() {
  const copied = [];
  try {
    for (const [jobId, formats] of Object.entries(JOBS)) {
      for (const format of formats) {
        const path = objectPath(jobId, format);
        const source = await download(PUBLIC_BUCKET, path);
        const {error} = await supabase.storage.from(PRIVATE_BUCKET).upload(path, source.bytes, {
          contentType: 'video/mp4',
          cacheControl: '3600',
          upsert: false,
        });
        if (error && !/already exists/i.test(error.message)) {
          throw new Error(`upload ${PRIVATE_BUCKET}/${path}: ${error.message}`);
        }
        if (!error) copied.push(path);
        const target = await download(PRIVATE_BUCKET, path);
        if (target.sha256 !== source.sha256 || target.size !== source.size) {
          throw new Error(`Hash mismatch for ${path}`);
        }
        console.log(JSON.stringify({path, size: source.size, sha256: source.sha256, verified: true}));
      }
    }
  } catch (error) {
    if (copied.length > 0) await supabase.storage.from(PRIVATE_BUCKET).remove(copied);
    throw error;
  }
}

async function verifyPrivate() {
  for (const [jobId, formats] of Object.entries(JOBS)) {
    for (const format of formats) {
      const path = objectPath(jobId, format);
      const source = await download(PUBLIC_BUCKET, path);
      const target = await download(PRIVATE_BUCKET, path);
      if (target.sha256 !== source.sha256 || target.size !== source.size) {
        throw new Error(`Hash mismatch for ${path}`);
      }
      const {data, error} = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 120);
      if (error || !data?.signedUrl) throw new Error(`Signed URL failed for ${path}`);
      const response = await fetch(data.signedUrl, {redirect: 'error'});
      if (!response.ok) throw new Error(`Signed download failed for ${path}: ${response.status}`);
      const signedBytes = Buffer.from(await response.arrayBuffer());
      if (sha256(signedBytes) !== source.sha256) throw new Error(`Signed hash mismatch for ${path}`);
      console.log(JSON.stringify({path, size: source.size, sha256: source.sha256, signed_review: true}));
    }
  }
}

async function deletePublic() {
  const jobs = await inspectJobs();
  for (const job of jobs) {
    if (job.output_bucket !== PRIVATE_BUCKET) throw new Error(`Job ${job.id} is not migrated`);
  }
  await verifyPrivate();
  const paths = Object.entries(JOBS).flatMap(([jobId, formats]) => formats.map((format) => objectPath(jobId, format)));
  const {error} = await supabase.storage.from(PUBLIC_BUCKET).remove(paths);
  if (error) throw new Error(`delete public: ${error.message}`);
  console.log(JSON.stringify({deleted_public_objects: paths.length}));
}

await inspectJobs();
if (mode === '--copy-private') await copyPrivate();
if (mode === '--verify-private') await verifyPrivate();
if (mode === '--delete-public') await deletePublic();
console.log(JSON.stringify({mode, project_ref: projectRef, jobs: Object.keys(JOBS).length, status: 'PASS'}));
