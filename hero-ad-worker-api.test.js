import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalObjectPath,
  createHeroAdWorkerHandlers,
  expectedFormats,
  HERO_AD_DRAFT_BUCKET,
  requireHeroAdWorkerToken,
  storageObjectRef,
} from "./hero-ad-worker-api.js";

function response() {
  return {
    statusCode: 200, payload: null, ended: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

test("worker token middleware fails closed and uses constant-size comparison", () => {
  const middleware = requireHeroAdWorkerToken("correct-token");
  const denied = response();
  middleware({ get: () => "wrong-token" }, denied, () => assert.fail("must not continue"));
  assert.equal(denied.statusCode, 401);
  let continued = false;
  middleware({ get: () => "correct-token" }, response(), () => { continued = true; });
  assert.equal(continued, true);
});

test("claim returns only canonical signed upload targets for the job", async () => {
  const job = { id: "00000000-0000-4000-8000-000000000001", format: "both" };
  const supabase = {
    rpc: async () => ({ data: [job], error: null }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path) => ({ data: { signedUrl: `https://upload.example/${path}` }, error: null }),
      }),
    },
  };
  const handler = createHeroAdWorkerHandlers({ supabase }).claim;
  const res = response();
  await handler({ body: { workerId: "dell-hero-worker" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.payload.uploads), ["vertical", "horizontal"]);
  assert.equal(res.payload.uploads.vertical.path, `hero-ads/${job.id}/vertical.mp4`);
  assert.equal(res.payload.uploads.horizontal.path, `hero-ads/${job.id}/horizontal.mp4`);
  assert.equal(HERO_AD_DRAFT_BUCKET, "hero-ad-drafts");
});

test("format and object-path contracts are deterministic", () => {
  assert.deepEqual(expectedFormats("both"), ["vertical", "horizontal"]);
  assert.deepEqual(expectedFormats("vertical"), ["vertical"]);
  assert.throws(() => expectedFormats("square"), /job_format_invalid/);
  assert.equal(
    canonicalObjectPath("00000000-0000-4000-8000-000000000001", "vertical"),
    "hero-ads/00000000-0000-4000-8000-000000000001/vertical.mp4",
  );
  assert.equal(
    storageObjectRef("hero-ad-drafts", "hero-ads/job/vertical.mp4"),
    "storage://hero-ad-drafts/hero-ads/job/vertical.mp4",
  );
});
