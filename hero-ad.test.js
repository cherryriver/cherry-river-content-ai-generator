import test from "node:test";
import assert from "node:assert/strict";
import {
  createGenerateAdHandler,
  createHeroAdReviewHandler,
  inferBrandName,
  normalizeHeroAdRequest,
  parseStorageObjectRef,
} from "./hero-ad.js";

const inventoryProduct = {
  id: "1776357908660",
  name: "CR Gin Pamplemousse Rose 750mL",
  product_type: "bottle",
  category: "Gins",
  status: "ready",
  color: "#ff1b8d",
  image: "https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/product-images/product-1776357908660.jpg",
};

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

function createSupabase({ product = inventoryProduct, productError = null } = {}) {
  const captured = { inserts: [] };
  return {
    captured,
    from(table) {
      if (table === "products") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: product, error: productError }) };
              },
            };
          },
        };
      }
      if (table === "mkt_ad_jobs") {
        return {
          insert(row) {
            captured.inserts.push(row);
            return {
              select() {
                return {
                  single: async () => ({
                    data: { id: "00000000-0000-4000-8000-000000000001", status: "QUEUED" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("normalizes the bounded Hero Ad request", () => {
  assert.deepEqual(normalizeHeroAdRequest({ productId: " 42 ", format: "BOTH" }), {
    productId: "42",
    format: "both",
    brand: "",
    kicker: "",
    tagline: "",
    accent: null,
    background: "#0D0D10",
    withBackground: false,
  });
  assert.throws(
    () => normalizeHeroAdRequest({ productId: "42", format: "square" }),
    /format_must_be_vertical_horizontal_or_both/,
  );
});

test("uses known brand names without inventing the parent company", () => {
  assert.equal(inferBrandName("Averse Vodka 1.14L"), "AVERSE");
  assert.equal(inferBrandName("Opémiska Gin Boréal"), "OPÉMISKA");
  assert.equal(inferBrandName("Tropical Rich Rum Punch"), "THE THIRST IS REAL");
  assert.equal(inferBrandName("CR Gin Pamplemousse"), "CHERRY RIVER");
});

test("queues the exact inventory image and never renders on the request", async () => {
  const supabase = createSupabase();
  const handler = createGenerateAdHandler({
    supabase,
    getUser: async () => ({ id: "10000000-0000-4000-8000-000000000001" }),
  });
  const response = createResponse();
  await handler({ body: { productId: inventoryProduct.id, format: "both" } }, response);

  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.status, "QUEUED");
  assert.equal(supabase.captured.inserts.length, 1);
  const job = supabase.captured.inserts[0];
  assert.equal(job.status, "QUEUED");
  assert.equal(job.product_id, inventoryProduct.id);
  assert.equal(job.input_props.productImage, inventoryProduct.image);
  assert.equal(job.input_props.backgroundTaskId, null);
});

test("starts only an abstract background task when requested", async () => {
  const supabase = createSupabase();
  let providerBody;
  const handler = createGenerateAdHandler({
    supabase,
    getUser: async () => ({ id: "10000000-0000-4000-8000-000000000001" }),
    piApiKey: "test-only-key",
    fetchImpl: async (_url, options) => {
      providerBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ code: 200, data: { task_id: "task-background-1" } }) };
    },
  });
  const response = createResponse();
  await handler({ body: {
    productId: inventoryProduct.id,
    format: "vertical",
    withBackground: true,
  } }, response);

  assert.equal(response.statusCode, 202);
  assert.equal(providerBody.input.mode, "text_to_video");
  assert.equal(providerBody.input.image_urls, undefined);
  assert.match(providerBody.input.prompt, /No bottle, no can, no packaging/);
  assert.equal(supabase.captured.inserts[0].input_props.backgroundTaskId, "task-background-1");
});

test("fails closed for unauthenticated, missing, or untrusted products", async () => {
  const unauthorized = createGenerateAdHandler({
    supabase: createSupabase(),
    getUser: async () => null,
  });
  const unauthorizedResponse = createResponse();
  await unauthorized({ body: { productId: inventoryProduct.id } }, unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);

  const missing = createGenerateAdHandler({
    supabase: createSupabase({ product: null }),
    getUser: async () => ({ id: "user" }),
  });
  const missingResponse = createResponse();
  await missing({ body: { productId: "missing" } }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);

  const untrusted = createGenerateAdHandler({
    supabase: createSupabase({ product: { ...inventoryProduct, image: "https://example.com/product.png" } }),
    getUser: async () => ({ id: "user" }),
  });
  const untrustedResponse = createResponse();
  await untrusted({ body: { productId: inventoryProduct.id } }, untrustedResponse);
  assert.equal(untrustedResponse.statusCode, 409);
});

function createReviewSupabase({
  profile = { role: "creator", active: true },
  job = {
    id: "00000000-0000-4000-8000-000000000001",
    created_by: "10000000-0000-4000-8000-000000000001",
    status: "READY_FOR_REVIEW",
    output_bucket: "hero-ad-drafts",
    output_urls: {
      vertical: "storage://hero-ad-drafts/hero-ads/00000000-0000-4000-8000-000000000001/vertical.mp4",
    },
  },
} = {}) {
  const signed = [];
  return {
    signed,
    from(table) {
      if (table === "mkt_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) };
      }
      if (table === "mkt_ad_jobs") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job, error: null }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          createSignedUrl: async (objectPath, expiresIn) => {
            signed.push({ bucket, objectPath, expiresIn });
            return { data: { signedUrl: `https://signed.example/${objectPath}` }, error: null };
          },
        };
      },
    },
  };
}

test("signs private review URLs on demand without persisting them", async () => {
  const supabase = createReviewSupabase();
  const handler = createHeroAdReviewHandler({
    supabase,
    getUser: async () => ({ id: "10000000-0000-4000-8000-000000000001" }),
  });
  const response = createResponse();
  await handler({ params: { jobId: "00000000-0000-4000-8000-000000000001" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.expiresIn, 900);
  assert.match(response.payload.outputs.vertical, /^https:\/\/signed\.example\//);
  assert.deepEqual(supabase.signed, [{
    bucket: "hero-ad-drafts",
    objectPath: "hero-ads/00000000-0000-4000-8000-000000000001/vertical.mp4",
    expiresIn: 900,
  }]);
});

test("review authorization and object references fail closed", async () => {
  const forbidden = createHeroAdReviewHandler({
    supabase: createReviewSupabase(),
    getUser: async () => ({ id: "20000000-0000-4000-8000-000000000002" }),
  });
  const forbiddenResponse = createResponse();
  await forbidden({ params: { jobId: "00000000-0000-4000-8000-000000000001" } }, forbiddenResponse);
  assert.equal(forbiddenResponse.statusCode, 403);

  const publicOutput = createHeroAdReviewHandler({
    supabase: createReviewSupabase({ job: {
      id: "00000000-0000-4000-8000-000000000001",
      created_by: "10000000-0000-4000-8000-000000000001",
      status: "READY_FOR_REVIEW",
      output_bucket: null,
      output_urls: { vertical: "https://public.example/video.mp4" },
    } }),
    getUser: async () => ({ id: "10000000-0000-4000-8000-000000000001" }),
  });
  const publicResponse = createResponse();
  await publicOutput({ params: { jobId: "00000000-0000-4000-8000-000000000001" } }, publicResponse);
  assert.equal(publicResponse.statusCode, 409);
  assert.equal(parseStorageObjectRef("storage://hero-ad-drafts/../secret"), null);
});
