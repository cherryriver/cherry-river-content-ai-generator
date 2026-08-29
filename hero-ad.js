const FORMATS = new Set(["vertical", "horizontal", "both"]);
const DEFAULT_ACCENT = "#FF1B8D";
const DEFAULT_BACKGROUND = "#0D0D10";
const HERO_AD_DRAFT_BUCKET = "hero-ad-drafts";
const REVIEWABLE_STATUSES = new Set(["READY_FOR_REVIEW", "APPROVED", "REJECTED"]);

class HeroAdError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "HeroAdError";
    this.statusCode = statusCode;
  }
}

function boundedText(value, fallback, maxLength, field) {
  const text = value == null ? fallback : String(value).trim();
  if (text.length > maxLength) throw new HeroAdError(`${field}_too_long`);
  return text;
}

function validHex(value, fallback, field) {
  const color = boundedText(value, fallback, 7, field);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HeroAdError(`${field}_must_be_hex_color`);
  return color.toUpperCase();
}

export function normalizeHeroAdRequest(body = {}) {
  const productId = boundedText(body.productId, "", 128, "productId");
  if (!productId) throw new HeroAdError("productId_required");
  const format = boundedText(body.format, "both", 16, "format").toLowerCase();
  if (!FORMATS.has(format)) throw new HeroAdError("format_must_be_vertical_horizontal_or_both");
  if (body.withBackground != null && typeof body.withBackground !== "boolean") {
    throw new HeroAdError("withBackground_must_be_boolean");
  }
  return {
    productId,
    format,
    brand: boundedText(body.brand, "", 80, "brand"),
    kicker: boundedText(body.kicker, "", 100, "kicker"),
    tagline: boundedText(body.tagline, "", 140, "tagline"),
    accent: body.accent == null ? null : validHex(body.accent, DEFAULT_ACCENT, "accent"),
    background: body.bg == null ? DEFAULT_BACKGROUND : validHex(body.bg, DEFAULT_BACKGROUND, "bg"),
    withBackground: body.withBackground === true,
  };
}

export function inferBrandName(productName = "") {
  const name = productName.toLowerCase();
  if (name.includes("averse")) return "AVERSE";
  if (name.includes("opémiska") || name.includes("opemiska")) return "OPÉMISKA";
  if (name.includes("thirst") || name.includes("nene") || name.includes("rum punch")) {
    return "THE THIRST IS REAL";
  }
  return "CHERRY RIVER";
}

export function assertInventoryProduct(product, expectedHost = "bypedtyxtnmmdsyrgwpj.supabase.co") {
  if (!product) throw new HeroAdError("product_not_found", 404);
  if (String(product.status || "").toLowerCase() !== "ready") {
    throw new HeroAdError("product_not_ready", 409);
  }
  if (!product.image) throw new HeroAdError("product_inventory_image_missing", 409);
  let imageUrl;
  try { imageUrl = new URL(product.image); } catch {
    throw new HeroAdError("product_inventory_image_invalid", 409);
  }
  if (
    imageUrl.protocol !== "https:"
    || imageUrl.hostname.toLowerCase() !== expectedHost.toLowerCase()
    || !imageUrl.pathname.includes("/storage/v1/object/")
  ) {
    throw new HeroAdError("product_inventory_image_untrusted", 409);
  }
  return imageUrl.toString();
}

