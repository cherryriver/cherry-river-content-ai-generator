/**
 * Cherry River — Remotion Renderer
 * Reads shot paths from v3_shots_manifest.json, renders final commercial
 * Run: node remotion/render.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read manifest from Kling generation
const manifestPath = path.join(__dirname, "../../../lora-training/video_tests/v3_shots_manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const [shot1, shot2, shot3] = manifest.shots;

if (!shot1 || !shot2 || !shot3) {
  console.error("Need all 3 shots in manifest. Have:", manifest.shots);
  process.exit(1);
}

console.log("=== Cherry River Remotion Render ===");
console.log("Shot 1:", shot1);
console.log("Shot 2:", shot2);
console.log("Shot 3:", shot3);

const compositionId = "PamplemousseCommercial";
const outputFile = path.join(__dirname, "../../reference_videos/../../../lora-training/video_tests/cherry_river_REMOTION_FINAL.mp4");

// 3s title + 5s+5s+5s shots + 2s end = 20s @ 24fps = 480 frames
const TOTAL_FRAMES = (3 + 5 + 5 + 5 + 2) * 24; // 480

const compositionSrc = path.join(__dirname, "src/CherryRiverCommercial.jsx");

console.log("\nBundling...");
const bundled = await bundle({
  entryPoint: compositionSrc,
  webpackOverride: (config) => config,
});

console.log("Selecting composition...");
const composition = await selectComposition({
  serveUrl: bundled,
  id: compositionId,
  inputProps: { shot1, shot2, shot3 },
});

// Override with TikTok dimensions
composition.width = 1080;
composition.height = 1920;
composition.fps = 24;
composition.durationInFrames = TOTAL_FRAMES;

console.log(`\nRendering ${TOTAL_FRAMES} frames @ 1080x1920 24fps...`);
await renderMedia({
  composition,
  serveUrl: bundled,
  codec: "h264",
  outputLocation: outputFile,
  inputProps: { shot1, shot2, shot3 },
  crf: 10,
  onProgress: ({ progress }) => {
    process.stdout.write(`  Progress: ${Math.round(progress * 100)}%\r`);
  },
});

console.log(`\n✅ Rendered: ${outputFile}`);
const size = fs.statSync(outputFile).size;
console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`);
