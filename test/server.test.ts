import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageConfigWire, validateAgainstModel } from "../src/server.ts";
import { HARDCODED_MODELS, findModel } from "../src/models.ts";

test("buildImageConfigWire: undefined input → empty wire and keys", () => {
  const { wire, usedKeys } = buildImageConfigWire(undefined);
  assert.deepEqual(wire, {});
  assert.deepEqual(usedKeys, []);
});

test("buildImageConfigWire: maps camelCase to snake_case and tracks used keys", () => {
  const { wire, usedKeys } = buildImageConfigWire({
    aspectRatio: "16:9",
    imageSize: "1K",
    strength: 0.4,
  });
  assert.deepEqual(wire, { aspect_ratio: "16:9", image_size: "1K", strength: 0.4 });
  assert.deepEqual(usedKeys.sort(), ["aspect_ratio", "image_size", "strength"]);
});

test("validateAgainstModel: unknown model passes (allow user-supplied slugs)", () => {
  const result = validateAgainstModel(undefined, {
    keys: ["aspect_ratio"],
    aspectRatio: "16:9",
    hasInputImages: false,
  });
  assert.equal(result.ok, true);
});

test("validateAgainstModel: rejects imageConfig keys not in accepted set", () => {
  const gpt5 = findModel(HARDCODED_MODELS, "openai/gpt-5-image")!;
  const result = validateAgainstModel(gpt5, {
    keys: ["aspect_ratio"],
    aspectRatio: "16:9",
    hasInputImages: false,
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /does not accept these imageConfig keys/);
  }
});

test("validateAgainstModel: rejects unsupported aspectRatio value with allowed list in message", () => {
  const gpt54 = findModel(HARDCODED_MODELS, "openai/gpt-5.4-image-2")!;
  const result = validateAgainstModel(gpt54, {
    keys: ["aspect_ratio"],
    aspectRatio: "1:4",
    hasInputImages: false,
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /Accepted: .*16:9/);
  }
});

test("validateAgainstModel: rejects unsupported imageSize value", () => {
  const gpt54 = findModel(HARDCODED_MODELS, "openai/gpt-5.4-image-2")!;
  const result = validateAgainstModel(gpt54, {
    keys: ["image_size"],
    imageSize: "4K",
    hasInputImages: false,
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /imageSize "4K".*Accepted: 1K, 2K/);
  }
});

test("validateAgainstModel: accepts valid combo on Gemini", () => {
  const gem = findModel(HARDCODED_MODELS, "google/gemini-2.5-flash-image")!;
  const result = validateAgainstModel(gem, {
    keys: ["aspect_ratio", "image_size"],
    aspectRatio: "16:9",
    imageSize: "2K",
    hasInputImages: true,
  });
  assert.equal(result.ok, true);
});
