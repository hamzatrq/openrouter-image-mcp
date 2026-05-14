import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HARDCODED_MODELS,
  buildModelParamSummary,
  fetchLiveImageModels,
  loadCatalog,
  mergeCatalog,
} from "../src/models.ts";

test("mergeCatalog: curated entry wins over live for known IDs", () => {
  const live = [
    {
      id: "google/gemini-2.5-flash-image",
      architecture: { input_modalities: ["image", "text"], output_modalities: ["image", "text"] },
    },
  ];
  const merged = mergeCatalog(live, HARDCODED_MODELS);
  const entry = merged.find((m) => m.id === "google/gemini-2.5-flash-image");
  assert.ok(entry, "model should exist");
  assert.ok(entry!.acceptedAspectRatios?.includes("16:9"), "curated aspect ratios preserved");
  assert.ok(entry!.acceptedImageSizes?.includes("0.5K"), "curated image sizes preserved");
  assert.equal(entry!.liveOnly, undefined);
});

test("mergeCatalog: live-only IDs synthesize a passthrough entry", () => {
  const live = [
    {
      id: "newvendor/new-image-model",
      name: "New Image Model",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
    },
  ];
  const merged = mergeCatalog(live, HARDCODED_MODELS);
  const entry = merged.find((m) => m.id === "newvendor/new-image-model");
  assert.ok(entry);
  assert.equal(entry!.liveOnly, true);
  assert.equal(entry!.supportsImageInput, false);
  assert.equal(entry!.acceptedAspectRatios, undefined, "undefined = passthrough");
  assert.equal(entry!.acceptedImageSizes, undefined);
  assert.deepEqual(entry!.acceptedImageConfig, ["aspect_ratio", "image_size"]);
});

test("mergeCatalog: hardcoded IDs not in live are dropped (except openrouter/auto)", () => {
  const live = [
    {
      id: "google/gemini-2.5-flash-image",
      architecture: { input_modalities: ["image", "text"], output_modalities: ["image", "text"] },
    },
  ];
  const merged = mergeCatalog(live, HARDCODED_MODELS);
  assert.ok(!merged.find((m) => m.id === "openai/gpt-5.4-image-2"), "stale hardcoded entries dropped");
  assert.ok(merged.find((m) => m.id === "openrouter/auto"), "openrouter/auto preserved");
});

test("mergeCatalog: empty live falls back to full hardcoded", () => {
  const merged = mergeCatalog([], HARDCODED_MODELS);
  assert.equal(merged.length, HARDCODED_MODELS.length);
});

test("buildModelParamSummary: includes accepted values for curated models", () => {
  const summary = buildModelParamSummary(HARDCODED_MODELS);
  assert.match(summary, /openai\/gpt-5\.4-image-2/);
  assert.match(summary, /1K, 2K/, "GPT-5.4 image-size enum should appear");
  assert.match(summary, /openai\/gpt-5-image: imageConfig not supported\./);
});

test("buildModelParamSummary: marks live-only entries as pass-through", () => {
  const summary = buildModelParamSummary([
    {
      id: "newvendor/new-image-model",
      label: "New",
      provider: "newvendor",
      modalities: ["image", "text"],
      supportsImageInput: false,
      acceptedImageConfig: ["aspect_ratio", "image_size"],
      liveOnly: true,
    },
  ]);
  assert.match(summary, /\(unknown — pass-through\)/);
});

test("fetchLiveImageModels: returns [] when the request fails", async () => {
  const failingFetch = (async () =>
    new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const result = await fetchLiveImageModels("https://example.invalid/api/v1", failingFetch);
  assert.deepEqual(result, []);
});

test("fetchLiveImageModels: filters to image-output models", async () => {
  const okFetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "text-only", architecture: { output_modalities: ["text"] } },
          {
            id: "image-out",
            architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] },
          },
        ],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const result = await fetchLiveImageModels("https://example.test/api/v1", okFetch);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "image-out");
});

test("loadCatalog: autoSync=false skips network and uses hardcoded", async () => {
  let called = false;
  const tracingFetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const { source, models } = await loadCatalog({ autoSync: false, fetchImpl: tracingFetch });
  assert.equal(source, "hardcoded");
  assert.equal(called, false);
  assert.equal(models.length, HARDCODED_MODELS.length);
});

test("loadCatalog: falls back to hardcoded when live returns empty", async () => {
  const emptyFetch = (async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
  const { source } = await loadCatalog({ fetchImpl: emptyFetch });
  assert.equal(source, "hardcoded");
});
