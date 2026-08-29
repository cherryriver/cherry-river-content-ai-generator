/**
 * Trusted LOCAL worker for MediaOS Hero Ads.
 * The worker token can only claim/complete/fail Hero Ad jobs. The Supabase
 * service-role key remains inside Vercel and is never copied to the lift.
 */
import "dotenv/config";
import path from "path";
import { pathToFileURL } from "url";
import { hostname, tmpdir } from "os";
import { mkdtemp, readFile, rm } from "fs/promises";
import { renderHeroAds, assertInventoryImageUrl } from "../remotion/render-hero.mjs";

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
  if (!env.HERO_AD_WORKER_TOKEN) throw new Error("HERO_AD_WORKER_TOKEN_required");
  const generatorBaseUrl = env.MEDIAOS_AI_BASE_URL || "https://cherry-river-content-ai-generator.vercel.app";
  const endpoint = new URL(generatorBaseUrl);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("MEDIAOS_AI_BASE_URL_must_use_https");
  }
  return { workerToken: env.HERO_AD_WORKER_TOKEN, generatorBaseUrl: endpoint.toString() };
}

export async function workerRequest({ baseUrl, token, pathName, body, fetchImpl = fetch }) {
  const response = await fetchImpl(new URL(pathName, baseUrl), {
    method: "POST",
    redirect: "error",
    headers: { "x-hero-ad-worker-token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathName}:${response.status}:${payload.error || "request_failed"}`);
  return payload;
}

export async function claimRemoteJob({ baseUrl, token, workerId, fetchImpl = fetch }) {
  return workerRequest({ baseUrl, token, pathName: "/api/hero-ad-worker/claim", body: { workerId }, fetchImpl });
}

export async function uploadSignedOutputs({ uploads, outputs, fetchImpl = fetch }) {
  const uploaded = {};
  for (const [format, filePath] of Object.entries(outputs)) {
    const target = uploads?.[format];
    if (!target?.signedUrl || !target?.path) throw new Error(`signed_upload_missing:${format}`);
    const response = await fetchImpl(target.signedUrl, {
      method: "PUT", redirect: "error",
      headers: { "Content-Type": "video/mp4", "x-upsert": "false" },
      body: await readFile(filePath),
    });
    if (!response.ok) throw new Error(`signed_upload_failed:${format}:${response.status}`);
    uploaded[format] = { path: target.path };
  }
  return uploaded;
}

export async function pollBackgroundVideo({ taskId, baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_BACKGROUND_TIMEOUT_MS, intervalMs = 10000 }) {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") throw new Error("MEDIAOS_AI_BASE_URL_must_use_https");
  let currentTaskId = taskId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchImpl(new URL(`/api/video-status/${encodeURIComponent(currentTaskId)}`, endpoint), { redirect: "error" });
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

export async function processOneJob({
  workerId, config, env = process.env,
  claimImpl = claimRemoteJob, uploadImpl = uploadSignedOutputs, requestImpl = workerRequest,
  pollBackgroundImpl = pollBackgroundVideo, renderImpl = renderHeroAds,
  makeTempDir = (prefix) => mkdtemp(prefix),
  removeTempDir = (directory) => rm(directory, { recursive: true, force: true }),
}) {
  const claimed = await claimImpl({ baseUrl: config.generatorBaseUrl, token: config.workerToken, workerId });
  if (!claimed?.job) return { processed: false };
  const { job, uploads } = claimed;
  const renderDir = await makeTempDir(path.join(tmpdir(), `mediaos-hero-${job.id}-`));
  try {
    const props = job.input_props || {};
    assertInventoryImageUrl(props.productImage, env);
    const backgroundVideo = props.backgroundVideo || (props.backgroundTaskId
      ? await pollBackgroundImpl({ taskId: props.backgroundTaskId, baseUrl: config.generatorBaseUrl }) : null);
    const outputs = await renderImpl({
      image: props.productImage, brand: props.brandName, kicker: props.kicker,
      tagline: props.tagline, accent: props.accent, backgroundVideo,
      format: job.format, outDir: renderDir, fileStem: job.id, env,
    });
    const uploaded = await uploadImpl({ uploads, outputs });
    const ready = await requestImpl({
      baseUrl: config.generatorBaseUrl, token: config.workerToken,
      pathName: "/api/hero-ad-worker/complete",
      body: { jobId: job.id, workerId, outputs: uploaded },
    });
    return { processed: true, job: ready };
  } catch (error) {
    await requestImpl({
      baseUrl: config.generatorBaseUrl, token: config.workerToken,
      pathName: "/api/hero-ad-worker/fail",
      body: { jobId: job.id, workerId, error: String(error.message || error).slice(0, 1000) },
    }).catch(() => {});
    throw error;
  } finally {
    await removeTempDir(renderDir);
  }
}

export async function runWorker({ once, workerId, pollMs }, env = process.env) {
  const config = validateWorkerEnvironment(env);
  do {
    const result = await processOneJob({ workerId, config, env });
    if (once) return result;
    if (!result.processed) await sleep(pollMs);
  } while (true);
}

async function main() {
  const result = await runWorker(parseWorkerArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ processed: result.processed, jobId: result.job?.id || null, status: result.job?.status || null }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Hero Ad worker failed: ${error.message}`); process.exitCode = 1; });
}
