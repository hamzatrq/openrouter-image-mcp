import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeOperatorRestrictions,
  loadOperatorConfig,
} from "../src/config.ts";
import { applyOperatorPolicy } from "../src/server.ts";
import { HARDCODED_MODELS } from "../src/models.ts";

test("loadOperatorConfig: defaults are permissive", () => {
  const cfg = loadOperatorConfig({});
  assert.deepEqual(cfg.allowedModels, []);
  assert.equal(cfg.defaultModel, undefined);
  assert.equal(cfg.maxCount, 8);
  assert.deepEqual(cfg.defaultImageConfig, {});
  assert.equal(cfg.lockedImageConfig.size, 0);
  assert.equal(cfg.operatorNotes, undefined);
});

test("loadOperatorConfig: parses CSV and trims whitespace", () => {
  const cfg = loadOperatorConfig({
    ALLOWED_MODELS: " google/gemini-2.5-flash-image , openai/gpt-5.4-image-2 ",
    DEFAULT_MODEL: "  google/gemini-2.5-flash-image  ",
  });
  assert.deepEqual(cfg.allowedModels, [
    "google/gemini-2.5-flash-image",
    "openai/gpt-5.4-image-2",
  ]);
  assert.equal(cfg.defaultModel, "google/gemini-2.5-flash-image");
});

test("loadOperatorConfig: MAX_COUNT clamps to a sane ceiling", () => {
  const a = loadOperatorConfig({ MAX_COUNT: "2" });
  assert.equal(a.maxCount, 2);
  const b = loadOperatorConfig({ MAX_COUNT: "9999" });
  assert.equal(b.maxCount, 32);
  const c = loadOperatorConfig({ MAX_COUNT: "garbage" });
  assert.equal(c.maxCount, 8);
});

test("loadOperatorConfig: defaults and locks", () => {
  const cfg = loadOperatorConfig({
    DEFAULT_IMAGE_SIZE: "1K",
    DEFAULT_ASPECT_RATIO: "16:9",
    LOCK_IMAGE_CONFIG: "imageSize, aspectRatio, garbage",
  });
  assert.deepEqual(cfg.defaultImageConfig, { aspectRatio: "16:9", imageSize: "1K" });
  assert.ok(cfg.lockedImageConfig.has("imageSize"));
  assert.ok(cfg.lockedImageConfig.has("aspectRatio"));
  assert.equal(cfg.lockedImageConfig.has("garbage" as any), false);
});

test("describeOperatorRestrictions: returns undefined when fully permissive", () => {
  const cfg = loadOperatorConfig({});
  assert.equal(describeOperatorRestrictions(cfg), undefined);
});

test("describeOperatorRestrictions: mentions allowlist, lock, and notes", () => {
  const cfg = loadOperatorConfig({
    ALLOWED_MODELS: "google/gemini-2.5-flash-image",
    DEFAULT_IMAGE_SIZE: "1K",
    LOCK_IMAGE_CONFIG: "imageSize",
    OPERATOR_NOTES: "Cheap-mode preset.",
  });
  const text = describeOperatorRestrictions(cfg);
  assert.ok(text);
  assert.match(text!, /Operator allows only/);
  assert.match(text!, /imageSize is LOCKED to "1K"/);
  assert.match(text!, /Cheap-mode preset\./);
});

test("applyOperatorPolicy: rejects out-of-allowlist model", () => {
  const cfg = loadOperatorConfig({ ALLOWED_MODELS: "google/gemini-2.5-flash-image" });
  const result = applyOperatorPolicy(cfg, HARDCODED_MODELS, {
    modelId: "openai/gpt-5.4-image-2",
    imageConfig: undefined,
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /not in the operator-allowed set/);
  }
});

test("applyOperatorPolicy: rejects override of locked key", () => {
  const cfg = loadOperatorConfig({
    DEFAULT_IMAGE_SIZE: "1K",
    LOCK_IMAGE_CONFIG: "imageSize",
  });
  const result = applyOperatorPolicy(cfg, HARDCODED_MODELS, {
    modelId: "google/gemini-2.5-flash-image",
    imageConfig: { imageSize: "2K" },
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /locked imageSize to "1K"/);
  }
});

test("applyOperatorPolicy: applies defaults when agent omits", () => {
  const cfg = loadOperatorConfig({
    DEFAULT_IMAGE_SIZE: "1K",
    DEFAULT_ASPECT_RATIO: "16:9",
  });
  const result = applyOperatorPolicy(cfg, HARDCODED_MODELS, {
    modelId: "google/gemini-2.5-flash-image",
    imageConfig: undefined,
  });
  assert.equal(result.ok, true);
  if (result.ok === true) {
    assert.deepEqual(result.imageConfig, { aspectRatio: "16:9", imageSize: "1K" });
  }
});

test("applyOperatorPolicy: agent override wins when key is not locked", () => {
  const cfg = loadOperatorConfig({ DEFAULT_IMAGE_SIZE: "1K" });
  const result = applyOperatorPolicy(cfg, HARDCODED_MODELS, {
    modelId: "google/gemini-2.5-flash-image",
    imageConfig: { imageSize: "2K" },
  });
  assert.equal(result.ok, true);
  if (result.ok === true) {
    assert.equal(result.imageConfig?.imageSize, "2K");
  }
});
