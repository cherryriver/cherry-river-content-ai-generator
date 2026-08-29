/**
 * Trusted LOCAL worker for MediaOS Hero Ads.
 * Claims one QUEUED job atomically, renders with Remotion, uploads to Supabase,
 * then stops at READY_FOR_REVIEW. It never publishes content.
 */
import "dotenv/config";
import path from "path";
import { pathToFileURL } from "url";
import { hostname } from "os";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { createClient } from "@supabase/supabase-js";
import { renderHeroAds, assertInventoryImageUrl } from "../remotion/render-hero.mjs";

const VIDEO_BUCKET = "videos";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 15 * 60 * 1000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseWorkerArgs(argv) {
  const args = Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || true];
  }));
  return {
    once: args.once === true || args.once === "true",
    workerId: String(args["worker-id"] || `${hostname()}-hero-ad-worker`),
    pollMs: Math.max(1000, Number(args["poll-ms"] || DEFAULT_POLL_MS)),
  };
}

export function validateWorkerEnvironment(env = process.env) {
  if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL_required");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY_required");
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    generatorBaseUrl: env.MEDIAOS_AI_BASE_URL || "https://cherry-river-ai.vercel.app",
  };
}

export async function pollBackgroundVideo({
  taskId,
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_BACKGROUND_TIMEOUT_MS,
  intervalMs = 10000,
}) {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("MEDIAOS_AI_BASE_URL_must_use_https");
  }
  let currentTaskId = taskId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusUrl = new URL(`/api/video-status/${encodeURIComponent(currentTaskId)}`, endpoint);
    const response = await fetchImpl(statusUrl, { redirect: "error" });
    if (!response.ok) throw new Error(`background_status_failed:${response.status}`);
    const payload = await response.json();
    if (payload.status === "succeeded" && payload.videoUrl) {
      const videoUrl = new URL(payload.videoUrl);
      if (videoUrl.protocol !== "https:") throw new Error("background_video_must_use_https");
      return videoUrl.toString();
    }
    if (payload.status === "retrying" && payload.taskId) currentTaskId = payload.taskId;
    if (payload.status === "failed") throw new Error(`background_generation_failed:${payload.error || "unknown"}`);
    await sleep(intervalMs);
  }
  throw new Error("background_generation_timeout");
}

async function claimJob(supabase, workerId) {
  const { data, error } = await supabase.rpc("mkt_claim_ad_job", { p_worker_id: workerId });
  if (error) throw new Error(`claim_failed:${error.message}`);
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function uploadOutputs(supabase, jobId, outputs) {
  const urls = {};
  for (const [format, filePath] of Object.entries(outputs)) {
    const bytes = await readFile(filePath);
    const objectPath = `hero-ads/${jobId}/${format}.mp4`;
    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(objectPath, bytes, { contentType: "video/mp4", upsert: false });
    if (error) throw new Error(`video_upload_failed:${error.message}`);
    const { data: publicData } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(data.path);
    urls[format] = publicData.publicUrl;
  }
  return urls;
}

async function markReady(supabase, job, outputUrls) {
  const primary = outputUrls.vertical || outputUrls.horizontal;
  const { data, error } = await supabase
    .from("mkt_ad_jobs")
    .update({
      status: "READY_FOR_REVIEW",
      output_url: primary,
      output_urls: outputUrls,
      error_msg: null,
    })
    .eq("id", job.id)
    .eq("status", "RENDERING")
    .eq("worker_id", job.worker_id)
    .select("id,status,output_url,output_urls")
    .single();
  if (error) throw new Error(`ready_update_failed:${error.message}`);
  return data;
}

async function markFailed(supabase, job, error) {
  const message = String(error?.message || error || "render_failed").slice(0, 1000);
  await supabase
    .from("mkt_ad_jobs")
    .update({ status: "FAILED", error_msg: message })
    .eq("id", job.id)
    .eq("status", "RENDERING")
    .eq("worker_id", job.worker_id);
}

async function notifyFrancis(supabase, job, outputUrls) {
  const { error } = await supabase.from("mkt_agent_handoffs").insert({
    from_agent: "hero-ad-worker",
    to_agent: "francis",
    topic: "MediaOS Hero Ad prêt à réviser",
    status: "pending",
    payload: {
      job_id: job.id,
      product_id: job.product_id,
      status: "READY_FOR_REVIEW",
      output_urls: outputUrls,
      publication_performed: false,
    },
  });
  if (error) console.warn(`Review handoff not recorded for job ${job.id}: ${error.message}`);
}

export async function processOneJob({
  supabase,
  workerId,
  generatorBaseUrl,
  env = process.env,
  claimJobImpl = claimJob,
  pollBackgroundImpl = pollBackgroundVideo,
  renderImpl = renderHeroAds,
  uploadImpl = uploadOutputs,
  markReadyImpl = markReady,
  markFailedImpl = markFailed,
  notifyImpl = notifyFrancis,
  makeTempDir = (prefix) => mkdtemp(prefix),
  removeTempDir = (directory) => rm(directory, { recursive: true, force: true }),
}) {
  const job = await claimJobImpl(supabase, workerId);
  if (!job) return { processed: false };

  const renderDir = await makeTempDir(path.join(tmpdir(), `mediaos-hero-${job.id}-`));
  try {
    const props = job.input_props || {};
    assertInventoryImageUrl(props.productImage, env);
    const backgroundVideo = props.backgroundVideo || (
      props.backgroundTaskId
        ? await pollBackgroundImpl({ taskId: props.backgroundTaskId, baseUrl: generatorBaseUrl })
        : null
    );
    const outputs = await renderImpl({
      image: props.productImage,
      brand: props.brandName,
      kicker: props.kicker,
      tagline: props.tagline,
      accent: props.accent,
      backgroundVideo,
      format: job.format,
      outDir: renderDir,
      fileStem: job.id,
      env,
    });
    const outputUrls = await uploadImpl(supabase, job.id, outputs);
    const readyJob = await markReadyImpl(supabase, job, outputUrls);
    await notifyImpl(supabase, job, outputUrls);
    return { processed: true, job: readyJob };
  } catch (error) {
    await markFailedImpl(supabase, job, error);
    throw error;
  } finally {
    await removeTempDir(renderDir);
  }
}

export async function runWorker({ once, workerId, pollMs }, env = process.env) {
  const config = validateWorkerEnvironment(env);
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  do {
    const result = await processOneJob({
      supabase,
      workerId,
      generatorBaseUrl: config.generatorBaseUrl,
      env,
    });
    if (once) return result;
    if (!result.processed) await sleep(pollMs);
  } while (true);
}

async function main() {
  const options = parseWorkerArgs(process.argv.slice(2));
  const result = await runWorker(options);
  console.log(JSON.stringify({
    processed: result.processed,
    jobId: result.job?.id || null,
    status: result.job?.status || null,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Hero Ad worker failed: ${error.message}`);
    process.exitCode = 1;
  });
}
