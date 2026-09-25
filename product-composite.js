// product-composite.js — "original product" pipeline for still images.
//
// Brand rule (non-negotiable): a real Cherry River product is NEVER redrawn by the AI.
// The AI only generates the scene (an empty background plate); the original cut-out PNG
// of the product is then composited on top, pixel for pixel, with a contact shadow.
// Same invariant as the Hero Ad video module (hero-ad.js), applied to stills.

import sharp from "sharp";

export const PRODUCT_MODES = new Set(["original", "concept"]);

// Packaging kinds. heightRatio = product height as a fraction of the frame height;
// maxWidthRatio caps wide packs (cartons, 6-packs) so they never fill the frame.
const PACKAGING = {
  can355: {
    heightRatio: 0.42,
    maxWidthRatio: 0.34,
    descriptor: "a tall slim 355ml cylindrical aluminum beverage can standing perfectly upright at 90 degrees",
    surfaceHint: "a small 355ml drink can",
  },
  sixpack: {
    heightRatio: 0.4,
    maxWidthRatio: 0.62,
    descriptor: "a cardboard 6-pack carrier of 355ml cans standing upright",
    surfaceHint: "a 6-pack carton of drink cans",
  },
  carton: {
    heightRatio: 0.5,
    maxWidthRatio: 0.55,
    descriptor: "a 3-litre bag-in-box cardboard carton standing upright with a die-cut handle on top and a pour spout at the bottom front",
    surfaceHint: "a 3-litre bag-in-box wine carton",
  },
  bottle114: {
    heightRatio: 0.66,
    maxWidthRatio: 0.3,
    descriptor: "a tall slender 1.14L spirit bottle standing perfectly upright",
    surfaceHint: "a tall 1.14L spirit bottle",
  },
  bottle750: {
    heightRatio: 0.6,
    maxWidthRatio: 0.28,
    descriptor: "a 750ml glass spirit bottle with a defined neck, standing perfectly upright",
    surfaceHint: "a 750ml spirit bottle",
  },
};

// Resolve the REAL packaging from the catalogue row (name wins over product_type, because
// product_type only knows "can" | "bottle" and names carry the format: 750mL, 1.14L, 3 L…).
export function resolvePackaging(product, productName = "") {
  const name = `${product?.name || ""} ${productName || ""}`.toLowerCase();
  const type = String(product?.product_type || "").toLowerCase();
  let kind;
  if (/bag[-\s]?in[-\s]?box|carton|\b3\s?l\b|\b3\s?litres?\b/.test(name)) kind = "carton";
  else if (/6[-\s]?pack/.test(name)) kind = "sixpack";
  else if (/1[.,]14\s?l/.test(name)) kind = "bottle114";
  else if (/750\s?ml/.test(name)) kind = "bottle750";
  else if (/355\s?ml|canette|\bcan\b/.test(name)) kind = "can355";
  else if (type === "can") kind = "can355";
  else kind = "bottle750";
  return { kind, ...PACKAGING[kind] };
}

export function normalizeProductMode(value) {
  if (value == null || value === "") return "original";
  const mode = String(value).trim().toLowerCase();
  if (!PRODUCT_MODES.has(mode)) {
    const err = new Error("productMode must be 'original' or 'concept'");
    err.statusCode = 400;
    throw err;
  }
  return mode;
}

export const PLACEMENTS = new Set(["center", "left", "right"]);

export function normalizePlacement(value) {
  const p = String(value || "center").trim().toLowerCase();
  return PLACEMENTS.has(p) ? p : "center";
}

// Negative block appended to every background-plate prompt.
export const NO_PRODUCT_CLAUSE =
  "The scene must contain NO bottle, NO can, NO carton, NO packaging, NO product, NO label, NO logo, NO text, NO lettering, NO people, NO hands.";

export function placementPhrase(placement) {
  if (placement === "left") return "left third of the frame";
  if (placement === "right") return "right third of the frame";
  return "center of the frame";
}

// Fallback prompt (used if the Claude brief fails). Camera is straight-on at product height
// so a frontal packshot composited on top has a coherent perspective.
export function buildBackgroundPlatePrompt(sceneDirection, packaging, placement = "center") {
  return [
    `Background plate for a premium beverage advertisement: ${sceneDirection}.`,
    `Leave a clear, empty, flat area of the tabletop in the ${placementPhrase(placement)}, in the foreground, where ${packaging.surfaceHint} will be placed later in post-production; props frame that empty spot but never occupy it.`,
    "Straight-on eye-level camera, lens at the height of a standing bottle, 50mm, table surface visible in the lower third, background softly out of focus.",
    NO_PRODUCT_CLAUSE,
    "Professional beverage advertising photography.",
  ].join(" ");
}

// Crop fully transparent borders so scale is computed on the real silhouette.
export async function trimCutout(cutoutBuffer) {
  const img = sharp(cutoutBuffer).ensureAlpha();
  const { data, info } = await img.clone().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > 16) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) throw new Error("cutout_is_fully_transparent");
  const png = await sharp(cutoutBuffer).ensureAlpha()
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png().toBuffer();
  return png;
}

