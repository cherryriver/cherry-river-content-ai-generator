import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalObjectPath,
  createHeroAdWorkerHandlers,
  expectedFormats,
  HERO_AD_DRAFT_BUCKET,
  LEGACY_HERO_AD_JOBS_RC2,
  migrateLegacyHeroAdDraftsRc2,
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

test("RC2 migration copies, verifies, rewrites and removes exactly the three public drafts", async () => {
  const jobs = Object.entries(LEGACY_HERO_AD_JOBS_RC2).map(([id, formats]) => ({
    id,
    format: formats.length === 2 ? "both" : formats[0],
    status: "READY_FOR_REVIEW",
    output_bucket: null,
    output_url: "legacy-public-url",
    output_urls: {},
  }));
  const stores = { videos: new Map(), "hero-ad-drafts": new Map() };
  for (const [jobId, formats] of Object.entries(LEGACY_HERO_AD_JOBS_RC2)) {
    for (const format of formats) {
      stores.videos.set(canonicalObjectPath(jobId, format), Buffer.from(`${jobId}:${format}`));
    }
  }
  const supabase = {
    from(table) {
      assert.equal(table, "mkt_ad_jobs");
      return {
        select: () => ({ in: async () => ({ data: jobs, error: null }) }),
        update: (patch) => ({
          eq: (_field, id) => ({
            eq: async () => {
              Object.assign(jobs.find((job) => job.id === id), patch);
              return { error: null };
            },
          }),
        }),
      };
    },
    storage: {
      from(bucket) {
        return {
          download: async (path) => {
            const bytes = stores[bucket].get(path);
            return bytes
              ? { data: new Blob([bytes], { type: "video/mp4" }), error: null }
              : { data: null, error: { message: "not found" } };
          },
          upload: async (path, bytes) => {
            if (stores[bucket].has(path)) return { error: { message: "already exists" } };
            stores[bucket].set(path, Buffer.from(bytes));
            return { error: null };
          },
          remove: async (paths) => {
            for (const path of paths) stores[bucket].delete(path);
            return { error: null };
          },
        };
      },
    },
  };

  const first = await migrateLegacyHeroAdDraftsRc2({ supabase });
  assert.equal(first.jobs, 2);
  assert.equal(first.objects, 3);
  assert.equal(stores.videos.size, 0);
  assert.equal(stores["hero-ad-drafts"].size, 3);
  assert.ok(jobs.every((job) => job.output_bucket === "hero-ad-drafts"));
  assert.ok(jobs.every((job) => job.output_url.startsWith("storage://hero-ad-drafts/")));

  const second = await migrateLegacyHeroAdDraftsRc2({ supabase });
  assert.equal(second.objects, 3);
  assert.ok(second.evidence.every((item) => item.hadPublicSource === false));
  assert.equal(stores["hero-ad-drafts"].size, 3);
});
