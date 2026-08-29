import { timingSafeEqual } from "crypto";

const VIDEO_BUCKET = "videos";
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

export function requireHeroAdWorkerToken(expectedToken) {
  return function authorizeWorker(req, res, next) {
    if (!expectedToken || !safeEqual(req.get("x-hero-ad-worker-token"), expectedToken)) {
      return res.status(401).json({ error: "worker_unauthorized" });
    }
    return next();
  };
}

export function createHeroAdWorkerHandlers({ supabase }) {
  return {
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
            .from(VIDEO_BUCKET)
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
            .from(VIDEO_BUCKET).list(folder, { limit: 10, search: `${format}.mp4` });
          if (listError || !objects?.some((object) => object.name === `${format}.mp4`)) {
            return res.status(409).json({ error: `output_missing:${format}` });
          }
          outputUrls[format] = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
        }
        const primary = outputUrls.vertical || outputUrls.horizontal;
        const { data: ready, error: readyError } = await supabase
          .from("mkt_ad_jobs")
          .update({ status: "READY_FOR_REVIEW", output_url: primary, output_urls: outputUrls, error_msg: null })
          .eq("id", job.id).eq("status", "RENDERING").eq("worker_id", workerId)
          .select("id,status,output_url,output_urls").single();
        if (readyError) throw new Error(`ready_update_failed:${readyError.message}`);
        const { error: handoffError } = await supabase.from("mkt_agent_handoffs").insert({
          from_agent: "hero-ad-worker", to_agent: "francis",
          topic: "MediaOS Hero Ad prêt à réviser", status: "pending",
          payload: { job_id: job.id, product_id: job.product_id, status: "READY_FOR_REVIEW", output_urls: outputUrls, publication_performed: false },
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

export { canonicalObjectPath, expectedFormats, safeEqual };
