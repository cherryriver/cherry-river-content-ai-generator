import "dotenv/config";
import express from "express";
import { mountMcp } from "./mcp.js";
import cors from "cors";
import Replicate from "replicate";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, unlink } from "fs/promises";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createHash } from "crypto";
import { extractAccessToken } from "./auth-token.js";
import { resolveAuthenticatedUser } from "./mediaos-core-auth.js";
import { createGenerateAdHandler } from "./hero-ad.js";

const execFileAsync = promisify(execFile);
// Use bundled ffmpeg (works on Vercel serverless) with local system ffmpeg as fallback
const FFMPEG_PATH = ffmpegInstaller.path;
const FFPROBE_PATH = FFMPEG_PATH.replace("ffmpeg", "ffprobe");

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = "product-images";
const VIDEO_BUCKET = "videos";

const FLUX_COST_PER_IMAGE = 0.055;       // Replicate Flux 2 Pro, per image
const SEEDANCE_COST_PER_SECOND = 0.008;  // PiAPI Seedance 2 Max, per second

// Multer — memory storage (files go to Supabase, not local disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Upload image buffer to Supabase Storage, return public URL
async function uploadToStorage(buffer, mimetype, filename) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: mimetype, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return publicUrl;
}

// Download image from URL and upload to Supabase Storage, return permanent public URL
async function saveGeneratedImage(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimetype = response.headers.get("content-type") || "image/png";
  return uploadToStorage(buffer, mimetype, `generated/${filename}`);
}

// Enhance prompt using Claude — with vision if product image available
async function enhancePrompt(userPrompt, product) {
  const isCan = product?.product_type === "can";
  const isAverse = product?.name?.toLowerCase().includes("averse");
  const userContent = [];

  // Attach product image so Claude sees exact label, colors, shape
  if (product?.image) {
    try {
      const imgResp = await fetch(product.image);
      if (imgResp.ok) {
        const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        const base64 = imgBuffer.toString("base64");
        const contentType = imgResp.headers.get("content-type") || "image/jpeg";
        userContent.push({ type: "image", source: { type: "base64", media_type: contentType, data: base64 } });
      }
    } catch (e) {
      console.error("Failed to fetch product image for image prompt:", e.message);
    }
  }

  userContent.push({
    type: "text",
    text: `You are a world-class product photography director for premium beverage brands.
Study the product image carefully — memorize the exact ${isCan ? "can shape, label colors, design, pull-tab" : isAverse ? "frosted matte bottle shape, colored dome base cap, label design — this bottle has NO cork" : "bottle shape, glass color, label design, cork"}.
Enhance this prompt into a VIP professional photography brief. Keep it under 120 words.
Return ONLY the enhanced prompt, nothing else — no explanations, no labels.

Product: "${product?.name || "Premium beverage"}"
User prompt: ${userPrompt}

Rules:
- Describe THIS exact product from the image — specific colors, label details, bottle/can shape
- Keep the user's core scene/idea
- Add: exact product positioning, lighting details, camera settings (f-stop, depth of field), mood, photographic style
${isCan ? "- CRITICAL for cans: the can must be shown PERFECTLY UPRIGHT, standing vertically at 90 degrees, never tilted or angled. Label text must be fully readable and undistorted. Can is planted firmly on the surface, not floating." : ""}
- End with: "professional beverage advertising photography"`,
  });

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: userContent }],
  });

  return message.content[0].text.trim();
}

// Map format labels to aspect ratios
const aspectRatioMap = {
  "1:1": "1:1",
  "4:5": "4:5",
  "9:16": "9:16",
  "16:9": "16:9",
};

// Map quality labels to resolution
const qualityMap = {
  Draft: "1 MP",
  HD: "2 MP",
  "4K": "4 MP",
};

// Static scenes
const scenes = [
  { id: 1, name: "Winter Chalet", category: "Lifestyle", gradient: "from-blue-900 to-slate-700" },
  { id: 2, name: "Beach Sunset", category: "Lifestyle", gradient: "from-orange-500 to-pink-600" },
  { id: 3, name: "Mountain Lake", category: "Lifestyle", gradient: "from-emerald-800 to-cyan-700" },
  { id: 4, name: "Urban Night", category: "Lifestyle", gradient: "from-purple-900 to-gray-800" },
  { id: 5, name: "White Minimal", category: "Studio", gradient: "from-gray-100 to-white" },
  { id: 6, name: "Dark Moody", category: "Studio", gradient: "from-gray-900 to-black" },
  { id: 7, name: "Marble Surface", category: "Studio", gradient: "from-gray-300 to-gray-100" },
  { id: 8, name: "Neon Glow", category: "Studio", gradient: "from-pink-600 to-violet-800" },
  { id: 9, name: "Christmas", category: "Seasonal", gradient: "from-red-800 to-green-900" },
  { id: 10, name: "Summer Party", category: "Seasonal", gradient: "from-yellow-400 to-orange-500" },
  { id: 11, name: "Valentine's", category: "Seasonal", gradient: "from-rose-600 to-pink-400" },
  { id: 12, name: "Autumn Harvest", category: "Seasonal", gradient: "from-amber-700 to-orange-900" },
];

app.get("/api/scenes", (_req, res) => res.json(scenes));

// --- Concept Studio: packaging concept mockup generator ---
// Generates NEW packaging/label concepts for brainstorming with a designer.
// CRITICAL: never references a real product photo and never renders label text/logos —
// the generated mockup is shape + finish + color + scene only; real label artwork stays vector,
// added by the design team afterward. This also sidesteps Flux's unreliable text rendering.

const conceptShapeDescriptors = {
  can: "a tall slim 355ml cylindrical aluminum beverage can, standing perfectly upright",
  bottle750: "a 750ml glass spirit bottle with a defined neck and cap, standing perfectly upright",
  bottle114: "a 1.14L frosted matte glass bottle, TALL and SLENDER with an elongated body, straight vertical shoulders, and a narrow neck (NOT a short squat decanter or whiskey-bottle shape), with a distinctive dome-shaped pool of liquid visible near the base, standing perfectly upright",
};

// Real catalog photos used ONLY for exact shape/geometry conditioning on the master "studio" tile —
// enhanceConceptPrompt instructs Flux to copy proportions only and ignore the real label/color/text.
const conceptShapeReferenceImages = {
  can: "https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/product-images/product-1776357928401.jpg", // CR Amaretto Sour 355mL
  bottle750: "https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/product-images/product-1776357898479.jpg", // Cherry River Dry Gin 750mL
  bottle114: "https://bypedtyxtnmmdsyrgwpj.supabase.co/storage/v1/object/public/product-images/product-1776357972390.jpg", // Averse Vodka Mangue 1.14L
};

// Catalog `color` values often capture a label ACCENT (e.g. mint-green text on a black can),
// not the can/bottle's actual dominant body color. Sample the real photo directly instead.
// Product shots are directionally lit (bright highlight sweeping across one side), so a plain
// median/mode over the visible surface skews toward that highlight, not the true base tone —
// e.g. a matte black can measured this way came back mid-gray. Instead, rank pixels by
// brightness and average the 10th-30th percentile band: dark enough to sit in shadow/base tone
// rather than the highlight, but not so dark it's just noise or the deepest shadow crease.
async function getDominantColor(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    const imgBuf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(imgBuf)
      .resize(150, 150, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, channels = info.channels;
    const x0 = Math.floor(w * 0.3), x1 = Math.floor(w * 0.7);
    const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.8);
    const pixels = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * w + x) * channels;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        pixels.push({ r, g, b, brightness: 0.299 * r + 0.587 * g + 0.114 * b });
      }
    }
    pixels.sort((a, b) => a.brightness - b.brightness);
    const lo = Math.floor(pixels.length * 0.1), hi = Math.floor(pixels.length * 0.3);
    const band = pixels.slice(lo, hi);
    const avg = (ch) => Math.round(band.reduce((s, p) => s + p[ch], 0) / band.length);
    const r = avg("r"), g = avg("g"), b = avg("b");
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    console.error("getDominantColor failed:", e.message);
    return null;
  }
}

// Prompt wording alone ("do not copy the label") isn't reliable protection against Flux
// replicating a reference image's real printed content — confirmed live: a can with a bold
// zigzag border + large "SANS ALCOOL" text leaked through in full even with an explicit
// per-word ban on "zigzag" in the prompt (Flux has no strength/weight dial on input_images,
// so wording is the only lever, and a high-contrast graphic label can just overpower it).
// A first attempt destroyed the printed content by downscaling + grayscaling + blurring the
// photo, but that still wasn't enough: a real label's color-block split (e.g. solid black body
// + a distinct accent-colored zone) is the single largest-area brightness contrast in the whole
// photo, so it survives at ANY blur radius (confirmed down to a 6px downscale + blur(40)) and
// Flux still reads the surviving brightness zone as "there's a distinct zone here that needs a
// color" — fighting the prompt's "single flat color" instruction and producing a mis-shapen
// patch instead of either a clean flat can or the real chevron.
// Real fix: don't derive the reference from the photo's actual tones at all. The catalog photos
// all sit on a pure black backdrop, so mask the object out by pixel brightness, then paint the
// interior with a synthetic per-row cylindrical highlight — same outer silhouette, proportions,
// and rim contour as the real product, but zero information about where its actual print's
// color zones sit.
const silhouetteReferenceCache = new Map();

async function getFlatSilhouette(imageUrl) {
  if (silhouetteReferenceCache.has(imageUrl)) return silhouetteReferenceCache.get(imageUrl);
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * channels);
  const isObject = (x, y) => {
    const idx = (y * width + x) * channels;
    return Math.max(data[idx], data[idx + 1], data[idx + 2]) > 8;
  };

  for (let y = 0; y < height; y++) {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (isObject(x, y)) { if (left === -1) left = x; right = x; }
    }
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (left === -1 || x < left || x > right) { out[idx] = out[idx + 1] = out[idx + 2] = 0; continue; }
      const t = (x - left) / Math.max(1, right - left);
      const highlight = Math.exp(-((t - 0.35) ** 2) / (2 * 0.22 * 0.22));
      let v = 65 + 140 * highlight;
      if (t < 0.04 || t > 0.96) v *= 0.5; // cylinder-wrap shadow at the extreme edges
      out[idx] = out[idx + 1] = out[idx + 2] = Math.round(Math.max(0, Math.min(255, v)));
    }
  }

  const processed = await sharp(out, { raw: { width, height, channels } }).blur(3).png().toBuffer();
  const filename = `concept-references/silhouette-${createHash("md5").update(imageUrl).digest("hex")}.png`;
  const url = await uploadToStorage(processed, "image/png", filename);
  silhouetteReferenceCache.set(imageUrl, url);
  return url;
}

