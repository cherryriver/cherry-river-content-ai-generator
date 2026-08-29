/**
 * Cherry River — Hero Ad renderer (LOCAL only, never imported by server.js).
 *
 * node remotion/render-hero.mjs --image=<inventory-url-or-local-path>
 *   --brand="CHERRY RIVER" --kicker="PAMPLEMOUSSE"
 *   --tagline="LE GOÛT DU QUÉBEC" --accent="#FF1B8D"
 *   --bg=<optional-video-url> --format=both --out=./renders
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { mkdtemp, mkdir, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INVENTORY_HOST = "bypedtyxtnmmdsyrgwpj.supabase.co";
const MAX_PRODUCT_BYTES = 20 * 1024 * 1024;

const extensionToMime = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

export function allowedInventoryHosts(env = process.env) {
  const hosts = new Set([DEFAULT_INVENTORY_HOST]);
  if (env.SUPABASE_URL) {
    try { hosts.add(new URL(env.SUPABASE_URL).hostname); } catch { /* validated later */ }
  }
  for (const host of String(env.HERO_AD_ALLOWED_IMAGE_HOSTS || "").split(",")) {
    if (host.trim()) hosts.add(host.trim().toLowerCase());
  }
  return hosts;
}

export function assertInventoryImageUrl(value, env = process.env) {
  let url;
  try { url = new URL(value); } catch { throw new Error("product_image_url_invalid"); }
  if (url.protocol !== "https:") throw new Error("product_image_must_use_https");
  if (!allowedInventoryHosts(env).has(url.hostname.toLowerCase())) {
    throw new Error("product_image_host_not_allowed");
  }
  if (!url.pathname.includes("/storage/v1/object/")) {
    throw new Error("product_image_not_from_inventory_storage");
  }
  return url;
}

function mimeFromLocalPath(filePath) {
  const mime = extensionToMime.get(path.extname(filePath).toLowerCase());
  if (!mime) throw new Error("unsupported_product_image_type");
  return mime;
}

async function productImageAsDataUrl(input, env = process.env) {
  if (/^https:/i.test(input)) {
    const url = assertInventoryImageUrl(input, env);
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) throw new Error(`product_image_download_failed:${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_PRODUCT_BYTES) throw new Error("product_image_too_large");
    const mime = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!mime.startsWith("image/")) throw new Error("product_image_content_type_invalid");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PRODUCT_BYTES) throw new Error("product_image_too_large");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  const absolute = path.resolve(input);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error("product_image_local_path_not_file");
  if (info.size > MAX_PRODUCT_BYTES) throw new Error("product_image_too_large");
  const bytes = await readFile(absolute);
  return `data:${mimeFromLocalPath(absolute)};base64,${bytes.toString("base64")}`;
}

function normalizeBackgroundVideo(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error("background_video_url_invalid"); }
  if (url.protocol !== "https:") throw new Error("background_video_must_use_https");
  return url.toString();
}

function requestedCompositions(format) {
  if (format === "vertical") return [["vertical", "HeroAdVertical"]];
  if (format === "horizontal") return [["horizontal", "HeroAdHorizontal"]];
  if (format === "both") {
    return [["vertical", "HeroAdVertical"], ["horizontal", "HeroAdHorizontal"]];
  }
  throw new Error("format_must_be_vertical_horizontal_or_both");
}

export async function renderHeroAds({
  image,
  brand = "CHERRY RIVER",
  kicker = "",
  tagline = "",
  accent = "#FF1B8D",
  backgroundVideo = null,
  format = "both",
  outDir = path.join(__dirname, "../renders"),
  fileStem = `hero_${Date.now()}`,
  env = process.env,
  onProgress = null,
}) {
  if (!image) throw new Error("image_required");
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("accent_must_be_hex_color");

  const inputProps = {
    productImage: await productImageAsDataUrl(image, env),
    brandName: String(brand).slice(0, 80),
    kicker: String(kicker).slice(0, 100),
    tagline: String(tagline).slice(0, 140),
    accent,
    backgroundVideo: normalizeBackgroundVideo(backgroundVideo),
  };
  const formats = requestedCompositions(format);
  const resolvedOutDir = path.resolve(outDir);
  await mkdir(resolvedOutDir, { recursive: true });

  const tempRoot = await mkdtemp(path.join(tmpdir(), "mediaos-hero-ad-"));
  try {
    const serveUrl = await bundle({
      entryPoint: path.join(__dirname, "src/Root.jsx"),
      outDir: path.join(tempRoot, "bundle"),
      webpackOverride: (config) => config,
    });
    const outputs = {};
    for (const [label, compositionId] of formats) {
      const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });
      const outputLocation = path.join(resolvedOutDir, `${fileStem}_${label}.mp4`);
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation,
        inputProps,
        crf: 12,
        onProgress: ({ progress }) => onProgress?.({ format: label, progress }),
      });
      outputs[label] = outputLocation;
    }
    return outputs;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function parseCliArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const outputs = await renderHeroAds({
    image: args.image,
    brand: args.brand,
    kicker: args.kicker,
    tagline: args.tagline,
    accent: args.accent || "#FF1B8D",
    backgroundVideo: args.bg || null,
    format: args.format || "both",
    outDir: args.out || path.join(__dirname, "../renders"),
    fileStem: args["file-stem"] || `hero_${Date.now()}`,
    onProgress: ({ format: label, progress }) => {
      process.stdout.write(`${label}: ${Math.round(progress * 100)}%\r`);
    },
  });
  process.stdout.write("\n");
  console.log(JSON.stringify({ status: "READY_FOR_REVIEW", outputs }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Hero Ad render failed: ${error.message}`);
    process.exitCode = 1;
  });
}
