import { createHash, timingSafeEqual } from "crypto";

const HERO_AD_DRAFT_BUCKET = "hero-ad-drafts";
const LEGACY_HERO_AD_BUCKET = "videos";
const LEGACY_HERO_AD_JOBS_RC2 = Object.freeze({
  "ff01fc74-6c3c-4ea8-a2fd-904fc2a72223": ["vertical", "horizontal"],
  "8753b83f-9983-4471-9f3b-220a6817447a": ["vertical"],
});
const FORMATS = new Set(["vertical", "horizontal"]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function bounded(value, field, maxLength = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error(`${field}_invalid`);
  return text;
}

function expectedFormats(format) {
  if (format === "both") return ["vertical", "horizontal"];
  if (!FORMATS.has(format)) throw new Error("job_format_invalid");
  return [format];
}

function canonicalObjectPath(jobId, format) {
  return `hero-ads/${jobId}/${format}.mp4`;
}

function storageObjectRef(bucket, objectPath) {
  return `storage://${bucket}/${objectPath}`;
}

async function downloadStorageObject(supabase, bucket, path, { required = true } = {}) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    if (!required) return null;
    throw new Error(`storage_download_failed:${bucket}/${path}`);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  return {
    bytes,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function migrateLegacyHeroAdDraftsRc2({
  supabase,
  privateBucket = HERO_AD_DRAFT_BUCKET,
  publicBucket = LEGACY_HERO_AD_BUCKET,
}) {
  const jobIds = Object.keys(LEGACY_HERO_AD_JOBS_RC2);
  const { data: jobs, error: jobsError } = await supabase
    .from("mkt_ad_jobs")
    .select("id,format,status,output_bucket,output_url,output_urls")
    .in("id", jobIds);
  if (jobsError || jobs?.length !== jobIds.length) throw new Error("legacy_jobs_not_found");
  if (jobs.some((job) => job.status !== "READY_FOR_REVIEW")) throw new Error("legacy_job_state_invalid");

  const evidence = [];
  for (const [jobId, formats] of Object.entries(LEGACY_HERO_AD_JOBS_RC2)) {
    for (const format of formats) {
      const path = canonicalObjectPath(jobId, format);
      const source = await downloadStorageObject(supabase, publicBucket, path, { required: false });
      let target = await downloadStorageObject(supabase, privateBucket, path, { required: false });
      if (!target) {
        if (!source) throw new Error(`legacy_source_and_target_missing:${path}`);
        const { error: uploadError } = await supabase.storage.from(privateBucket).upload(path, source.bytes, {
          contentType: "video/mp4",
          cacheControl: "3600",
          upsert: false,
        });
        if (uploadError) throw new Error(`private_upload_failed:${path}`);
        target = await downloadStorageObject(supabase, privateBucket, path);
      }
      if (source && (source.sha256 !== target.sha256 || source.size !== target.size)) {
        throw new Error(`private_copy_mismatch:${path}`);
      }
      evidence.push({ path, size: target.size, sha256: target.sha256, hadPublicSource: Boolean(source) });
    }
  }

  for (const job of jobs) {
    const formats = LEGACY_HERO_AD_JOBS_RC2[job.id];
    const outputUrls = Object.fromEntries(formats.map((format) => {
      const path = canonicalObjectPath(job.id, format);
      return [format, storageObjectRef(privateBucket, path)];
    }));
    const primary = outputUrls.vertical || outputUrls.horizontal;
    const { error: updateError } = await supabase.from("mkt_ad_jobs").update({
      output_bucket: privateBucket,
      output_url: primary,
      output_urls: outputUrls,
    }).eq("id", job.id).eq("status", "READY_FOR_REVIEW");
    if (updateError) throw new Error(`legacy_job_update_failed:${job.id}`);
  }

  const publicPaths = evidence.filter((item) => item.hadPublicSource).map((item) => item.path);
  if (publicPaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(publicBucket).remove(publicPaths);
    if (removeError) throw new Error("legacy_public_delete_failed");
  }
  return { jobs: jobIds.length, objects: evidence.length, evidence };
}

export function requireHeroAdWorkerToken(expectedToken) {
  return function authorizeWorker(req, res, next) {
    if (!expectedToken || !safeEqual(req.get("x-hero-ad-worker-token"), expectedToken)) {
      return res.status(401).json({ error: "worker_unauthorized" });
    }
    return next();
  };
}

export function createHeroAdWorkerHandlers({ supabase, bucket = HERO_AD_DRAFT_BUCKET }) {
  return {
    migratePrivateDraftsRc2: async (_req, res) => {
      try {
        const result = await migrateLegacyHeroAdDraftsRc2({ supabase, privateBucket: bucket });
        return res.status(200).json({ status: "MIGRATED_PRIVATE_RC2", ...result });
      } catch (error) {
        console.error(`Hero Ad private migration failed: ${error.message}`);
        return res.status(500).json({ error: "hero_ad_private_migration_failed" });
      }
    },

    claim: async (req, res) => {
      try {
        const workerId = bounded(req.body?.workerId, "worker_id");
        const { data, error } = await supabase.rpc("mkt_claim_ad_job", { p_worker_id: workerId });
        if (error) throw new Error(`claim_failed:${error.message}`);
        const job = Array.isArray(data) ? data[0] || null : data || null;
        if (!job) return res.status(204).end();
        const uploads = {};
        for (const format of expectedFormats(job.format)) {
          const objectPath = canonicalObjectPath(job.id, format);
          const { data: signed, error: signedError } = await supabase.storage
            .from(bucket)
            .createSignedUploadUrl(objectPath, { upsert: false });
          if (signedError || !signed?.signedUrl) throw new Error("signed_upload_failed");
          uploads[format] = { path: objectPath, signedUrl: signed.signedUrl };
        }
        return res.status(200).json({ job, uploads });
      } catch (error) {
        console.error(`Hero Ad worker claim failed: ${error.message}`);
        return res.status(500).json({ error: "worker_claim_failed" });
      }
    },

    complete: async (req, res) => {
      try {
        const jobId = bounded(req.body?.jobId, "job_id", 80);
        const workerId = bounded(req.body?.workerId, "worker_id");
        const { data: job, error: jobError } = await supabase
          .from("mkt_ad_jobs")
          .select("id,product_id,format,status,worker_id")
          .eq("id", jobId).eq("status", "RENDERING").eq("worker_id", workerId).single();
        if (jobError || !job) return res.status(409).json({ error: "job_not_rendering_for_worker" });
        const outputUrls = {};
        for (const format of expectedFormats(job.format)) {
          const objectPath = canonicalObjectPath(job.id, format);
          if (req.body?.outputs?.[format]?.path !== objectPath) {
            return res.status(400).json({ error: `output_path_invalid:${format}` });
          }
          const folder = `hero-ads/${job.id}`;
          const { data: objects, error: listError } = await supabase.storage
            .from(bucket).list(folder, { limit: 10, search: `${format}.mp4` });
          if (listError || !objects?.some((object) => object.name === `${format}.mp4`)) {
            return res.status(409).json({ error: `output_missing:${format}` });
          }
          outputUrls[format] = storageObjectRef(bucket, objectPath);
        }
        const primary = outputUrls.vertical || outputUrls.horizontal;
        const { data: ready, error: readyError } = await supabase
          .from("mkt_ad_jobs")
          .update({
            status: "READY_FOR_REVIEW",
            output_bucket: bucket,
            output_url: primary,
            output_urls: outputUrls,
            error_msg: null,
          })
          .eq("id", job.id).eq("status", "RENDERING").eq("worker_id", workerId)
          .select("id,status,output_url,output_urls").single();
        if (readyError) throw new Error(`ready_update_failed:${readyError.message}`);
        const { error: handoffError } = await supabase.from("mkt_agent_handoffs").insert({
          from_agent: "hero-ad-worker", to_agent: "francis",
          topic: "MediaOS Hero Ad prêt à réviser", status: "pending",
          payload: {
            job_id: job.id,
            product_id: job.product_id,
            status: "READY_FOR_REVIEW",
            output_bucket: bucket,
            output_objects: outputUrls,
            review_route: `/api/ad-jobs/${job.id}/review-urls`,
            publication_performed: false,
          },
        });
        if (handoffError) console.warn(`Hero Ad review handoff failed: ${handoffError.message}`);
        return res.status(200).json(ready);
      } catch (error) {
        console.error(`Hero Ad worker completion failed: ${error.message}`);
        return res.status(500).json({ error: "worker_completion_failed" });
      }
    },

    fail: async (req, res) => {
      try {
        const jobId = bounded(req.body?.jobId, "job_id", 80);
        const workerId = bounded(req.body?.workerId, "worker_id");
        const message = bounded(req.body?.error, "error", 1000);
        const { data, error } = await supabase.from("mkt_ad_jobs")
          .update({ status: "FAILED", error_msg: message })
          .eq("id", jobId).eq("status", "RENDERING").eq("worker_id", workerId)
          .select("id,status").single();
        if (error) throw new Error(`failed_update_failed:${error.message}`);
        return res.status(200).json(data);
      } catch (error) {
        console.error(`Hero Ad worker failure update failed: ${error.message}`);
        return res.status(500).json({ error: "worker_failure_update_failed" });
      }
    },
  };
}

export {
  HERO_AD_DRAFT_BUCKET,
  LEGACY_HERO_AD_JOBS_RC2,
  canonicalObjectPath,
  expectedFormats,
  safeEqual,
  storageObjectRef,
};