const conceptSceneTemplates = {
  can: [
    { id: "studio", name: "Studio", description: "Clean white studio packaging reference shot", prompt: "Clean white studio background, soft even three-point lighting, the can centered, subtle shadow beneath, no props — a true packaging reference shot." },
    { id: "lifestyle", name: "Lifestyle Outdoor", description: "Natural daylight, softly blurred outdoor setting", prompt: "Outdoor lifestyle setting, natural daylight, the can held casually at chest height against a softly blurred park or patio background, candid editorial feel." },
    { id: "shelf", name: "Shelf Row", description: "Retail shelf row, repeated front-facing", prompt: "A retail cooler shelf row, the can repeated several times in a neat front-facing row alongside softly blurred neighboring cans, even shelf lighting, true-to-life retail context." },
    { id: "hero", name: "Hero Close-Up", description: "Dramatic close-up hero shot", prompt: "Dramatic hero close-up, the can large in frame with shallow depth of field, dynamic angled lighting sculpting the can's form, premium advertising composition." },
    { id: "hands", name: "Hands Holding", description: "Held naturally, label facing camera", prompt: "A hand holding the can naturally at a relaxed angle, soft daylight, the can's full label face turned toward camera, fingers not obscuring the label." },
    { id: "cooler", name: "Cooler", description: "Nestled in ice with condensation", prompt: "The can nestled in a cooler full of ice, condensation on the surface, cool blue-toned lighting, classic chilled-and-ready presentation." },
    { id: "bar", name: "Bar Counter", description: "Dark wood bar counter, warm pendant light", prompt: "Resting on a dark wood bar counter, a single warm pendant light overhead, soft bokeh bottles in the background, upscale bar presentation." },
    { id: "event", name: "Event Table", description: "Long event table, soft decor bokeh", prompt: "On a long event table alongside other drinkware, string lights or simple decor softly blurred in the background, social gathering presentation." },
  ],
  bottle750: [
    { id: "studio", name: "Studio", description: "Clean white studio packaging reference shot", prompt: "Clean white studio background, soft even three-point lighting, the bottle centered, glass refraction and the cap crisply rendered, no props." },
    { id: "lifestyle", name: "Lifestyle Outdoor", description: "Natural daylight through the glass", prompt: "Outdoor lifestyle setting, natural daylight passing through the glass and liquid, the bottle resting on a wooden table with a softly blurred garden or patio background." },
    { id: "shelf", name: "Shelf Row", description: "Retail shelf row, repeated front-facing", prompt: "A retail shelf row, the bottle repeated several times in a neat front-facing row, even shelf lighting, consistent glass reflections across the row." },
    { id: "hero", name: "Hero Close-Up", description: "Dramatic close-up hero shot", prompt: "Dramatic hero close-up, the bottle large in frame with shallow depth of field, dynamic angled rim lighting catching the glass edge and cap, premium advertising composition." },
    { id: "hands", name: "Hands Holding", description: "Held by the neck, label facing camera", prompt: "A hand holding the bottle by the neck at a relaxed angle, soft daylight passing through the liquid, the bottle's full face turned toward camera." },
    { id: "cooler", name: "Ice Bucket", description: "In a metal ice bucket with condensation", prompt: "The bottle resting in a metal ice bucket, ice cubes and condensation on the glass, cool tones, classic chilled presentation." },
    { id: "bar", name: "Bar Counter", description: "Dark wood bar, light refracting through glass", prompt: "Standing on a dark wood bar counter, a single warm pendant light overhead refracting through the glass and liquid, soft bokeh glassware in the background." },
    { id: "event", name: "Event Table", description: "Long event table, soft decor bokeh", prompt: "On a long event table alongside glassware, string lights or simple decor softly blurred in the background, social gathering presentation." },
  ],
  bottle114: [
    { id: "studio", name: "Studio", description: "Clean white studio packaging reference shot", prompt: "Clean white studio background, soft even three-point lighting, the bottle centered, frosted matte glass and dome cap crisply rendered, no props." },
    { id: "lifestyle", name: "Lifestyle Outdoor", description: "Natural daylight, softly blurred outdoor setting", prompt: "Outdoor lifestyle setting, natural daylight, the bottle resting on a wooden table with a softly blurred garden or patio background." },
    { id: "shelf", name: "Shelf Row", description: "Retail shelf row, repeated front-facing", prompt: "A retail shelf row, the bottle repeated several times in a neat front-facing row, even shelf lighting, consistent frosted-glass reflections across the row." },
    { id: "hero", name: "Hero Close-Up", description: "Dramatic close-up hero shot", prompt: "Dramatic hero close-up, the bottle large in frame with shallow depth of field, dynamic angled rim lighting sculpting the dome cap and frosted body, premium advertising composition." },
    { id: "hands", name: "Hands Holding", description: "Held naturally, label facing camera", prompt: "A hand holding the bottle naturally at a relaxed angle, soft daylight, the bottle's full face turned toward camera." },
    { id: "cooler", name: "Ice Bucket", description: "In a metal ice bucket with condensation", prompt: "The bottle resting in a metal ice bucket, ice cubes and condensation on the frosted glass, cool tones, classic chilled presentation." },
    { id: "bar", name: "Bar Counter", description: "Dark wood bar counter, warm pendant light", prompt: "Standing on a dark wood bar counter, a single warm pendant light overhead, soft bokeh glassware in the background, upscale bar presentation." },
    { id: "event", name: "Event Table", description: "Long event table, soft decor bokeh", prompt: "On a long event table alongside glassware, string lights or simple decor softly blurred in the background, social gathering presentation, generous shared-format energy." },
  ],
};

const conceptFinishes = {
  matte: "Matte finish — soft non-reflective surface, no glossy highlights, premium understated texture.",
  metallic: "Metallic finish — brushed metal sheen, cool reflective highlights, modern industrial texture.",
  glossy: "Glossy finish — high-shine reflective surface, crisp specular highlights, polished premium look.",
  frosted: "Frosted finish — translucent matte texture, soft diffused light passing through, soft premium look.",
  neon: "Bold neon finish — vivid saturated color block, high-contrast graphic look, eye-catching modern energy.",
  clean_minimal: "Clean minimal finish — flat solid pastel or neutral color, no texture distractions, editorial simplicity.",
};

const conceptMoods = {
  premium: "Premium, elevated mood — refined lighting, sophisticated color grading, upscale retail feel.",
  vibrant_summer: "Vibrant summer mood — bright saturated colors, energetic and refreshing feel.",
  natural_lifestyle: "Natural lifestyle mood — soft organic lighting, warm earthy tones, approachable everyday feel.",
  bold_festive: "Bold festive mood — high-energy colors, celebratory and eye-catching feel.",
  clean_editorial: "Clean editorial mood — neutral balanced lighting, minimal styling, gallery-quality presentation.",
};

// 15 reusable example prompts — one-click finish+mood presets, reusable across any flavor or format
const conceptExamplePrompts = [
  { id: "matte-black-premium", name: "Matte Black Premium", finish: "matte", mood: "premium", extra: "a deep black base tone" },
  { id: "metallic-summer-splash", name: "Metallic Summer Splash", finish: "metallic", mood: "vibrant_summer", extra: "bright citrus accent tones" },
  { id: "frosted-lifestyle-outdoor", name: "Frosted Lifestyle Outdoor", finish: "frosted", mood: "natural_lifestyle", extra: "soft sage and cream tones" },
  { id: "bold-neon-night", name: "Bold Neon Night", finish: "neon", mood: "bold_festive", extra: "hot pink and electric blue tones" },
  { id: "clean-minimal-studio", name: "Clean Minimal Studio", finish: "clean_minimal", mood: "clean_editorial", extra: "soft neutral beige tones" },
  { id: "glossy-premium-shine", name: "Glossy Premium Shine", finish: "glossy", mood: "premium", extra: "deep burgundy tones" },
  { id: "matte-pastel-spring", name: "Matte Pastel Spring", finish: "matte", mood: "natural_lifestyle", extra: "soft pastel pink and mint tones" },
  { id: "metallic-industrial-steel", name: "Metallic Industrial Steel", finish: "metallic", mood: "clean_editorial", extra: "cool gunmetal grey tones" },
  { id: "frosted-festive-sparkle", name: "Frosted Festive Sparkle", finish: "frosted", mood: "bold_festive", extra: "icy silver and gold accent tones" },
  { id: "neon-pop-art", name: "Neon Pop Art", finish: "neon", mood: "vibrant_summer", extra: "bold yellow and magenta tones" },
  { id: "glossy-tropical-citrus", name: "Glossy Tropical Citrus", finish: "glossy", mood: "vibrant_summer", extra: "vivid orange and lime tones" },
  { id: "matte-midnight-luxury", name: "Matte Midnight Luxury", finish: "matte", mood: "premium", extra: "deep midnight navy tones" },
  { id: "clean-botanical-fresh", name: "Clean Botanical Fresh", finish: "clean_minimal", mood: "natural_lifestyle", extra: "soft botanical green tones" },
  { id: "metallic-sunset-coastal", name: "Metallic Sunset Coastal", finish: "metallic", mood: "natural_lifestyle", extra: "warm coral and gold tones" },
  { id: "glossy-holiday-gold", name: "Glossy Holiday Gold", finish: "glossy", mood: "bold_festive", extra: "rich gold and deep red tones" },
];

app.get("/api/concept-scenes", (req, res) => {
  const format = req.query.format;
  const templates = conceptSceneTemplates[format];
  if (!templates) return res.status(400).json({ error: "Invalid format. Use can, bottle750, or bottle114." });
  res.json(templates.map(({ id, name, description }) => ({ id, name, description })));
});

app.get("/api/concept-options", (_req, res) => {
  res.json({
    finishes: Object.keys(conceptFinishes).map((id) => ({ id, label: id.replace(/_/g, " ") })),
    moods: Object.keys(conceptMoods).map((id) => ({ id, label: id.replace(/_/g, " ") })),
    capColors: Object.keys(conceptCapColors).map((id) => ({ id, label: id.replace(/_/g, " ") })),
    liquidVisibility: Object.keys(conceptLiquidVisibility).map((id) => ({ id, label: id.replace(/_/g, " ") })),
  });
});

app.get("/api/concept-examples", (_req, res) => {
  res.json(conceptExamplePrompts.map(({ id, name }) => ({ id, name })));
});

// Claude call for a packaging concept — no product photo reference, explicitly bans rendered text/logos
const conceptCapColors = {
  black: "a glossy black cap",
  gold: "a polished gold cap",
  silver: "a brushed silver cap",
  wood: "a natural wood-grain cap with warm brown tones and visible grain texture",
  matches_body: "a cap that matches the bottle's body color and finish",
};

const conceptLiquidVisibility = {
  visible: "the liquid inside should be visible through the glass, catching light naturally",
  opaque: "the bottle should read as opaque/frosted, the liquid inside not clearly visible",
};

async function enhanceConceptPrompt({ flavorName, colorHex, colorRole, shapeDescriptor, finishText, moodText, sceneText, extra, capText, liquidText, referenceMode }) {
  const colorInstruction = !colorHex
    ? ""
    : colorRole === "liquid"
    ? `The glass itself must render as fully clear, colorless, uncolored glass — no tint on the glass. The LIQUID visible inside should be colored ${colorHex}, catching light naturally through the clear glass.`
    : `Brand color inspiration: ${colorHex}.`;

  const referenceInstruction = referenceMode === "consistency"
    ? "- A reference image of this exact can/bottle is attached. Keep the EXACT same color, gradient, finish and proportions as the reference — do not reinterpret or change the colors. Only the scene, lighting, and background should change."
    : referenceMode === "shape"
    ? "- A real product photo is attached as a STRICT SHAPE TEMPLATE ONLY — treat this as the exact same physical can/bottle object, just re-skinned. Match its exact height-to-diameter ratio, neck taper, rim/lip profile, shoulder curve, and base shape precisely — do not alter the silhouette or proportions in any way. CRITICAL: you must NOT copy ANY surface detail from that photo — no printed text, no logo, no color scheme, and NO decorative pattern, motif, border, stripe, triangle, zigzag, or repeating graphic of ANY kind, even faint, small, or blurred. The entire visible body surface (excluding metal cap/rim/base trim) must be a single flat, uninterrupted block of solid color with zero surface graphics of any kind — copy the reference's SHAPE ONLY, never anything printed or patterned on its surface."
    : "";

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `You are a packaging concept designer for premium beverage brands, generating an early-stage concept mockup for brainstorming with a graphic designer — not a finished product shot.

Product concept: a "${flavorName}" flavor, ${shapeDescriptor}.
${colorInstruction}
Style direction: ${finishText} ${moodText}
${capText ? `Cap: ${capText}.` : ""}
${liquidText ? `Liquid: ${liquidText}.` : ""}
${extra ? `Additional creative direction from the user — follow this closely: ${extra}` : ""}
Scene: ${sceneText}

CRITICAL RULES:
- The label area must be BLANK — a clean solid color or subtle gradient only. NO text, NO logos, NO typography, NO brand name anywhere in the image. Real label artwork will be added separately by the design team as vector graphics. This rule is NON-NEGOTIABLE and overrides anything else in this brief, including the user's own creative direction above — if their request conflicts with it (e.g. asks for a real logo, real brand text, or an actual reference photo that wasn't provided), silently ignore just that conflicting part and proceed anyway with a blank label. Do not point out the conflict.
- This ban includes INVENTED or FAKE text — do not generate, hallucinate, or imply any lettering, numbers, words, or pseudo-typography of any kind, even illegible, blurry, or nonsensical characters. The surface must show zero character-like marks, not just zero real brand text.
${referenceInstruction}
- Describe exact camera settings, lighting, and composition under 100 words.
- You must ALWAYS return a valid image-generation prompt no matter what — never refuse, never ask a clarifying question, never explain a conflict or limitation. There is always enough information here to produce a reasonable concept image.
Return ONLY the final image prompt, nothing else — no explanations, no labels, no questions. End with "professional packaging concept photography, completely blank unlabeled surface, absolutely no text or lettering of any kind, not even fake or illegible characters."`,
    }],
  });
  const text = message.content[0].text.trim();

  // Claude occasionally breaks format under a conflicting custom prompt and returns a
  // refusal/clarifying question instead of an image prompt (confirmed live: a user's custom
  // prompt asking for a real logo triggered a multi-paragraph refusal, which then got fed to
  // Flux as-is, producing a nonsense render). Catch that here instead of silently generating
  // garbage from whatever stray keywords happened to be in the refusal text.
  const looksLikeRefusal =
    /^(i cannot|i can't|i need to|i'm unable|sorry,|unfortunately)/i.test(text) ||
    /would you like me to|please (attach|provide|clarify)|let me know if/i.test(text) ||
    text.includes("?");
  if (looksLikeRefusal) {
    throw new Error("Couldn't generate a valid concept from this prompt — try simplifying or removing conflicting instructions from your custom prompt (e.g. requests for real logos/brand text aren't possible since labels must stay blank).");
  }
  return text;
}

// Prompt-side defenses (banning text in the brief, stripping label content from the shape
// reference) reduce risk but can't guarantee compliance — Flux is trained on huge volumes of
// real product photography where cans/bottles have labels, so it can still hallucinate FAKE
// lettering purely from that bias, independent of what the reference image or prompt say
// (confirmed live: a heavily blurred, textless reference still produced invented gibberish
// text like "355ml ilt Rarnit Storah" in the exact label position). The only reliable backstop
// is checking the actual output and retrying when it fails, rather than trusting any single
// generation to comply.
async function hasVisibleText(imageUrl) {
  const imgRes = await fetch(imageUrl);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString("base64");
  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 10,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        { type: "text", text: "Look closely at the product's surface (can/bottle body, cap, label area) in this image. Does it show ANY visible text, letters, numbers, words, or pseudo-typography anywhere — even if small, blurry, faint, fake, or illegible? Ignore condensation droplets, reflections, and lighting — only count actual character-like marks. Answer with exactly one word: YES or NO." },
      ],
    }],
  });
  const answer = (message.content[0].text || "").trim().toUpperCase();
  return answer.startsWith("YES");
}

