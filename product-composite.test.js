import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  resolvePackaging, normalizeProductMode, computePlacement, compositeProductOnBackground,
  trimCutout, transparentFraction, buildBackgroundPlatePrompt, NO_PRODUCT_CLAUSE,
} from "./product-composite.js";

test("packaging follows the real product format, not a hard-coded can", () => {
  assert.equal(resolvePackaging({ name: "CR Vodka Érable 750mL", product_type: "bottle" }).kind, "bottle750");
  assert.equal(resolvePackaging({ name: "Averse Vodka Mangue 1.14L", product_type: "bottle" }).kind, "bottle114");
  assert.equal(resolvePackaging({ name: "CR Gin Limon 355mL", product_type: "can" }).kind, "can355");
  assert.equal(resolvePackaging({ name: "CR Mixologie 6-Pack SA", product_type: "can" }).kind, "sixpack");
  // A carton request that points at a can product must not become a can.
  assert.equal(resolvePackaging({ name: "CR Gin Limon 355mL", product_type: "can" }, "Gin Limonade — format 3 L en carton (bag-in-box)").kind, "carton");
  assert.equal(resolvePackaging(null, "Nouveau produit").kind, "bottle750");
  assert.ok(!resolvePackaging({ name: "CR Vodka Érable 750mL" }).descriptor.includes("can"));
});

test("productMode defaults to original and rejects unknown values", () => {
  assert.equal(normalizeProductMode(undefined), "original");
  assert.equal(normalizeProductMode("Concept"), "concept");
  assert.throws(() => normalizeProductMode("redraw"), /productMode/);
});

test("background plate prompt forbids any product", () => {
  const p = buildBackgroundPlatePrompt("Thanksgiving table", resolvePackaging({ name: "X 750mL" }));
  assert.ok(p.includes(NO_PRODUCT_CLAUSE));
  assert.ok(!/exact same can/i.test(p));
});

test("placement keeps aspect ratio and stands the product on the surface", () => {
  const box = computePlacement({
    bgWidth: 2048, bgHeight: 2048, cutWidth: 500, cutHeight: 2000,
    packaging: resolvePackaging({ name: "X 750mL" }),
  });
  assert.ok(Math.abs(box.width / box.height - 0.25) < 0.01);
  assert.equal(box.top + box.height, Math.round(2048 * 0.88));
  assert.ok(Math.abs(box.left + box.width / 2 - 1024) <= 1);
});

async function syntheticCutout() {
  // 200x800 opaque "bottle" with a distinctive label band, inside 300x900 transparent canvas.
  const bottle = await sharp({ create: { width: 200, height: 800, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } })
    .composite([{ input: { create: { width: 200, height: 200, channels: 4, background: { r: 240, g: 225, b: 190, alpha: 1 } } }, top: 500, left: 0 }])
    .png().toBuffer();
  return sharp({ create: { width: 300, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bottle, top: 50, left: 50 }]).png().toBuffer();
}

test("trim and transparency detection", async () => {
  const cut = await syntheticCutout();
  assert.ok(await transparentFraction(cut) > 0.3);
  const jpeg = await sharp(cut).flatten({ background: "#ffffff" }).jpeg().toBuffer();
  assert.equal(await transparentFraction(jpeg), 0);
  const meta = await sharp(await trimCutout(cut)).metadata();
  assert.deepEqual([meta.width, meta.height], [200, 800]);
});

test("composite pastes the original product pixels untouched (uniform scale only)", async () => {
  const cut = await syntheticCutout();
  const bg = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
  const packaging = resolvePackaging({ name: "X 750mL" });
  const { buffer, box } = await compositeProductOnBackground({ backgroundBuffer: bg, cutoutBuffer: cut, packaging });
  assert.equal(box.height, 600);
  assert.equal(box.width, 150);

  const expected = await sharp(await trimCutout(cut)).resize(box.width, box.height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().raw().toBuffer();
  const actual = await sharp(buffer).extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .removeAlpha().raw().toBuffer();
  let maxDiff = 0;
  for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - actual[i]));
  assert.ok(maxDiff <= 1, `product pixels changed (max diff ${maxDiff})`);

  // Contact shadow darkens the surface just below the base, background elsewhere untouched.
  const px = async (x, y) => [...(await sharp(buffer).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer())];
  const under = await px(500, box.top + box.height + 3);
  assert.ok(under[0] < 180, "no contact shadow under the product");
  assert.deepEqual(await px(20, 20), [200, 120, 60]);
});