// Fraction of (near-)transparent pixels. A real cut-out has a lot; a JPEG packshot has 0.
export async function transparentFraction(buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta.hasAlpha) return 0;
  const { data } = await sharp(buffer).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let t = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < 16) t++;
  return t / data.length;
}

// Horizontal extent of the product's footprint (bottom rows of the alpha mask), in px.
async function footprint(cutoutPng) {
  const { data, info } = await sharp(cutoutPng).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rows = Math.max(2, Math.round(height * 0.03));
  let left = width, right = -1;
  for (let y = height - rows; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 64) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0) return { left: 0, width };
  return { left, width: right - left + 1 };
}

export function computePlacement({ bgWidth, bgHeight, cutWidth, cutHeight, packaging, placement = "center" }) {
  let height = Math.round(bgHeight * packaging.heightRatio);
  let width = Math.round((cutWidth / cutHeight) * height);
  const maxWidth = Math.round(bgWidth * packaging.maxWidthRatio);
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round((cutHeight / cutWidth) * width);
  }
  const baseY = Math.round(bgHeight * 0.88); // product stands on the surface, lower part of frame
  const centerX = placement === "left" ? bgWidth * 0.3 : placement === "right" ? bgWidth * 0.7 : bgWidth / 2;
  const left = Math.max(0, Math.min(bgWidth - width, Math.round(centerX - width / 2)));
  const top = Math.max(0, baseY - height);
  return { width, height, left, top };
}

// Composite the untouched product PNG onto the generated background.
// Only resize (uniform scale) is applied to the product — no recolour, no warp, no AI.
export async function compositeProductOnBackground({ backgroundBuffer, cutoutBuffer, packaging, placement = "center" }) {
  const bgMeta = await sharp(backgroundBuffer).metadata();
  const bgWidth = bgMeta.width, bgHeight = bgMeta.height;
  const trimmed = await trimCutout(cutoutBuffer);
  const tMeta = await sharp(trimmed).metadata();
  const box = computePlacement({
    bgWidth, bgHeight, cutWidth: tMeta.width, cutHeight: tMeta.height, packaging, placement,
  });

  const product = await sharp(trimmed)
    .resize(box.width, box.height, { fit: "fill", kernel: "lanczos3" })
    .png().toBuffer();

  const foot = await footprint(product);
  const baseY = box.top + box.height;

  // 1) Contact shadow: tight, dark ellipse right under the footprint.
  const cW = Math.round(foot.width * 1.25);
  const cH = Math.max(6, Math.round(foot.width * 0.16));
  const cBlur = Math.max(2, Math.round(cH * 0.35));
  const contactSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cW + cBlur * 6}" height="${cH + cBlur * 6}">
      <ellipse cx="${(cW + cBlur * 6) / 2}" cy="${(cH + cBlur * 6) / 2}" rx="${cW / 2}" ry="${cH / 2}" fill="black" fill-opacity="0.55"/>
    </svg>`
  );
  const contact = await sharp(contactSvg).blur(cBlur).png().toBuffer();
  const contactMeta = await sharp(contact).metadata();

  // 2) Ambient shadow: wide, soft ellipse spreading on the surface.
  const aW = Math.round(foot.width * 2.4);
  const aH = Math.max(10, Math.round(foot.width * 0.42));
  const aBlur = Math.max(4, Math.round(aH * 0.45));
  const ambientSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${aW + aBlur * 6}" height="${aH + aBlur * 6}">
      <ellipse cx="${(aW + aBlur * 6) / 2}" cy="${(aH + aBlur * 6) / 2}" rx="${aW / 2}" ry="${aH / 2}" fill="black" fill-opacity="0.28"/>
    </svg>`
  );
  const ambient = await sharp(ambientSvg).blur(aBlur).png().toBuffer();
  const ambientMeta = await sharp(ambient).metadata();

  const footCenterX = box.left + foot.left + foot.width / 2;
  const clampLeft = (w, x) => Math.max(0, Math.min(bgWidth - w, Math.round(x)));
  const clampTop = (h, y) => Math.max(0, Math.min(bgHeight - h, Math.round(y)));

  const layers = [];
  if (ambientMeta.width <= bgWidth && ambientMeta.height <= bgHeight) {
    layers.push({
      input: ambient,
      left: clampLeft(ambientMeta.width, footCenterX - ambientMeta.width / 2),
      top: clampTop(ambientMeta.height, baseY - ambientMeta.height * 0.5),
      blend: "multiply",
    });
  }
  if (contactMeta.width <= bgWidth && contactMeta.height <= bgHeight) {
    layers.push({
      input: contact,
      left: clampLeft(contactMeta.width, footCenterX - contactMeta.width / 2),
      top: clampTop(contactMeta.height, baseY - contactMeta.height * 0.5),
      blend: "multiply",
    });
  }
  layers.push({ input: product, left: box.left, top: box.top });

  const out = await sharp(backgroundBuffer).composite(layers).png().toBuffer();
  return { buffer: out, box, background: { width: bgWidth, height: bgHeight } };
}