const MAX_CONCEPT_ATTEMPTS = 3;

async function generateConceptMockup({ flavorName, colorHex, format, sceneId, customScene, finish, mood, exampleId, capColor, liquidVisibility, referenceImageUrl, productImageUrl, customPrompt, userId, userEmail }) {
  const shapeDescriptor = conceptShapeDescriptors[format];
  if (!shapeDescriptor) throw new Error("Invalid format");

  let sceneText;
  if (customScene && customScene.trim()) {
    sceneText = customScene.trim();
  } else {
    const scene = (conceptSceneTemplates[format] || []).find((s) => s.id === sceneId);
    if (!scene) throw new Error("Unknown scene template");
    sceneText = scene.prompt;
  }

  let finishKey = finish, moodKey = mood, extra = customPrompt || null;
  if (exampleId) {
    const example = conceptExamplePrompts.find((e) => e.id === exampleId);
    if (!example) throw new Error("Unknown example prompt");
    finishKey = example.finish; moodKey = example.mood; extra = example.extra;
  }
  const finishText = conceptFinishes[finishKey];
  const moodText = conceptMoods[moodKey];
  if (!finishText || !moodText) throw new Error("Invalid finish or mood");

  const isBottle = format === "bottle750" || format === "bottle114";
  const liquidKey = isBottle ? liquidVisibility || "visible" : null;
  const liquidText = isBottle ? conceptLiquidVisibility[liquidKey] || conceptLiquidVisibility.visible : null;

  // Bottles whose glass reads as clear (the "visible" liquid default) have no real body
  // color left for "matches body" to point at — Claude was resolving it to the LIQUID color
  // instead, producing e.g. a wine-red cap on a bottle whose real cap is natural wood, unrelated
  // to liquid color. Fall back to wood (the actual closure used across the real Cherry River
  // 750mL/1.14L line) for "matches_body" specifically when the glass is clear; opaque-coated
  // bottles (liquidVisibility "opaque") keep matching their real body color as before.
  const capKey = capColor || "matches_body";
  const capText = !isBottle
    ? null
    : capKey === "matches_body" && liquidKey !== "opaque"
    ? conceptCapColors.wood
    : conceptCapColors[capKey] || conceptCapColors.matches_body;

  // Priority: an already-generated board tile (color/finish consistency) beats the user's
  // selected catalog product photo (shape only), which beats the generic per-format stand-in.
  const shapeReferenceUrl = referenceImageUrl || productImageUrl || conceptShapeReferenceImages[format];
  const referenceMode = referenceImageUrl ? "consistency" : shapeReferenceUrl ? "shape" : null;

  // The catalog's stored `color` is often a label ACCENT, not the product's true dominant
  // body color — sample the real photo directly when one exists (skip for board-consistency
  // tiles, which already inherit their color from the master tile's own prompt).
  let effectiveColorHex = colorHex;
  if (productImageUrl && !referenceImageUrl) {
    const dominant = await getDominantColor(productImageUrl);
    if (dominant) effectiveColorHex = dominant;
  }

  // Bottles whose glass reads as clear (the "visible" liquid default) have no real body
  // color to extract — getDominantColor's crop instead samples whatever's behind the glass
  // (liquid, or the dark studio backdrop bleeding through), which produced a false gray-blue
  // glass tint on real clear bottles (confirmed: two unrelated clear bottles both landed on
  // #747e8a). Redirect the extracted tone to the liquid instead, and force the glass itself
  // to stay clear/colorless. Opaque-coated bottles (liquidVisibility "opaque") keep the old
  // body-tint behavior, which is correct for them (verified on Averse Rhum Ambré).
  const colorRole = isBottle && liquidKey !== "opaque" ? "liquid" : "body";

  const enhancedPrompt = await enhanceConceptPrompt({
    flavorName, colorHex: effectiveColorHex, colorRole, shapeDescriptor, finishText, moodText, sceneText, extra, capText, liquidText,
    referenceMode,
  });

  const inputPayload = {
    prompt: enhancedPrompt,
    resolution: "4 MP",
    // Cans/bottles are tall & slim — a square canvas forces Flux to squash the real proportions
    // to fit the frame. Portrait 4:5 gives the subject room to render at its true aspect ratio.
    aspect_ratio: "4:5",
    output_format: "png",
    output_quality: 100,
    safety_tolerance: 5,
    guidance: 3,
    prompt_upsampling: true,
  };
  if (shapeReferenceUrl) {
    // "shape" mode references a REAL product photo (or generic stand-in) — strip its printed
    // content before Flux sees it. "consistency" mode references our OWN previously-generated
    // (already blank-label) board tile, so there's no real label to leak — skip processing.
    inputPayload.input_images = [
      referenceMode === "shape" ? await getFlatSilhouette(shapeReferenceUrl) : shapeReferenceUrl,
    ];
  }

  // Generate, then verify with a vision check before trusting the output — retry on failure
  // rather than risk shipping a mockup with hallucinated text (see hasVisibleText comment above).
  let replicateUrl, attempts = 0, textDetected = true;
  while (attempts < MAX_CONCEPT_ATTEMPTS) {
    attempts++;
    const output = await replicate.run("black-forest-labs/flux-2-pro", { input: inputPayload });
    replicateUrl = output.url ? output.url() : String(output);
    textDetected = await hasVisibleText(replicateUrl);
    if (!textDetected) break;
    console.warn(`Concept mockup attempt ${attempts}/${MAX_CONCEPT_ATTEMPTS} for "${flavorName}" showed visible text/lettering — retrying...`);
  }
  if (textDetected) {
    throw new Error(`Generated ${MAX_CONCEPT_ATTEMPTS} attempts and each still showed unwanted text or lettering on the label — try a different style, scene, or reference, or just retry.`);
  }

  const filename = `concept-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
  let image;
  try {
    image = await saveGeneratedImage(replicateUrl, filename);
  } catch (e) {
    console.error("Failed to save concept mockup to storage:", e.message);
    image = replicateUrl;
  }

  const row = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    url: image,
    product: `Concept: ${flavorName}`,
    color: effectiveColorHex || "#888888",
    prompt: enhancedPrompt,
    type: "image",
    date: new Date().toISOString(),
    user_id: userId,
    user_email: userEmail,
    cost_usd: Math.round(FLUX_COST_PER_IMAGE * attempts * 1000) / 1000,
  };
  const { data: savedGeneration, error } = await insertGeneration(row);
  if (error) throw error;

  return { image, enhancedPrompt, savedGeneration, effectiveColorHex };
}

app.post("/api/generate-concept-scene", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { flavorName, colorHex, format, sceneId, customScene, finish, mood, exampleId, capColor, liquidVisibility, referenceImageUrl, productImageUrl, customPrompt } = req.body;
    if (!flavorName || !flavorName.trim()) return res.status(400).json({ success: false, error: "Flavor name is required" });
    if (!sceneId && !(customScene && customScene.trim())) return res.status(400).json({ success: false, error: "A scene selection or custom scene description is required" });

    const { image, enhancedPrompt, savedGeneration, effectiveColorHex } = await generateConceptMockup({
      flavorName: flavorName.trim(), colorHex, format, sceneId, customScene, finish, mood, exampleId, capColor, liquidVisibility, referenceImageUrl, productImageUrl, customPrompt,
      userId: user.id, userEmail: user.email,
    });

    res.json({ success: true, image, enhancedPrompt, generation: savedGeneration, effectiveColorHex });
  } catch (error) {
    console.error("Concept scene generation error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to generate concept mockup" });
  }
});

// Generate the same scene+style for one flavor across all 8 scene angles at once (concept board).
// Generates one master reference shot first, then locks every other angle to it via Flux input_images
// so the design (color/finish/proportions) stays identical across all 8 — only the scene changes.
app.post("/api/generate-concept-board", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { flavorName, colorHex, format, finish, mood, exampleId, capColor, liquidVisibility, productImageUrl, customPrompt } = req.body;
    if (!flavorName || !flavorName.trim()) return res.status(400).json({ success: false, error: "Flavor name is required" });
    const sceneList = conceptSceneTemplates[format];
    if (!sceneList) return res.status(400).json({ success: false, error: "Invalid format" });

    const [masterScene, ...restScenes] = sceneList;
    const results = [];
    let referenceImageUrl = null;

    // The master tile's dominant-color extraction (getDominantColor on the real product photo)
    // is the only correct color signal here — the raw `colorHex` from the request is the
    // catalog's stored accent color, which is frequently stale/wrong (confirmed: CR Margarita SA
    // 355mL's stored color is a leftover light-green while the real can is near-black). Every
    // other tile must inherit the MASTER's resolved color, not the raw request value, or its
    // "brand color inspiration" instruction actively contradicts the "match the reference image
    // exactly" instruction — Flux was inconsistently obeying one or the other tile to tile,
    // which is why some board tiles rendered black and others rendered green.
    let boardColorHex = colorHex;

    try {
      const { image, enhancedPrompt, effectiveColorHex } = await generateConceptMockup({
        flavorName: flavorName.trim(), colorHex, format, sceneId: masterScene.id, finish, mood, exampleId, capColor, liquidVisibility, productImageUrl, customPrompt,
        userId: user.id, userEmail: user.email,
      });
      referenceImageUrl = image;
      if (effectiveColorHex) boardColorHex = effectiveColorHex;
      results.push({ sceneId: masterScene.id, sceneName: masterScene.name, success: true, image, enhancedPrompt });
    } catch (e) {
      console.error(`Board master generation failed for scene ${masterScene.id}:`, e.message);
      results.push({ sceneId: masterScene.id, sceneName: masterScene.name, success: false, error: e.message });
    }

    const CONCURRENCY = 3;
    for (let i = 0; i < restScenes.length; i += CONCURRENCY) {
      const batch = restScenes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (scene) => {
          try {
            const { image, enhancedPrompt } = await generateConceptMockup({
              flavorName: flavorName.trim(), colorHex: boardColorHex, format, sceneId: scene.id, finish, mood, exampleId, capColor, liquidVisibility, referenceImageUrl, productImageUrl, customPrompt,
              userId: user.id, userEmail: user.email,
            });
            return { sceneId: scene.id, sceneName: scene.name, success: true, image, enhancedPrompt };
          } catch (e) {
            console.error(`Board generation failed for scene ${scene.id}:`, e.message);
            return { sceneId: scene.id, sceneName: scene.name, success: false, error: e.message };
          }
        })
      );
      results.push(...batchResults);
    }

    res.json({ success: true, results, resolvedColorHex: boardColorHex });
  } catch (error) {
    console.error("Concept board generation error:", error);
    res.status(500).json({ success: false, error: error.message || "Board generation failed" });
  }
});

// Generate the same scene+style across multiple flavors in one session (collection launch)
app.post("/api/generate-concept-batch", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { flavors, format, sceneId, customScene, finish, mood, exampleId, capColor, liquidVisibility, customPrompt } = req.body;
    if (!Array.isArray(flavors) || flavors.length === 0) {
      return res.status(400).json({ success: false, error: "No flavors selected" });
    }
    if (!sceneId && !(customScene && customScene.trim())) {
      return res.status(400).json({ success: false, error: "A scene selection or custom scene description is required" });
    }

    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < flavors.length; i += CONCURRENCY) {
      const batch = flavors.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (flavor) => {
          try {
            const { image, enhancedPrompt } = await generateConceptMockup({
              flavorName: flavor.flavorName, colorHex: flavor.colorHex, format, sceneId, customScene, finish, mood, exampleId, capColor, liquidVisibility, productImageUrl: flavor.productImage, customPrompt,
              userId: user.id, userEmail: user.email,
            });
            return { flavorName: flavor.flavorName, success: true, image, enhancedPrompt };
          } catch (e) {
            console.error(`Batch concept generation failed for ${flavor.flavorName}:`, e.message);
            return { flavorName: flavor.flavorName, success: false, error: e.message };
          }
        })
      );
      results.push(...batchResults);
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error("Concept batch generation error:", error);
    res.status(500).json({ success: false, error: error.message || "Batch generation failed" });
  }
});

// Core image generation pipeline — used by /api/generate-image (existing marketing photography pipeline)
async function generateProductImage({ product, productName, productColor, userPrompt, format, quality, quantity, userId, userEmail }) {
  const aspect_ratio = aspectRatioMap[format] || "1:1";
  const isCan = product && product.product_type === "can";
  const isAverseImg = product?.name?.toLowerCase().includes("averse");

  let enhancedPrompt;
  try {
    enhancedPrompt = await enhancePrompt(userPrompt, product);
  } catch (e) {
    console.error("Prompt enhancement failed:", e.message);
    enhancedPrompt = userPrompt;
  }

  const canPrefix = isCan
    ? "tall slim 355ml cylindrical aluminum beverage can standing perfectly upright at 90 degrees, exact same can design and label as the reference image, label text sharp and undistorted, "
    : isAverseImg
    ? "frosted matte white elongated spirit bottle standing perfectly upright, distinctive colored dome-shaped base cap, minimalist 'a|v|e|r|s|e' architectural label with pipe separators, Cherry River dome cap branding, label text sharp and undistorted, "
    : "";
  const prompt = canPrefix + enhancedPrompt;

  const inputPayload = {
    prompt,
    resolution: "4 MP",
    aspect_ratio,
    output_format: "png",
    output_quality: 100,
    safety_tolerance: 5,
    guidance: isCan ? 4 : 3,
    prompt_upsampling: true,
  };

  if (product && product.image) {
    inputPayload.input_images = [product.image];
  }

  const count = Math.min(quantity || 1, 4);
  const promises = Array.from({ length: count }, () =>
    replicate.run("black-forest-labs/flux-2-pro", { input: inputPayload })
  );

  const results = await Promise.all(promises);
  const replicateUrls = results.map((output) => (output.url ? output.url() : String(output)));

  const images = await Promise.all(
    replicateUrls.map(async (url, i) => {
      const filename = `gen-${Date.now()}-${i}.png`;
      try {
        return await saveGeneratedImage(url, filename);
      } catch (e) {
        console.error("Failed to save generated image to storage:", e.message);
        return url;
      }
    })
  );

  const rows = images.map((url) => ({
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    url,
    product: productName,
    color: productColor || "#888888",
    prompt,
    type: "image",
    date: new Date().toISOString(),
    user_id: userId,
    user_email: userEmail,
    cost_usd: FLUX_COST_PER_IMAGE,
  }));

  const { data: savedGenerations, error } = await insertGenerations(rows);
  if (error) throw error;

  return { images, enhancedPrompt, savedGenerations };
}

// Extract authenticated user ID from Bearer token
async function getUserId(req) {
  const token = extractAccessToken(req.headers)
  if (!token) return null
  const { data: { user } } = await supabase.auth.getUser(token)
  return user?.id || null
}

async function getUser(req) {
  return resolveAuthenticatedUser(req, {
    localAuth: async (token) => {
      const { data: { user } } = await supabase.auth.getUser(token)
      return user || null
    },
  })
}

async function insertGeneration(row) {
  const { data, error } = await supabase.from("generations").insert(row).select().single()
  if (error && error.message && error.message.includes('user_email')) {
    const { user_email, ...rowWithout } = row
    return supabase.from("generations").insert(rowWithout).select().single()
  }
  return { data, error }
}

async function insertGenerations(rows) {
  const { data, error } = await supabase.from("generations").insert(rows).select()
  if (error && error.message && error.message.includes('user_email')) {
    const sanitized = rows.map(({ user_email, ...r }) => r)
    return supabase.from("generations").insert(sanitized).select()
  }
  return { data, error }
}

// --- Auth: Signup (auto-confirm, no email verification) ---
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data.user });
});

// --- Products ---

app.get("/api/products", async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  // Map snake_case → camelCase for frontend
  res.json(data.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    color: p.color,
    image: p.image,
    productType: p.product_type,
    status: p.status,
  })));
});

// Generic upload used by Concept Studio's "New Flavor Idea" optional reference photo —
// not tied to the products table, just returns a storage URL for use as a Flux shape reference.
app.post("/api/upload-reference", upload.single("image"), async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!req.file) return res.status(400).json({ error: "No image file provided" });

  const ext = req.file.originalname.split(".").pop();
  const filename = `concept-references/ref-${Date.now()}.${ext}`;
  try {
    const url = await uploadToStorage(req.file.buffer, req.file.mimetype, filename);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/products", upload.single("image"), async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { name, category, color, status, productType } = req.body;
  if (!name || !category || !color) {
    return res.status(400).json({ error: "name, category, and color are required" });
  }

  let imageUrl = null;
  if (req.file) {
    const ext = req.file.originalname.split(".").pop();
    const filename = `product-${Date.now()}.${ext}`;
    try {
      imageUrl = await uploadToStorage(req.file.buffer, req.file.mimetype, filename);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const id = Date.now().toString();
  const { data, error } = await supabase
    .from("products")
    .insert({ id, name, category, color, image: imageUrl, product_type: productType || "bottle", status: status || "ready", user_id: userId })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    id: data.id, name: data.name, category: data.category,
    color: data.color, image: data.image, productType: data.product_type, status: data.status,
  });
});

app.post("/api/products/:id/image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image file provided" });

  const { data: product } = await supabase.from("products").select("*").eq("id", req.params.id).single();
  if (!product) return res.status(404).json({ error: "Product not found" });

  // Delete old image from storage
  if (product.image && product.image.includes(BUCKET)) {
    const oldPath = product.image.split(`${BUCKET}/`)[1];
    await supabase.storage.from(BUCKET).remove([oldPath]);
  }

  const ext = req.file.originalname.split(".").pop();
  const filename = `product-${Date.now()}.${ext}`;
  let imageUrl;
  try {
    imageUrl = await uploadToStorage(req.file.buffer, req.file.mimetype, filename);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const { data, error } = await supabase
    .from("products")
    .update({ image: imageUrl })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    id: data.id, name: data.name, category: data.category,
    color: data.color, image: data.image, productType: data.product_type, status: data.status,
  });
});

app.delete("/api/products/:id", async (req, res) => {
  const { data: product } = await supabase.from("products").select("*").eq("id", req.params.id).single();
  if (!product) return res.status(404).json({ error: "Product not found" });

  // Delete image from storage
  if (product.image && product.image.includes(BUCKET)) {
    const storagePath = product.image.split(`${BUCKET}/`)[1];
    await supabase.storage.from(BUCKET).remove([storagePath]);
  }

  const userId = await getUserId(req)
  if (!userId || product.user_id !== userId) return res.status(403).json({ error: "Forbidden" })

  const { error } = await supabase.from("products").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ id: product.id, name: product.name });
});

// --- Generations ---

app.get("/api/generations", async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  let query = supabase.from("generations").select("*").eq("user_id", userId).order("date", { ascending: false });
  const limit = parseInt(req.query.limit);
  if (limit && limit > 0) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/generations/team", async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  let query = supabase.from("generations").select("*").order("date", { ascending: false })
  const limit = parseInt(req.query.limit)
  if (limit && limit > 0) query = query.limit(limit)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post("/api/generations", async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: "Unauthorized" })
  const { url, productName, productColor, sceneName, type, cost_usd } = req.body;
  if (!url || !productName) return res.status(400).json({ error: "url and productName are required" });

  const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
  const { data, error } = await insertGeneration({ id, url, product: productName, color: productColor || "#888888", scene: sceneName || "", type: type || "image", date: new Date().toISOString(), user_id: user.id, user_email: user.email, cost_usd: cost_usd || 0 });

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.delete("/api/generations/:id", async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { data: gen } = await supabase.from("generations").select("*").eq("id", req.params.id).single();
  if (!gen) return res.status(404).json({ error: "Generation not found" });
  if (gen.user_id !== userId) return res.status(403).json({ error: "Forbidden" })

  const { error } = await supabase.from("generations").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json(gen);
});

// --- Stats ---

app.get("/api/stats", async (req, res) => {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const [{ data: generations }, { data: products }] = await Promise.all([
    supabase.from("generations").select("type, date, cost_usd").eq("user_id", userId),
    supabase.from("products").select("id").eq("user_id", userId),
  ]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const gens = generations || [];
  const thisMonthGens = gens.filter((g) => new Date(g.date) >= new Date(startOfMonth));

  res.json({
    images: gens.filter((g) => g.type === "image").length,
    videos: gens.filter((g) => g.type === "video").length,
    products: (products || []).length,
    thisMonth: thisMonthGens.length,
    thisMonthSpent: parseFloat(thisMonthGens.reduce((s, g) => s + (parseFloat(g.cost_usd) || 0), 0).toFixed(2)),
    totalSpent: parseFloat(gens.reduce((s, g) => s + (parseFloat(g.cost_usd) || 0), 0).toFixed(2)),
  });
});

// --- Image Generation ---

async function enhanceCollectionPrompt(products, userPrompt) {
  const userContent = []
  for (const product of products) {
    if (product.image) {
      try {
        const imgResp = await fetch(product.image)
        if (imgResp.ok) {
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer())
          const base64 = imgBuffer.toString("base64")
          const contentType = imgResp.headers.get("content-type") || "image/jpeg"
          userContent.push({ type: "image", source: { type: "base64", media_type: contentType, data: base64 } })
          userContent.push({ type: "text", text: `Product: "${product.name}"` })
        }
      } catch (e) {
        console.error("Failed to fetch product image for collection:", e.message)
      }
    }
  }
  const hasCans = products.some(p => p.product_type === "can")
  const hasBottles = products.some(p => p.product_type !== "can")
  const productNames = products.map(p => p.name).join(", ")
  userContent.push({
    type: "text",
    text: `You are a world-class product photography director for Cherry River premium beverages.
Study each product image above carefully.

Write a professional photography brief for a COLLECTION SHOT featuring all ${products.length} products together in one styled scene.

Reference style: De Soi editorial — products at different heights on natural props as risers.

${userPrompt ? `Client direction: ${userPrompt}\n\n` : ""}COMPOSITION RULES:
- Each product UPRIGHT at a DIFFERENT HEIGHT: upturned wine glass, textured glass block, stone slab, wooden board as risers
- Every label facing camera, fully readable
${hasCans ? "- Cans: perfectly vertical 90°, label undistorted\n" : ""}${hasBottles ? "- Bottles: upright, label sharp and clear\n" : ""}- Seasonal props scattered naturally: fresh fruits matching each flavor, botanical garnishes, flower petals
- Warm beige/clay background, soft directional natural light from left
- Stone or concrete surface
- Magazine lifestyle editorial quality, one hand reaching in from top (optional)

Products featured: ${productNames}

Under 150 words. Return ONLY the photography brief.`
  })

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: userContent }],
  })
  return message.content[0].text.trim()
}

app.post("/api/generate-collection", async (req, res) => {
  try {
    const user = await getUser(req)
    if (!user) return res.status(401).json({ error: "Unauthorized" })
    const { productIds, format, prompt: userPrompt } = req.body
    if (!productIds || productIds.length < 2) return res.status(400).json({ error: "Select 2–4 products" })

    const { data: products, error: pErr } = await supabase.from("products").select("*").in("id", productIds)
    if (pErr || !products || products.length === 0) return res.status(500).json({ error: "Failed to fetch products" })

    const enhancedPrompt = await enhanceCollectionPrompt(products, userPrompt)
    const aspect_ratio = aspectRatioMap[format] || "1:1"
    const input_images = products.filter(p => p.image).map(p => p.image)

    const inputPayload = {
      prompt: enhancedPrompt,
      resolution: "4 MP",
      aspect_ratio,
      output_format: "png",
      output_quality: 100,
      safety_tolerance: 5,
      guidance: 3.5,
      prompt_upsampling: true,
    }
    if (input_images.length > 0) inputPayload.input_images = input_images

    const output = await replicate.run("black-forest-labs/flux-2-pro", { input: inputPayload })
    const replicateUrl = output.url ? output.url() : String(output)

    const filename = `collection-${Date.now()}.png`
    let finalUrl
    try { finalUrl = await saveGeneratedImage(replicateUrl, filename) }
    catch (e) { finalUrl = replicateUrl }

    const productNamesStr = products.map(p => p.name).join(", ")
    await insertGeneration({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      url: finalUrl,
      product: `Collection: ${productNamesStr.slice(0, 80)}`,
      color: products[0]?.color || "#888888",
      prompt: enhancedPrompt,
      type: "image",
      date: new Date().toISOString(),
      user_id: user.id,
      user_email: user.email,
      cost_usd: FLUX_COST_PER_IMAGE,
    })

    res.json({ success: true, image: finalUrl, enhancedPrompt })
  } catch (error) {
    console.error("Collection generation error:", error)
    res.status(500).json({ success: false, error: error.message || "Failed to generate collection" })
  }
})

app.post("/api/generate-free-scene", async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { prompt: userPrompt, format } = req.body;
    if (!userPrompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

    let enhancedPrompt;
    try {
      const msg = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: [{ type: "text", text: `You are a world-class advertising photography director for premium beverage brands.
Enhance this prompt into a professional photography brief. Keep it under 120 words.
Return ONLY the enhanced prompt — no explanations, no labels.

User prompt: ${userPrompt}

Rules:
- Keep the user's core scene and concept
- Add: exact lighting details, camera settings (f-stop, depth of field), mood, color palette, photographic style
- Make it specific and vivid, ready for a professional AI image generator
- End with: "professional beverage advertising photography"` }] }],
      });
      enhancedPrompt = msg.content[0].text.trim();
    } catch (e) {
      console.error("Free scene prompt enhancement failed:", e.message);
      enhancedPrompt = userPrompt;
    }

    const aspect_ratio = aspectRatioMap[format] || "1:1";
    const output = await replicate.run("black-forest-labs/flux-2-pro", {
      input: {
        prompt: enhancedPrompt,
        resolution: "4 MP",
        aspect_ratio,
        output_format: "png",
        output_quality: 100,
        safety_tolerance: 5,
        guidance: 3.5,
        prompt_upsampling: true,
      },
    });

    const replicateUrl = output.url ? output.url() : String(output);
    const filename = `freescene-${Date.now()}.png`;
    let finalUrl;
    try { finalUrl = await saveGeneratedImage(replicateUrl, filename); }
    catch (e) { finalUrl = replicateUrl; }

    await insertGeneration({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      url: finalUrl,
      product: "Free Scene",
      color: "#888888",
      prompt: enhancedPrompt,
      type: "image",
      date: new Date().toISOString(),
      user_id: user.id,
      user_email: user.email,
      cost_usd: FLUX_COST_PER_IMAGE,
    });

    res.json({ success: true, image: finalUrl, enhancedPrompt });
  } catch (error) {
    console.error("Free scene generation error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to generate image" });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const user = await getUser(req)
    if (!user) return res.status(401).json({ error: "Unauthorized" })
    const { productName, productColor, productId, prompt: userPrompt, format, quality, quantity } = req.body;

    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .maybeSingle();

    const { images, enhancedPrompt, savedGenerations } = await generateProductImage({
      product,
      productName,
      productColor,
      userPrompt: userPrompt || `A premium product photo of "${productName}"`,
      format,
      quality,
      quantity,
      userId: user.id,
      userEmail: user.email,
    });

    res.json({ success: true, images, generations: savedGenerations, enhancedPrompt });
  } catch (error) {
    console.error("Generation error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to generate image" });
  }
});

// HERO AD queues local Remotion work only. No Chromium/FFmpeg render runs on Vercel.
app.post("/api/generate-ad", createGenerateAdHandler({
  supabase,
  getUser,
  piApiKey: process.env.PIAPI_API_KEY,
}));


// --- Video Generation ---

// In-memory map tracking background watermark removal jobs
// { taskId -> { status: 'processing'|'done'|'failed', videoUrl?, error? } }
const wmTasks = new Map();

// Cache of submitted PiAPI payloads keyed by taskId — used for OutputAudioRisk auto-retry
const taskCache = new Map();

// Top-level Supabase video upload (used by both WM removal and fallback paths)
async function uploadVideoToSupabase(buffer, taskId) {
  const filename = `${taskId}.mp4`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(filename, buffer, { contentType: "video/mp4", upsert: true });
  if (uploadError) throw new Error(`Supabase upload: ${uploadError.message}`);
  const { data: { publicUrl } } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(uploadData.path);
  return publicUrl;
}

// Starts watermark removal in the background — returns immediately.
// Stores result in wmTasks so polling can pick it up.
function startWatermarkRemovalBackground(taskId, rawVideoUrl) {
  if (wmTasks.has(taskId)) return; // already started
  wmTasks.set(taskId, { status: "processing" });

  (async () => {
    try {
      console.log(`[WM] Starting background removal for ${taskId}`);
      const cleanUrl = await removeWatermarkWithFfmpeg(rawVideoUrl, taskId);
      wmTasks.set(taskId, { status: "done", videoUrl: cleanUrl });
      console.log(`[WM] Done: ${cleanUrl}`);
    } catch (err) {
      console.error(`[WM] Removal failed for ${taskId}:`, err.message);
      // Fallback: download original and upload to Supabase
      try {
        const resp = await fetch(rawVideoUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const fallbackUrl = await uploadVideoToSupabase(buf, taskId);
          wmTasks.set(taskId, { status: "done", videoUrl: fallbackUrl });
          console.log(`[WM] Fallback saved: ${fallbackUrl}`);
        } else {
          wmTasks.set(taskId, { status: "done", videoUrl: rawVideoUrl });
        }
      } catch {
        wmTasks.set(taskId, { status: "done", videoUrl: rawVideoUrl });
      }
    }
  })();
}

// Remove Seedance "AI" watermark using ffmpeg delogo filter.
// Watermark is always in the TOP-LEFT corner of Seedance videos.
async function removeWatermarkWithFfmpeg(videoUrl, taskId) {
  const tmpIn  = join(tmpdir(), `cr_wm_in_${taskId}.mp4`);
  const tmpOut = join(tmpdir(), `cr_wm_out_${taskId}.mp4`);

  // Download video to temp file
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`WM download failed: ${resp.status}`);
  await writeFile(tmpIn, Buffer.from(await resp.arrayBuffer()));

  // Probe dimensions via ffmpeg stderr (works on Vercel — no ffprobe needed)
  const probeErr = await execFileAsync(FFMPEG_PATH, ["-i", tmpIn], { timeout: 30_000 }).catch(e => e);
  const dimMatch = (probeErr.stderr || probeErr.message || "").match(/(\d{3,4})x(\d{3,4})/);
  const vw = dimMatch ? parseInt(dimMatch[1]) : 834;
  const vh = dimMatch ? parseInt(dimMatch[2]) : 1112;

  // Seedance watermark: TOP-LEFT corner ~15% width x 10% height
  // x=2,y=2 because delogo cannot touch the frame edge (0)
  const dw = Math.floor(vw * 0.15) - 2;
  const dh = Math.floor(vh * 0.10) - 2;
  console.log(`[WM] delogo top-left: w=${dw} h=${dh} (video ${vw}x${vh})`);

  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", tmpIn,
    "-vf", `delogo=x=2:y=2:w=${dw}:h=${dh}:show=0`,
    "-c:v", "libx264", "-crf", "18", "-preset", "fast",
    "-pix_fmt", "yuv420p", "-c:a", "copy",
    "-movflags", "+faststart",
    tmpOut,
  ], { timeout: 300_000 });

  // Upload clean video to Supabase
  const cleanBuffer = await readFile(tmpOut);
  const filename = `${taskId}.mp4`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(filename, cleanBuffer, { contentType: "video/mp4", upsert: true });
  if (uploadError) throw new Error(`Supabase upload: ${uploadError.message}`);
  const { data: { publicUrl } } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(uploadData.path);

  // Cleanup temp files (non-blocking)
  Promise.all([unlink(tmpIn).catch(() => {}), unlink(tmpOut).catch(() => {})]);

  return publicUrl;
}

// ── CAN FLAVOR PRESETS — Francis Visual DNA Brief (Apr 2026) ──

function isAlcoholicCan(product) {
  const cat = (product.category || "").toLowerCase();
  const name = (product.name || "").toLowerCase();
  if (cat.includes("sans alcool") || cat.includes("non-alc") || cat.includes("non-alcoholic")) return false;
  if (name.includes("sans alcool") || name.includes("non-alc")) return false;
  return true;
}

const canFlavorPresets = [
  {
    id: "vodka_limonade",
    detect: n => (n.includes("limonade") || n.includes("lemonade")) && (n.includes("vodka") || n.includes("non-petillante")),
    heroScene: "Sunny wooden dock at the edge of a calm lake at noon in summer. Perspiring can resting on a weathered dock railing, halved lemon slices falling in slow motion toward the still water below, golden sunlight refracting through the liquid",
    colorPalette: "vivid lemon yellow + brilliant white + sky blue + warm natural wood",
    props: "halved lemon slices, condensation droplets, weathered wood dock planks, calm mirror-like lake water, golden noon sunlight",
    motionStyle: "slow-motion lemon drop toward still lake water, water ripple spreading outward, golden light refracting — STILL liquid, absolutely NO carbonation bubbles, NO fizz",
    keyNote: "CRITICAL: Still liquid — NO bubbles, NO carbonation fizz. Smooth calm water and liquid only.",
    isNonAlcoholic: false,
  },
  {
    id: "orange_sanguine",
    detect: n => (n.includes("orange") && n.includes("sanguine")) || (n.includes("orange") && n.includes("framboise") && n.includes("355")),
    heroScene: "Bright midday poolside terrace in direct summer sun. Can placed on a colorful beach towel near a pool edge, blood orange wedges and fresh raspberries exploding in a vivid juice burst frozen in the air around the can",
    colorPalette: "deep blood orange + vivid coral orange + raspberry pink + brilliant white + direct midday sunshine",
    props: "blood orange wedges, whole fresh raspberries, frozen water droplets in air, pool edge or bright beach towel, sharp direct midday sunlight",
    motionStyle: "high-speed freeze of fruit burst explosion, water droplets suspended mid-air, direct sunlight creating brilliant specular highlights on fruit and can",
    keyNote: "NO powdered sugar, NO syrup, NO dessert props. Pure fresh fruit, pure water, clean energy.",
    isNonAlcoholic: false,
  },
  {
    id: "petits_fruits_basilic",
    detect: n => n.includes("basilic") || n.includes("petits fruits") || n.includes("petits-fruits"),
    heroScene: "Chic urban rooftop terrace on a warm summer evening. White marble bistro table, a single lit candle, fresh bright green basil leaves and red berries scattered casually around the can, soft warm ambient terrace evening lighting",
    colorPalette: "deep purple mauve + fresh basil green + marble white + raspberry pink + warm candlelight amber",
    props: "fresh basil sprigs, mixed red berries (raspberries, blueberries, strawberries), white marble bistro table, lit candle, soft warm ambient evening light",
    motionStyle: "herb micro-flutter in warm summer air, condensation drop sliding down can surface, candlelight flicker reflecting on aluminum",
    isNonAlcoholic: false,
  },
  {
    id: "pamplemousse_rose",
    detect: n => n.includes("pamplemousse") || (n.includes("grapefruit") && (n.includes("rose") || n.includes("pink"))),
    heroScene: "Outdoor summer party at a lake house patio or beach club in golden hour light. Can surrounded by vivid halved pink grapefruit slices, condensation streaming down cold aluminum in summer heat",
    colorPalette: "vivid hot pink + coral pink + white + warm golden summer light",
    props: "halved pink grapefruit slices, grapefruit wedges, condensation droplets streaming down can, warm golden outdoor summer light",
    motionStyle: "condensation streaming down cold aluminum, pink grapefruit halves falling through the air, warm golden light refracting off can surface",
    isNonAlcoholic: false,
  },
  {
    id: "sangria",
    detect: n => n.includes("sangria"),
    heroScene: "Late afternoon Mediterranean terrace, low rattan coffee table, warm golden hour raking light, relaxed aperitivo atmosphere",
    colorPalette: "deep Bordeaux red + warm orange + golden amber + warm Mediterranean afternoon light",
    props: "orange slices, fresh red berries, rattan coffee table surface, golden hour raking light, Mediterranean terrace setting",
    motionStyle: "gentle condensation drip down can side, orange slice rolling to rest beside the can, warm afternoon light sweeping across aluminum surface",
    isNonAlcoholic: true,
  },
  {
    id: "canneberge",
    detect: n => n.includes("canneberge") || n.includes("cranberry"),
    heroScene: "Active outdoor lakeside dock in bright morning light, can resting on a weathered wooden dock plank or paddle, crystal clear lake water glittering in the background",
    colorPalette: "vivid cranberry red + brilliant white + sky blue + natural dock wood tones",
    props: "fresh whole cranberries, wooden dock plank surface, crystal clear lake water in background, bright morning sunlight",
    motionStyle: "cranberries rolling and bouncing around the can, condensation on cold aluminum, bright morning light speckling the can surface",
    isNonAlcoholic: true,
  },
  {
    id: "melon_lime",
    detect: n => n.includes("melon") && (n.includes("lime") || n.includes("citron")),
    heroScene: "Sunny morning on a wooden lake dock, fresh melon wedges and lime slices on a light linen beach blanket, sparkling lake water in background, natural morning light through leafy tree canopy",
    colorPalette: "fresh melon green + lime yellow + brilliant white + sky blue + natural wood and linen",
    props: "honeydew melon wedges, fresh lime slices, light linen beach blanket on dock wood, clear sparkling lake water, morning sunlight filtering through tree canopy",
    motionStyle: "melon wedge dropping into clear lake water creating a clean splash, lime wedge beside it, gentle water ripple spreading, morning dew visible on aluminum surface",
    keyNote: "Fresh, clean, health-forward — nature-centric not party-centric.",
    isNonAlcoholic: true,
  },
  {
    id: "mojito_nonalc",
    detect: n => n.includes("mojito"),
    heroScene: "High-end outdoor bar counter at night, dark polished wood surface, can with a fresh mint sprig and raw sugarcane stick beside it, artisanal clear ice cube nearby, warm overhead spot light",
    colorPalette: "vivid lime green + fresh mint white + dark polished bar wood + warm amber spot lighting",
    props: "fresh mint sprigs, raw sugarcane stick, artisanal clear ice cube, dark polished wood bar counter, cocktail shaker in soft background bokeh, overhead spot lighting",
    motionStyle: "fresh mint sprig placement beside can, single condensation trail sliding down can, warm spot light reflection drifting across aluminum surface",
    isNonAlcoholic: true,
  },
  {
    id: "margarita_nonalc",
    detect: n => n.includes("margarita"),
    heroScene: "Upscale outdoor bar or rooftop terrace, natural stone surface, can with a lime wedge and salt-rimmed glass beside it, artisanal ice, warm cocktail atmosphere",
    colorPalette: "bright lime yellow + sea salt white + lime green + natural stone warm tones + cocktail bar amber light",
    props: "lime rounds, sea salt on nearby glass rim, artisanal clear ice cubes, natural stone counter surface, warm amber cocktail bar lighting",
    motionStyle: "lime wedge placement beside can, condensation on cold aluminum surface, sea salt crystals catching the warm light",
    isNonAlcoholic: true,
  },
  {
    id: "cosmo_nonalc",
    detect: n => n.includes("cosmo"),
    heroScene: "Upscale rooftop bar at dusk, dark sophisticated bar surface, can with orange zest garnish and fresh cranberries artfully placed beside it, soft city light bokeh in background",
    colorPalette: "cranberry red + orange amber + deep dark background + soft city lights bokeh",
    props: "fresh cranberries, orange zest curl, dark sophisticated bar surface, soft city bokeh lights, warm amber spot lighting on can",
    motionStyle: "orange zest curl unfurling slowly, fresh cranberries settling beside can, city light bokeh softly shifting in background",
    isNonAlcoholic: true,
  },
  {
    id: "amaretto_nonalc",
    detect: n => n.includes("amaretto"),
    heroScene: "Mediterranean terrace late afternoon, low rattan coffee table, warm golden hour raking light, elegant aperitivo trio atmosphere",
    colorPalette: "warm amber + burnt orange + golden afternoon glow + Mediterranean terrace warm earthy tones",
    props: "orange slices, whole olives, rattan coffee table surface, golden late afternoon sunlight, Mediterranean terrace aperitivo atmosphere",
    motionStyle: "gentle condensation drip down can, orange slice settling beside the can, golden afternoon light sweeping across the aluminum surface",
    isNonAlcoholic: true,
  },
  {
    id: "paloma_nonalc",
    detect: n => n.includes("paloma"),
    heroScene: "Mediterranean terrace late afternoon, warm golden light, pink grapefruit and fresh lime garnishes beside the can, aperitivo atmosphere",
    colorPalette: "grapefruit pink + lime green + warm white + warm golden Mediterranean afternoon light",
    props: "halved pink grapefruit wedge, fresh lime slice, Mediterranean terrace stone surface, warm golden late afternoon sun",
    motionStyle: "grapefruit wedge placement beside can, condensation beads forming on cold aluminum, warm golden light reflection drifting across can surface",
    isNonAlcoholic: true,
  },
];

function getCanPreset(product) {
  const name = (product.name || "").toLowerCase();
  for (const preset of canFlavorPresets) {
    if (preset.detect(name)) return preset;
  }
  return isAlcoholicCan(product) ? {
    heroScene: "Outdoor summer scene — golden hour at a lake house patio or rooftop terrace, vibrant social energy, warm summer light",
    colorPalette: "vivid punchy summer colors — warm pinks, oranges, electric blues — flavor-dependent",
    props: "fresh citrus slices, condensation-covered can, crushed ice, tropical fruits, warm golden summer light",
    motionStyle: "condensation streaming down cold can, fruit slices falling through summer air, golden light catching and refracting off aluminum surface",
    isNonAlcoholic: false,
  } : {
    heroScene: "Active outdoor nature scene — morning dock or mountain trail, clear lake water or open sky, fresh clean energy",
    colorPalette: "crisp natural tones — greens, sky blues, brilliant whites, fresh citrus — health-forward and bright",
    props: "fresh-cut fruit, clean water droplets, natural surface (wood, stone, linen), morning natural light, nature elements in background",
    motionStyle: "clean fresh water splash, fruit bursting with vitality, light water ripple, morning dew visible on can surface",
    isNonAlcoholic: true,
  };
}

// Enhance a user's video scene description into a Seedance 2 Pro optimized Cherry River prompt
async function enhanceVideoPrompt(userScene, product) {
  const flavorMap = {
    "framboise": "large crystal ice cubes + short crystal rock glass + whole raspberries + halved lime wedges + deep crimson raspberry liquid",
    "raspberry": "large crystal ice cubes + short crystal rock glass + whole raspberries + halved lime wedges + deep crimson raspberry liquid",
    "pamplemousse": "large crystal ice cubes + short crystal rock glass + halved pink grapefruit slices + grapefruit wedges + vibrant hot-pink liquid",
    "grapefruit": "large crystal ice cubes + short crystal rock glass + halved pink grapefruit slices + grapefruit wedges + vibrant hot-pink liquid",
    "triple sec": "whole orange slices, orange zest curls, golden amber liquid",
    "citrus": "citrus slices, orange zest, bright golden liquid",
    "litchi": "whole lychee fruit, tangerine wedges, pale rose liquid",
    "tangerine": "whole lychee fruit, tangerine wedges, pale rose liquid",
    "vanille": "split vanilla pods, cream drizzle, warm ivory liquid",
    "vanilla": "split vanilla pods, cream drizzle, warm ivory liquid",
    "rhum": "raw sugar cane stick, lime wedge, deep amber liquid",
    "rum": "raw sugar cane stick, lime wedge, deep amber liquid",
    "érable": "maple leaf, amber syrup drip, golden liquid",
    "erable": "maple leaf, amber syrup drip, golden liquid",
    "café": "whole coffee beans, espresso drip, dark caramel liquid",
    "cafe": "whole coffee beans, espresso drip, dark caramel liquid",
    "melon": "honeydew melon cube, cucumber slice, pale jade liquid",
    "gin": "botanicals, juniper berries, ice crystals",
    "pomme": "whole red and green apples, apple slices, cinnamon stick, crystal rocks glass",
    "apple": "whole red and green apples, apple slices, cinnamon stick, crystal rocks glass",
    "mangue": "fresh mango halves, mango cubes, tropical yellow-orange liquid, mint sprig",
    "mango": "fresh mango halves, mango cubes, tropical yellow-orange liquid, mint sprig",
    "supérieure": "large crystal ice cubes, crystal rocks glass, clean water droplets",
    "superieure": "large crystal ice cubes, crystal rocks glass, clean water droplets",
    "london dry": "juniper berries, rosemary sprigs, lemon peel, botanical elements",
  };

  // Color scheme per product — based on actual Cherry River reference videos
  // Framboise reference: warm crimson foreground + TEAL backlight contrast (not monochromatic)
  // Pamplemousse reference: hot pink everything + lifestyle + aerial fruit shot
  const colorWorldMap = {
    "framboise": "warm crimson-raspberry foreground + deep teal-turquoise backlight creating cinematic color contrast — dark charcoal stone-textured surface — bottle glows ruby red through warm backlight",
    "raspberry": "warm crimson-raspberry foreground + deep teal-turquoise backlight creating cinematic color contrast — dark charcoal stone-textured surface — bottle glows ruby red through warm backlight",
    "pamplemousse": "saturated hot magenta-pink world — hot pink background, glossy hot-pink surface, pink atmospheric haze — bottle glows translucent pink — everything saturated neon pink",
    "grapefruit": "saturated hot magenta-pink world — hot pink background, glossy hot-pink surface, pink atmospheric haze — bottle glows translucent pink — everything saturated neon pink",
    "triple sec": "pure obsidian-black world — infinite black void, matte black surface, zero ambient fill, single razor-thin rim light on bottle edge",
    "litchi": "warm blush-rose world — soft pink background, warm ivory surface, bottle glows pale rose from backlight",
    "tangerine": "warm peach-coral world — warm orange-pink background, ivory surface, bottle glows pale gold-pink",
    "vanille": "warm ivory-cream world — cream background, polished marble surface, warm golden low-angle light",
    "vanilla": "warm ivory-cream world — cream background, polished marble surface, warm golden low-angle light",
    "rhum": "warm amber-mahogany world — rich brown background, dark wood surface, deep amber liquid light",
    "rum": "warm amber-mahogany world — rich brown background, dark wood surface, deep amber liquid light",
    "érable": "rich amber-gold world — warm autumn orange background, maple wood surface, golden harvest light",
    "erable": "rich amber-gold world — warm autumn orange background, maple wood surface, golden harvest light",
    "café": "deep espresso-brown world — matte charcoal background, dark surface, warm amber spotlight from above",
    "cafe": "deep espresso-brown world — matte charcoal background, dark surface, warm amber spotlight from above",
    "melon": "vibrant jade-green world — fresh green background, dewy surface, crisp morning light",
    "pomme": "warm natural terracotta-beige world — sandy stone surface, warm daylight, green apple and red apple tones, organic earthy warmth",
    "apple": "warm natural terracotta-beige world — sandy stone surface, warm daylight, green apple and red apple tones, organic earthy warmth",
    "mangue": "warm golden-terracotta world — earthy terracotta backdrop, golden afternoon sun, amber and orange tones, tropical warmth",
    "mango": "warm golden-terracotta world — earthy terracotta backdrop, golden afternoon sun, amber and orange tones, tropical warmth",
    "supérieure": "deep midnight-charcoal world — dark charcoal background, gold glitter particles, silver rim light on bottle, cool premium atmosphere",
    "superieure": "deep midnight-charcoal world — dark charcoal background, gold glitter particles, silver rim light on bottle, cool premium atmosphere",
    "london dry": "warm amber-terracotta world — earthy terracotta textured wall backdrop, travertine stone surface, botanical warmth, golden evening light",
  };

  // Music style per product — strictly safe words only
  // BANNED: moody, minor key, dark, dramatic, tension, noir, sinister, brooding, ominous, haunting, aggressive, deep sub-bass
  const musicMap = {
    "pamplemousse": "upbeat tropical electronic pop, feminine synth lead, bubbly arpeggio, bright percussive hits, 108 BPM, warm reverb tail, cheerful and fresh",
    "grapefruit": "upbeat tropical electronic pop, feminine synth lead, bubbly arpeggio, bright percussive hits, 108 BPM, warm reverb tail, cheerful and fresh",
    "framboise": "smooth flowing electronic, warm synth bass groove, gentle melodic pad, rhythmic pulse, 90 BPM, rich and inviting",
    "raspberry": "smooth flowing electronic, warm synth bass groove, gentle melodic pad, rhythmic pulse, 90 BPM, rich and inviting",
    "litchi": "warm sunset electronic, smooth synth chords, gentle arpeggiated melody, soft percussion, 100 BPM, dreamy and serene",
    "tangerine": "warm sunset electronic, smooth synth chords, gentle arpeggiated melody, soft percussion, 100 BPM, dreamy and serene",
    "triple sec": "minimal electronic, slow bass pulse, single piano note, quiet and precise, 72 BPM, cool and refined",
    "rhum": "jazz-infused electronic, warm upright bass line, muted trumpet note, vinyl texture, 82 BPM, sophisticated lounge atmosphere",
    "rum": "jazz-infused electronic, warm upright bass line, muted trumpet note, vinyl texture, 82 BPM, sophisticated lounge atmosphere",
    "vanille": "slow elegant ambient, orchestral bass note, distant piano melody, soft string swell, 65 BPM, elegant and luxurious",
    "vanilla": "slow elegant ambient, orchestral bass note, distant piano melody, soft string swell, 65 BPM, elegant and luxurious",
    "café": "jazzy electronic, finger-snapped rhythm, double bass walk, mellow synth pad, 88 BPM, smooth Parisian café atmosphere",
    "cafe": "jazzy electronic, finger-snapped rhythm, double bass walk, mellow synth pad, 88 BPM, smooth Parisian café atmosphere",
    "whisky": "rich warm electronic, slow smooth groove, cello undertone, ambient pad shimmer, 78 BPM, cozy and warm",
    "érable": "rich warm electronic, slow smooth groove, cello undertone, ambient pad shimmer, 78 BPM, cozy and warm",
    "erable": "rich warm electronic, slow smooth groove, cello undertone, ambient pad shimmer, 78 BPM, cozy and warm",
    "mojito": "fresh energetic electronic pop, bright synth pluck, tropical steel pan sample, four-on-the-floor kick, 122 BPM, summer energy",
    "melon": "playful summer electronic, bouncy synth bass, light marimba melody, crisp snare, 118 BPM, refreshing and clean",
    "orange": "vibrant electronic pop, punchy bass hit, bright chord stab, energetic build, 115 BPM, bold and confident",
    "tequila": "minimal electronic, slow reverb guitar pluck, low bass note, gentle pad, 80 BPM, golden hour mood",
    "limonade": "upbeat summer electronic pop, bright synth pluck, crisp snare, 120 BPM, clean and refreshing",
    "sangria": "warm Mediterranean electronic, smooth acoustic strum, gentle bass groove, 88 BPM, relaxed and convivial",
    "canneberge": "energetic outdoor electronic pop, bright synth burst, four-on-the-floor kick, 118 BPM, active and fresh",
    "amaretto": "warm aperitivo electronic, smooth piano melody, gentle bass, 80 BPM, relaxed Mediterranean afternoon",
    "paloma": "breezy tropical electronic, bright citrus synth pluck, light percussion, 112 BPM, fresh and carefree",
    "cosmo": "sophisticated evening electronic, smooth bass groove, warm piano chord, 85 BPM, premium and refined",
    "margarita": "bright energetic electronic pop, clean synth hit, crisp percussion, 116 BPM, fresh and lively",
    "basilic": "warm summer evening electronic, soft synth chord, gentle bass pulse, 92 BPM, sophisticated and social",
    "pomme": "crisp refreshing electronic, bright synth pluck, clean crisp percussion, 110 BPM, fresh orchard energy",
    "apple": "crisp refreshing electronic, bright synth pluck, clean crisp percussion, 110 BPM, fresh orchard energy",
    "mangue": "warm tropical electronic, smooth bass groove, bright synth pad, 108 BPM, golden afternoon energy",
    "mango": "warm tropical electronic, smooth bass groove, bright synth pad, 108 BPM, golden afternoon energy",
    "supérieure": "minimal sleek electronic, slow precise bass note, single piano key, quiet and refined, 72 BPM, VIP lounge atmosphere",
    "superieure": "minimal sleek electronic, slow precise bass note, single piano key, quiet and refined, 72 BPM, VIP lounge atmosphere",
    "london dry": "warm botanical electronic, soft acoustic guitar pluck, ambient pad, 80 BPM, sophisticated evening atmosphere",
  };

  const productNameLower = product.name.toLowerCase();
  let flavorProps = "fresh fruit slices, botanical garnishes, premium ice";
  for (const [key, val] of Object.entries(flavorMap)) {
    if (productNameLower.includes(key)) { flavorProps = val; break; }
  }

  let musicStyle = "cinematic luxury ambient, smooth synth bass pulse, subtle atmospheric pad, no percussion, 80 BPM, VIP lounge atmosphere";
  for (const [key, val] of Object.entries(musicMap)) {
    if (productNameLower.includes(key)) { musicStyle = val; break; }
  }

  let colorWorld = "deep moody dark universe — black background, obsidian surface, single backlight through bottle";
  for (const [key, val] of Object.entries(colorWorldMap)) {
    if (productNameLower.includes(key)) { colorWorld = val; break; }
  }

  // Detect product type — can vs bottle
  const isCan = product.product_type === "can" || product.productType === "can" || productNameLower.includes("can");
  const isAverse = productNameLower.includes("averse");
  const averseDomeColor = isAverse ? (
    productNameLower.includes("pomme") || productNameLower.includes("apple") ? "apple green" :
    productNameLower.includes("framboise") || productNameLower.includes("raspberry") ? "deep crimson red" :
    productNameLower.includes("mangue") || productNameLower.includes("mango") ? "warm amber orange" :
    productNameLower.includes("limonade") ? "lemon yellow" :
    productNameLower.includes("basilic") || productNameLower.includes("petits fruits") ? "mauve purple" :
    productNameLower.includes("gin") || productNameLower.includes("london") ? "midnight navy" :
    "white"
  ) : null;

  // Can: resolve flavor preset (outdoor lifestyle), override colorWorld from preset
  const canPreset = isCan ? getCanPreset(product) : null;
  if (canPreset) {
    colorWorld = canPreset.colorPalette;
  }

  // Narrative style per product type
  // CAN: dark dramatic — label macro → can reveal → can rotation → props detail → wide hero
  // PAMPLEMOUSSE/bright: condensation world + aerial fruit splash + lifestyle
  // ALL BOTTLES: cocktail pour narrative (Framboise reference style)
  const condensationProducts = ["pamplemousse", "grapefruit", "litchi", "tangerine", "melon"];
  const useCondensationNarrative = !isCan && condensationProducts.some(k => productNameLower.includes(k));

  // Build shot template based on product type
  const canIsAlcoholic = canPreset ? isAlcoholicCan(product) : false;

  const shotTemplate = isCan && canPreset ? (canIsAlcoholic ? `
SHOT 1 — CAN CONDENSATION MACRO (0–3s):
Camera opens in EXTREME CLOSE-UP on THIS EXACT CAN surface — cold aluminum covered in dense condensation water droplets — ${canPreset.heroScene.split(".")[0]} visible in soft focus behind — camera slowly slides up the can from label base to pull-tab, revealing the full label design — single condensation drop slides down in slow motion — ${canPreset.colorPalette} world establishing

SHOT 2 — OUTDOOR SOCIAL SCENE (3–8s):
Medium shot establishing ${canPreset.heroScene} — THIS EXACT CAN centered prominently in foreground — ${canPreset.props} arranged naturally around the can — vivid ${canPreset.colorPalette} world — golden outdoor light hitting the aluminum surface — vibrant social summer energy

SHOT 3 — MOTION ACTION (8–11s):
${canPreset.motionStyle} — THIS EXACT CAN stays prominently in frame throughout — ${canPreset.colorPalette} saturating the entire scene — high energy, motion-forward, vivid summer action

SHOT 4 — CAN + PROPS MACRO (11–13s):
EXTREME CLOSE-UP — THIS EXACT CAN label in sharp full focus, completely undistorted and readable — ${canPreset.props.split(",")[0].trim()} and condensation at the base — ${canPreset.colorPalette} — shallow depth of field${canPreset.keyNote ? ` — ${canPreset.keyNote}` : ""}

SHOT 5 — WIDE OUTDOOR HERO (13–15s):
Camera rises to wide outdoor hero shot — ${canPreset.heroScene} at full scale — THIS EXACT CAN centered and prominent — ${canPreset.colorPalette} world in full — peak summer energy — cinematic final freeze frame
` : `
SHOT 1 — CAN NATURE MACRO (0–3s):
Camera opens in EXTREME CLOSE-UP on THIS EXACT CAN resting on a natural surface — ${canPreset.heroScene.split(".")[0]} visible in soft focus behind — natural morning or afternoon light catching the cold aluminum — condensation on can surface — camera slowly reveals full label design, sharp and fully undistorted

SHOT 2 — OUTDOOR NATURE SCENE (3–8s):
Medium shot establishing ${canPreset.heroScene} — THIS EXACT CAN placed naturally in foreground — ${canPreset.props} arranged around the can — active, fresh, health-forward energy — ${canPreset.colorPalette} — crisp natural lighting

SHOT 3 — NATURE MOTION (8–11s):
${canPreset.motionStyle} — THIS EXACT CAN stays prominently in frame throughout — ${canPreset.colorPalette} — fresh clean energy, personal vitality, outdoor adventure${canPreset.keyNote ? ` — ${canPreset.keyNote}` : ""}

SHOT 4 — CAN + FRESH PROPS MACRO (11–13s):
EXTREME CLOSE-UP — ${canPreset.props.split(",")[0].trim()} and natural elements in tight frame around THIS EXACT CAN — ${canPreset.colorPalette} — can label fully readable and undistorted — fresh and natural mood

SHOT 5 — WIDE OUTDOOR HERO (13–15s):
Wide outdoor shot — ${canPreset.heroScene} fully established — THIS EXACT CAN prominent in frame — ${canPreset.colorPalette} — active nature energy — cinematic final freeze
`) : useCondensationNarrative ? `
SHOT 1 — CONDENSATION MACRO (0–4s):
Camera opens in EXTREME CLOSE-UP on the bottle glass surface — dense condensation water droplets coat the entire glass — camera slowly rotates 90 degrees around the bottle showing the wet glass from different angles — hot pink background saturating the entire frame — camera gently racks focus between the water drops and the label — NO full bottle shape visible yet — just the condensation-covered curved glass surface and partial label

SHOT 2 — FLAVOR TEXT MACRO (4–6s):
Camera tightens to an extreme close-up on just the flavor text area of the label — flavor name fills the entire frame — condensation drops scattered on the hot-pink label surface — camera holds still, breathing gently — pure abstract hot pink

SHOT 3 — AERIAL FRUIT SPLASH (6–9s):
AERIAL overhead camera angle looking straight down — hot pink glossy surface below — multiple halved grapefruit slices fall from above in SLOW MOTION — pink water EXPLODES upward in a dramatic splash — this exact bottle appears small in the center of the water eruption — pure saturated hot pink world — no horizon visible, just pink surface + fruit + water

SHOT 4 — LIFESTYLE HERO (9–12s):
Eye-level medium shot — a person wearing soft pink fabric stands behind a glossy hot-pink reflective table — THIS EXACT BOTTLE stands upright centered-right on the glossy surface — mirror-perfect reflection of the bottle below — halved grapefruit slices and a rosemary sprig scattered at bottle base — person's hand reaches toward a whole grapefruit on the left — warm diffused pink lighting everywhere

SHOT 5 — PRODUCT CLOSE (12–15s):
Camera slowly pushes in toward the bottle on the glossy surface — bottle perfectly centered — label fully sharp and readable — condensation drops catching pink light — glossy surface reflection crisp — cinematic still freeze
` : `
SHOT 1 — LABEL MACRO (0–3s):
Camera opens in EXTREME CLOSE-UP on the bottle label — label fills the entire 9:16 frame — warm backlight glows through the colored glass — condensation micro-droplets on the glass surface — camera gently racks focus from glass texture to label — No full bottle visible yet — just label filling the frame

SHOT 2 — POUR ACTION (3–8s):
A hand slowly tilts THIS EXACT BOTTLE and dispenses a precise 1-ounce measure — a thin, controlled trickle of liquid falls in SLOW MOTION from the bottle neck into a short crystal rock glass holding 2 large clear ice cubes — the narrow pour stream is the focal point — sharp and jewel-like — this is a spirit pour, NOT a juice pour — minimal liquid, refined and deliberate — background: ${colorWorld} — teal-turquoise backlight creates cinematic contrast behind the thin stream — shallow depth of field — ice cubes softly bokeh

SHOT 3 — ${isAverse ? "DOME BASE DETAIL" : "CORK MACRO"} (8–10s):
${isAverse
  ? `EXTREME CLOSE-UP on the distinctive ${averseDomeColor} dome-shaped base cap of THIS BOTTLE — smooth curved dome fills the frame — Cherry River branding visible on the dome surface — ${colorWorld} — shallow depth of field with soft background bokeh`
  : `EXTREME CLOSE-UP on the wooden cork stopper of THIS BOTTLE — warm amber wood grain texture fills the frame — engraved stag animal logo on top of cork — shallow depth of field with soft background bokeh`}

SHOT 4 — INSIDE GLASS MACRO (10–12s):
Camera goes INSIDE the rock glass — extreme close-up — a shallow 1-oz layer of colored liquid swirling gently around the base of large ice cubes — ice towers above the liquid line — ice catches light and refracts — liquid rich, jewel-like, saturated — the glass is not full, just a measured spirit serving

SHOT 5 — WIDE HERO (12–15s):
Camera lifts to overhead-angled establishing shot — THIS BOTTLE resting on its side on dark charcoal stone-textured surface — filled rock glass beside it — props scattered artfully: ${flavorProps} — ${colorWorld} — atmospheric haze fills the scene — cinematic final freeze frame
`;

  // Build message content — include actual product image so Opus can describe the bottle precisely
  const userContent = [];

  if (product.image) {
    try {
      const imgResp = await fetch(product.image);
      if (imgResp.ok) {
        const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        const base64 = imgBuffer.toString("base64");
        const contentType = imgResp.headers.get("content-type") || "image/jpeg";
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: contentType, data: base64 },
        });
      }
    } catch (e) {
      console.error("Failed to fetch product image for Opus:", e.message);
    }
  }

  const opusText = isCan && canPreset ? `You are a world-class beverage advertising director specializing in high-energy lifestyle content.
Study the EXACT can image attached — memorize the can shape, label design, colors, pull-tab.
Write a Seedance 2 Pro video prompt for this Cherry River RTD can.
Style reference: Red Bull, Celsius — vibrant, saturated, motion-forward, outdoor lifestyle energy.

PRODUCT: "${product.name}"
HERO SCENE: ${canPreset.heroScene}
COLOR WORLD: ${canPreset.colorPalette}
PROPS: ${canPreset.props}
MUSIC: ${musicStyle}
DIRECTOR'S NOTE: "${userScene}"

SUBJECT (use in all shots): From the image — describe this exact can: tall slim 355ml cylindrical aluminum can, exact label design and colors as shown in the image, Cherry River branding, pull-tab at top. Be precise.

Follow this EXACT shot structure:
${shotTemplate}
MUSIC: ${musicStyle} — starts immediately at 0s, builds with the outdoor energy, fades naturally at end.
SOUND & FOLEY: condensation drops on cold aluminum, outdoor ambient sounds, ${canPreset.isNonAlcoholic ? "fresh nature sounds, water sounds" : "crowd energy sounds, summer ambiance"}, prop interaction sounds.
CINEMATIC GRADE: vibrant saturated outdoor colors | condensation on cold aluminum | ${canPreset.isNonAlcoholic ? "crisp natural morning or afternoon light" : "golden summer outdoor light"} | motion-forward energy | shallow depth of field on label | high energy beverage commercial grade.

CRITICAL RULES:
- Follow the shot sequence EXACTLY as written above — do not change the order
- THIS EXACT CAN must be prominently visible and readable in EVERY shot
- Can label must be UNDISTORTED and READABLE — never warped, never bent
- Can stands PERFECTLY UPRIGHT at 90 degrees in all shots
- NEVER name spirit or drink categories (no gin, vodka, rum, spirits, cocktail, mocktail, etc.)
- NEVER include text/typography or label-reading instructions
- Under 3800 characters total

Return ONLY the final prompt. No preamble. No explanation.`
  : `You are a world-class luxury beverage advertising director. Study the EXACT product bottle image attached — memorize bottle shape, glass color, label color and design, cork material. Write a Seedance 2 Pro video prompt replicating the Cherry River reference commercial style EXACTLY.

PRODUCT: "${product.name}"
PROPS: ${flavorProps}
COLOR & LIGHTING: ${colorWorld}
MUSIC: ${musicStyle}
DIRECTOR'S NOTE: "${userScene}"

SUBJECT (use in all shots): ${isAverse ? `This is an Averse bottle — frosted matte white elongated body, distinctive ${averseDomeColor} dome-shaped base cap, minimalist rectangular label with 'a|v|e|r|s|e' architectural text — NO cork. Confirm from image and describe precisely.` : "From the image — describe this exact bottle: round glass bottle shape, liquid color visible through glass, label color and rectangular shape, wooden cork stopper. Be precise."}

Follow this EXACT shot structure:
${shotTemplate}
MUSIC: ${musicStyle} — starts at 0s immediately, builds with the action, fades naturally at end.
SOUND & FOLEY: condensation water drops on glass, liquid movement sounds, prop impact sounds appropriate to the scene.
CINEMATIC GRADE: extreme macro glass texture | dense condensation water drops | slow-motion physics | saturated color grade | shallow depth of field | single specular highlight.

CRITICAL RULES:
- Follow the shot sequence EXACTLY as written above — do not change the order
- NEVER name spirit categories or drink types (no gin, vodka, rum, liqueur, spirits, cocktail, mocktail, mojito, margarita, etc.)
- NEVER include text/typography/label-reading instructions
- Under 3800 characters total

Return ONLY the final prompt. No preamble. No explanation.`;

  userContent.push({ type: "text", text: opusText });

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 800,
    messages: [{ role: "user", content: userContent }],
  });

  const enhanced = message.content[0].text.trim();

  // Strip alcohol + drink-category words that trigger Seedance "shark" content filter
  const alcoholWords = /\b(alcohol|alcoholic|spirits?|liqueur|liquor|gin|vodka|whisky|whiskey|rum|tequila|brandy|cognac|wine|beer|booze|tipple|cocktail|cocktails|mocktail|mocktails|mojito|margarita|aperitif|nightcap|mixology)\b/gi;

  // Strip music words that trigger Seedance OutputAudioRisk
  // Replace with safe neutral equivalents
  const riskyAudioWords = [
    [/\bmoody\b/gi, "flowing"],
    [/\bminor key\b/gi, "melodic"],
    [/\bominous\b/gi, "gentle"],
    [/\bhaunting\b/gi, "smooth"],
    [/\bbrooding\b/gi, "flowing"],
    [/\bsinister\b/gi, "subtle"],
    [/\bmelancholic\b/gi, "serene"],
    [/\bforeboding\b/gi, "building"],
    [/\baggressive\b/gi, "energetic"],
    [/\bdeep sub-bass\b/gi, "warm bass"],
    [/\bcinematic build\b/gi, "rhythmic build"],
  ];

  let sanitized = enhanced.replace(alcoholWords, "");
  for (const [pattern, replacement] of riskyAudioWords) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized
    .replace(/\s{2,}/g, " ")
    .replace(/\s([,.])/g, "$1")
    .trim();

  // Hard safety cap — Seedance rejects anything over 4000 chars; use 3500 for safe margin
  return sanitized.length > 3500 ? sanitized.slice(0, 3500).trimEnd() : sanitized;
}

// Video aspect ratio map for text_to_video mode
const videoRatioMap = {
  "9:16": "9:16",
  "16:9": "16:9",
  "1:1":  "1:1",
  "4:5":  "9:16",
};

// POST /api/generate-video — start Seedance 2 video generation via PiAPI
app.post("/api/generate-video", async (req, res) => {
  try {
    const { productId, customPrompt, duration, format } = req.body;
    if (!productId) return res.status(400).json({ error: "productId is required" });

    const { data: product } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
    if (!product) return res.status(404).json({ error: "Product not found" });

    const dur = Math.min(Math.max(parseInt(duration) || 10, 4), 15);
    const userScene = customPrompt?.trim() || "cinematic product reveal with dramatic lighting";

    let fullPrompt;
    try {
      fullPrompt = await enhanceVideoPrompt(userScene, product);
    } catch (e) {
      console.error("Video prompt enhancement failed:", e.message);
      fullPrompt = `premium artisan glass bottle, ${userScene}, cinematic luxury product commercial, dark marble surface, dramatic rim lighting`;
    }

    const hasImage = !!product.image;
    const piPayload = {
      model: "seedance",
      task_type: "seedance-2",
      input: {
        prompt: fullPrompt,
        mode: hasImage ? "first_last_frames" : "text_to_video",
        duration: dur,
        ...(hasImage
          ? { image_urls: [product.image] }
          : { aspect_ratio: videoRatioMap[format] || "9:16" }
        ),
      },
    };

    const piResp = await fetch("https://api.piapi.ai/api/v1/task", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.PIAPI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(piPayload),
    });
    const piData = await piResp.json();
    if (piData.code !== 200 || !piData.data?.task_id) {
      throw new Error(`Seedance start failed: ${JSON.stringify(piData)}`);
    }

    const taskId = piData.data.task_id;
    taskCache.set(taskId, { piPayload });
    console.log(`Seedance 2 job started: ${taskId}`);
    res.json({ predictionId: taskId, status: "created" });
  } catch (error) {
    console.error("Video generation start error:", error);
    res.status(500).json({ error: error.message || "Failed to start video generation" });
  }
});

// GET /api/video-status/:id — poll Seedance 2 video status via PiAPI
app.get("/api/video-status/:id", async (req, res) => {
  try {
    const taskId = req.params.id;
    const filename = `${taskId}.mp4`;

    // Helper: download video from URL and save to Supabase videos bucket
    const saveVideoToSupabase = async (videoUrl) => {
      const contentResp = await fetch(videoUrl);
      if (!contentResp.ok) throw new Error(`Video download failed: ${contentResp.status}`);
      const buffer = Buffer.from(await contentResp.arrayBuffer());
      console.log(`Downloaded video ${taskId}: ${buffer.length} bytes`);
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(VIDEO_BUCKET)
        .upload(filename, buffer, { contentType: "video/mp4", upsert: true });
      if (uploadError) throw new Error(`Supabase upload: ${uploadError.message}`);
      const { data: { publicUrl } } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(uploadData.path);
      return publicUrl;
    };

    // Fast path: return cached Supabase URL if already saved
    const { data: { publicUrl: existingUrl } } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(filename);
    const headCheck = await fetch(existingUrl, { method: "HEAD" }).catch(() => null);
    if (headCheck?.ok) return res.json({ status: "succeeded", videoUrl: existingUrl });

    // Check if background WM removal finished since last poll
    const bgWm = wmTasks.get(taskId);
    if (bgWm?.status === "done") {
      wmTasks.delete(taskId);
      return res.json({ status: "succeeded", videoUrl: bgWm.videoUrl });
    }
    if (bgWm?.status === "processing") {
      return res.json({ status: "removing-watermark" });
    }

    // ── NORMAL GENERATION STATUS CHECK ──
    const piResp = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: { "X-API-Key": process.env.PIAPI_API_KEY },
    });
    const data = await piResp.json();
    if (data.code !== 200) throw new Error(`PiAPI status check failed: ${JSON.stringify(data)}`);

    const task = data.data;
    const taskStatus = task.status?.toLowerCase();

    if (taskStatus === "completed") {
      // Check all known PiAPI output field names for the video URL
      const videoUrlFromPiAPI =
        task.output?.video ||
        task.output?.url ||
        task.output?.video_url ||
        task.output?.works?.[0]?.video ||
        task.output?.works?.[0]?.url ||
        (Array.isArray(task.output?.videos) ? task.output.videos[0] : null) ||
        (typeof task.output === "string" ? task.output : null);

      if (!videoUrlFromPiAPI) {
        console.error("Generation completed but no video URL. Full output:", JSON.stringify(task.output));
        return res.json({ status: "processing", progress: 0 });
      }
      console.log(`Generation completed. PiAPI URL: ${videoUrlFromPiAPI}`);

      // Run WM removal synchronously (works on Vercel — no background tasks)
      try {
        console.log(`[WM] Removing watermark for ${taskId}...`);
        const cleanUrl = await removeWatermarkWithFfmpeg(videoUrlFromPiAPI, taskId);
        console.log(`[WM] Done: ${cleanUrl}`);
        return res.json({ status: "succeeded", videoUrl: cleanUrl });
      } catch (wmErr) {
        console.error(`[WM] Failed, uploading original:`, wmErr.message);
        // Fallback: save original (with watermark) to Supabase so URL is permanent
        try {
          const raw = await fetch(videoUrlFromPiAPI);
          if (raw.ok) {
            const buf = Buffer.from(await raw.arrayBuffer());
            const fallbackUrl = await uploadVideoToSupabase(buf, taskId);
            return res.json({ status: "succeeded", videoUrl: fallbackUrl });
          }
        } catch {}
        return res.json({ status: "succeeded", videoUrl: videoUrlFromPiAPI });
      }

    } else if (taskStatus === "failed") {
      const rawErr = task.error?.message || task.logs?.join(", ") || "Generation failed";
      // Map known Seedance error codes to user-friendly messages
      let errMsg = rawErr;
      if (rawErr.includes("OutputAudioRisk")) {
        // Auto-retry: strip all MUSIC/SOUND lines from cached prompt and re-submit
        const cached = taskCache.get(taskId);
        if (cached) {
          const safePrompt = cached.piPayload.input.prompt
            .replace(/^MUSIC:.*$/gim, "")
            .replace(/^SOUND & FOLEY:.*$/gim, "")
            .replace(/^SOUND:.*$/gim, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          const retryPayload = {
            ...cached.piPayload,
            input: { ...cached.piPayload.input, prompt: safePrompt },
          };
          try {
            const retryResp = await fetch("https://api.piapi.ai/api/v1/task", {
              method: "POST",
              headers: { "X-API-Key": process.env.PIAPI_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify(retryPayload),
            });
            const retryData = await retryResp.json();
            if (retryData.code === 200 && retryData.data?.task_id) {
              const newTaskId = retryData.data.task_id;
              taskCache.set(newTaskId, { piPayload: retryPayload });
              taskCache.delete(taskId);
              console.log(`OutputAudioRisk auto-retry: ${taskId} → ${newTaskId}`);
              return res.json({ status: "retrying", taskId: newTaskId });
            }
          } catch (retryErr) {
            console.error("Auto-retry failed:", retryErr.message);
          }
        }
        errMsg = "Audio flagged by Seedance. Please try again.";
      } else if (rawErr.toLowerCase().includes("shark not pass") || rawErr.toLowerCase().includes("shark")) {
        // Seedance "shark" = prompt-level content safety filter — auto-retry with a stripped-down neutral prompt
        const cached = taskCache.get(taskId);
        if (cached) {
          const sharkSafePrompt = cached.piPayload.input.prompt
            .replace(/\b(cocktail|cocktails|mocktail|mojito|margarita|aperitif|alcohol|alcoholic|spirit|spirits|liqueur|gin|vodka|rum|whisky|whiskey|tequila|brandy|wine|beer|booze|pour|pouring|liquid|drink|drinking|beverage|bar|bartender|mixology)\b/gi, "product")
            .replace(/^MUSIC:.*$/gim, "")
            .replace(/^SOUND.*:.*$/gim, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          const retryPayload = {
            ...cached.piPayload,
            input: { ...cached.piPayload.input, prompt: sharkSafePrompt },
          };
          try {
            const retryResp = await fetch("https://api.piapi.ai/api/v1/task", {
              method: "POST",
              headers: { "X-API-Key": process.env.PIAPI_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify(retryPayload),
            });
            const retryData = await retryResp.json();
            if (retryData.code === 200 && retryData.data?.task_id) {
              const newTaskId = retryData.data.task_id;
              taskCache.set(newTaskId, { piPayload: retryPayload });
              taskCache.delete(taskId);
              console.log(`Shark filter auto-retry: ${taskId} → ${newTaskId}`);
              return res.json({ status: "retrying", taskId: newTaskId });
            }
          } catch (retryErr) {
            console.error("Shark auto-retry failed:", retryErr.message);
          }
        }
        errMsg = "Content flagged by Seedance. Retrying with a safer prompt — please wait a moment and try again.";
      } else if (rawErr.includes("OutputVideoRisk")) {
        errMsg = "OutputVideoRisk: Seedance flagged the video content. Try a different scene description.";
      } else if (rawErr.includes("InputAudioRisk") || rawErr.includes("InputVideoRisk")) {
        errMsg = "InputRisk: Your product image or prompt was flagged. Try a cleaner product photo or simpler scene description.";
      } else if (rawErr.includes("NSFW") || rawErr.includes("nsfw")) {
        errMsg = "Content flagged: Scene description contains restricted content. Simplify the prompt and try again.";
      } else if (rawErr.includes("timeout") || rawErr.includes("Timeout")) {
        errMsg = "Generation timed out. Seedance servers are busy — please try again in a moment.";
      } else if (rawErr.includes("credit") || rawErr.includes("balance")) {
        errMsg = "Insufficient PiAPI credits. Please top up your PiAPI account balance.";
      } else if (rawErr.includes("exceeds maximum length") || rawErr.includes("prompt exceeds")) {
        errMsg = "Prompt too long — please try again. The system will use a shorter version.";
      }
      res.json({ status: "failed", error: errMsg, rawError: rawErr });
    } else {
      // pending, staged, processing
      res.json({ status: taskStatus, progress: 0 });
    }
  } catch (error) {
    console.error("Video status error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Cherry River AI backend running on http://localhost:${PORT}`));
}

mountMcp(app);

export default app;