export async function startAbstractHeroBackground({
  apiKey,
  format,
  accent,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new HeroAdError("background_provider_not_configured", 503);
  const aspectRatio = format === "vertical" ? "9:16" : "16:9";
  const response = await fetchImpl("https://api.piapi.ai/api/v1/task", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "seedance",
      task_type: "seedance-2",
      input: {
        mode: "text_to_video",
        duration: 6,
        aspect_ratio: aspectRatio,
        prompt: `Abstract premium beverage-advertising background only. Slow cinematic ${accent} light, subtle mist and liquid reflections, generous negative space. No bottle, no can, no packaging, no label, no logo, no text, no people, no hands.`,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 200 || !payload.data?.task_id) {
    throw new HeroAdError("background_provider_start_failed", 502);
  }
  return payload.data.task_id;
}

export function createGenerateAdHandler({
  supabase,
  getUser,
  piApiKey = process.env.PIAPI_API_KEY,
  fetchImpl = fetch,
  expectedProductImageHost = "bypedtyxtnmmdsyrgwpj.supabase.co",
}) {
  return async function generateAd(req, res) {
    try {
      const user = await getUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const input = normalizeHeroAdRequest(req.body);

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id,name,product_type,image,category,status,color")
        .eq("id", input.productId)
        .maybeSingle();
      if (productError) throw new HeroAdError("product_lookup_failed", 500);

      const productImage = assertInventoryProduct(product, expectedProductImageHost);
      const brandName = input.brand || inferBrandName(product.name);
      const accent = input.accent || (/^#[0-9a-f]{6}$/i.test(product.color || "")
        ? product.color.toUpperCase()
        : DEFAULT_ACCENT);
      const backgroundTaskId = input.withBackground
        ? await startAbstractHeroBackground({
          apiKey: piApiKey,
          format: input.format,
          accent,
          fetchImpl,
        })
        : null;

      const inputProps = {
        productId: product.id,
        productName: product.name,
        productType: product.product_type,
        productImage,
        brandName,
        kicker: input.kicker,
        tagline: input.tagline,
        accent,
        background: input.background,
        backgroundVideo: null,
        backgroundTaskId,
      };

      const { data: job, error: insertError } = await supabase
        .from("mkt_ad_jobs")
        .insert({
          product_id: product.id,
          format: input.format,
          input_props: inputProps,
          status: "QUEUED",
          created_by: user.id,
        })
        .select("id,status")
        .single();
      if (insertError) throw new HeroAdError("hero_ad_enqueue_failed", 500);

      return res.status(202).json({ jobId: job.id, status: job.status });
    } catch (error) {
      const status = error instanceof HeroAdError ? error.statusCode : 500;
      if (status >= 500) console.error("Hero Ad enqueue error:", error.message);
      return res.status(status).json({ error: error.message || "hero_ad_enqueue_failed" });
    }
  };
}

function parseStorageObjectRef(value, expectedBucket = HERO_AD_DRAFT_BUCKET) {
  const prefix = `storage://${expectedBucket}/`;
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const objectPath = value.slice(prefix.length);
  if (!/^hero-ads\/[0-9a-f-]+\/(vertical|horizontal)\.mp4$/i.test(objectPath)) return null;
  if (objectPath.includes("..") || objectPath.includes("\\")) return null;
  return objectPath;
}

export function createHeroAdReviewHandler({
  supabase,
  getUser,
  bucket = HERO_AD_DRAFT_BUCKET,
  expiresIn = 900,
}) {
  return async function heroAdReview(req, res) {
    try {
      const user = await getUser(req);
      if (!user?.id) return res.status(401).json({ error: "Unauthorized" });

      const jobId = boundedText(req.params?.jobId, "", 80, "jobId");
      if (!jobId) return res.status(400).json({ error: "jobId_required" });

      const { data: profile, error: profileError } = await supabase
        .from("mkt_profiles")
        .select("role,active")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileError) throw new HeroAdError("profile_lookup_failed", 500);
      const isAdmin = profile?.active === true && profile?.role === "admin";

      const { data: job, error: jobError } = await supabase
        .from("mkt_ad_jobs")
        .select("id,created_by,status,output_bucket,output_urls")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new HeroAdError("hero_ad_lookup_failed", 500);
      if (!job) return res.status(404).json({ error: "hero_ad_not_found" });
      if (!isAdmin && job.created_by !== user.id) {
        return res.status(403).json({ error: "hero_ad_review_forbidden" });
      }
      if (!REVIEWABLE_STATUSES.has(job.status)) {
        return res.status(409).json({ error: "hero_ad_not_ready_for_review" });
      }
      if (job.output_bucket !== bucket || !job.output_urls || typeof job.output_urls !== "object") {
        return res.status(409).json({ error: "hero_ad_outputs_not_private" });
      }

      const outputs = {};
      for (const [format, value] of Object.entries(job.output_urls)) {
        if (!new Set(["vertical", "horizontal"]).has(format)) {
          throw new HeroAdError("hero_ad_output_format_invalid", 409);
        }
        const objectPath = parseStorageObjectRef(value, bucket);
        if (!objectPath) throw new HeroAdError("hero_ad_output_reference_invalid", 409);
        const { data: signed, error: signedError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(objectPath, expiresIn);
        if (signedError || !signed?.signedUrl) {
          throw new HeroAdError("hero_ad_review_signing_failed", 500);
        }
        outputs[format] = signed.signedUrl;
      }

      return res.status(200).json({
        jobId: job.id,
        status: job.status,
        expiresIn,
        outputs,
      });
    } catch (error) {
      const status = error instanceof HeroAdError ? error.statusCode : 500;
      if (status >= 500) console.error("Hero Ad review error:", error.message);
      return res.status(status).json({ error: error.message || "hero_ad_review_failed" });
    }
  };
}

export { HERO_AD_DRAFT_BUCKET, HeroAdError, parseStorageObjectRef };
