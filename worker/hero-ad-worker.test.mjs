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

test("requires server-only Supabase credentials without exposing values", () => {
  assert.throws(() => validateWorkerEnvironment({}), /SUPABASE_URL_required/);
  assert.throws(
    () => validateWorkerEnvironment({ SUPABASE_URL: "https://example.supabase.co" }),
    /SUPABASE_SERVICE_ROLE_KEY_required/,
  );
  const config = validateWorkerEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "not-logged",
  });
  assert.equal(config.generatorBaseUrl, "https://cherry-river-ai.vercel.app");
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
    supabase: {},
    workerId: "lift-local",
    generatorBaseUrl: "https://cherry-river-ai.vercel.app",
    env: {},
    claimJobImpl: async () => job,
    makeTempDir: async () => "C:/temp/hero-ad-test",
    removeTempDir: async (directory) => events.push(["cleanup", directory]),
    renderImpl: async (input) => {
      events.push(["render", input.image, input.format]);
      return { vertical: "vertical.mp4", horizontal: "horizontal.mp4" };
    },
    uploadImpl: async (_supabase, jobId, outputs) => {
      events.push(["upload", jobId, outputs]);
      return {
        vertical: "https://storage.example/vertical.mp4",
        horizontal: "https://storage.example/horizontal.mp4",
      };
    },
    markReadyImpl: async (_supabase, claimedJob, outputUrls) => {
      events.push(["ready", claimedJob.id, outputUrls]);
      return { id: claimedJob.id, status: "READY_FOR_REVIEW", output_urls: outputUrls };
    },
    notifyImpl: async (_supabase, claimedJob) => events.push(["notify", claimedJob.id]),
    markFailedImpl: async () => assert.fail("successful job must not be marked failed"),
  });

  assert.equal(result.processed, true);
  assert.equal(result.job.status, "READY_FOR_REVIEW");
  assert.deepEqual(events.map(([event]) => event), ["render", "upload", "ready", "notify", "cleanup"]);
  assert.deepEqual(events[0], ["render", inventoryImage, "both"]);
});

test("marks a claimed job failed once and cleans its isolated render directory", async () => {
  const events = [];
  const failure = new Error("render failed safely");
  await assert.rejects(
    processOneJob({
      supabase: {},
      workerId: "lift-local",
      generatorBaseUrl: "https://cherry-river-ai.vercel.app",
      env: {},
      claimJobImpl: async () => ({
        id: "00000000-0000-4000-8000-000000000002",
        product_id: "1776357908660",
        format: "vertical",
        worker_id: "lift-local",
        input_props: { productImage: inventoryImage, brandName: "CHERRY RIVER" },
      }),
      makeTempDir: async () => "C:/temp/hero-ad-failure-test",
      removeTempDir: async () => events.push("cleanup"),
      renderImpl: async () => { throw failure; },
      uploadImpl: async () => assert.fail("failed render must not upload"),
      markReadyImpl: async () => assert.fail("failed render must not become ready"),
      notifyImpl: async () => assert.fail("failed render must not notify review"),
      markFailedImpl: async (_supabase, job, error) => {
        assert.equal(job.id, "00000000-0000-4000-8000-000000000002");
        assert.equal(error, failure);
        events.push("failed");
      },
    }),
    /render failed safely/,
  );
  assert.deepEqual(events, ["failed", "cleanup"]);
});
