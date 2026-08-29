import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkerArgs,
  pollBackgroundVideo,
  processOneJob,
  validateWorkerEnvironment,
} from "./hero-ad-worker.mjs";

const inventoryImage = "https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/product-images/product-1776357908660.jpg";

test("parses one-shot worker options", () => {
  const options = parseWorkerArgs(["--once", "--worker-id=lift-local", "--poll-ms=2500"]);
  assert.deepEqual(options, { once: true, workerId: "lift-local", pollMs: 2500 });
});

test("requires only the scoped worker token and never a service-role key", () => {
  assert.throws(() => validateWorkerEnvironment({}), /HERO_AD_WORKER_TOKEN_required/);
  const config = validateWorkerEnvironment({ HERO_AD_WORKER_TOKEN: "not-logged" });
  assert.equal(config.generatorBaseUrl, "https://cherry-river-content-ai-generator.vercel.app/");
  assert.equal(config.workerToken, "not-logged");
});

test("polls a bounded background task and follows one provider retry", async () => {
  const calls = [];
  const replies = [
    { status: "retrying", taskId: "task-2" },
    { status: "succeeded", videoUrl: "https://videos.example.test/background.mp4" },
  ];
  const videoUrl = await pollBackgroundVideo({
    taskId: "task-1",
    baseUrl: "https://cherry-river-ai.vercel.app",
    intervalMs: 1,
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => replies.shift() };
    },
  });
  assert.equal(videoUrl, "https://videos.example.test/background.mp4");
  assert.match(calls[0], /task-1$/);
  assert.match(calls[1], /task-2$/);
});

test("fails closed when the background provider fails", async () => {
  await assert.rejects(
    pollBackgroundVideo({
      taskId: "task-1",
      baseUrl: "https://cherry-river-ai.vercel.app",
      intervalMs: 1,
      timeoutMs: 100,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ status: "failed", error: "provider rejected" }),
      }),
    }),
    /background_generation_failed/,
  );
});

test("processes one claimed job through render, upload, review, and notification only", async () => {
  const events = [];
  const job = {
    id: "00000000-0000-4000-8000-000000000001",
    product_id: "1776357908660",
    format: "both",
    worker_id: "lift-local",
    input_props: {
      productImage: inventoryImage,
      brandName: "CHERRY RIVER",
      kicker: "LE GOÛT DU QUÉBEC",
      tagline: "Pamplemousse rose",
      accent: "#FF1B8D",
    },
  };
  const result = await processOneJob({
    workerId: "lift-local",
    config: { generatorBaseUrl: "https://generator.example/", workerToken: "secret" },
    env: {},
    claimImpl: async () => ({
      job,
      uploads: {
        vertical: { path: `hero-ads/${job.id}/vertical.mp4`, signedUrl: "https://upload.example/vertical" },
        horizontal: { path: `hero-ads/${job.id}/horizontal.mp4`, signedUrl: "https://upload.example/horizontal" },
      },
    }),
    makeTempDir: async () => "C:/temp/hero-ad-test",
    removeTempDir: async (directory) => events.push(["cleanup", directory]),
    renderImpl: async (input) => {
      events.push(["render", input.image, input.format]);
      return { vertical: "vertical.mp4", horizontal: "horizontal.mp4" };
    },
    uploadImpl: async ({ outputs }) => {
      events.push(["upload", job.id, outputs]);
      return {
        vertical: { path: `hero-ads/${job.id}/vertical.mp4` },
        horizontal: { path: `hero-ads/${job.id}/horizontal.mp4` },
      };
    },
    requestImpl: async ({ pathName, body }) => {
      events.push(["complete", pathName, body]);
      return { id: job.id, status: "READY_FOR_REVIEW", output_urls: body.outputs };
    },
  });

  assert.equal(result.processed, true);
  assert.equal(result.job.status, "READY_FOR_REVIEW");
  assert.deepEqual(events.map(([event]) => event), ["render", "upload", "complete", "cleanup"]);
  assert.deepEqual(events[0], ["render", inventoryImage, "both"]);
});

test("marks a claimed job failed once and cleans its isolated render directory", async () => {
  const events = [];
  const failure = new Error("render failed safely");
  await assert.rejects(
    processOneJob({
      workerId: "lift-local",
      config: { generatorBaseUrl: "https://generator.example/", workerToken: "secret" },
      env: {},
      claimImpl: async () => ({ job: {
          id: "00000000-0000-4000-8000-000000000002",
          product_id: "1776357908660", format: "vertical", worker_id: "lift-local",
          input_props: { productImage: inventoryImage, brandName: "CHERRY RIVER" },
        }, uploads: {} }),
      makeTempDir: async () => "C:/temp/hero-ad-failure-test",
      removeTempDir: async () => events.push("cleanup"),
      renderImpl: async () => { throw failure; },
      uploadImpl: async () => assert.fail("failed render must not upload"),
      requestImpl: async ({ pathName, body }) => {
        assert.equal(pathName, "/api/hero-ad-worker/fail");
        assert.equal(body.jobId, "00000000-0000-4000-8000-000000000002");
        assert.match(body.error, /render failed safely/);
        events.push("failed");
      },
    }),
    /render failed safely/,
  );
  assert.deepEqual(events, ["failed", "cleanup"]);
});
