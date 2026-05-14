import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataUrl } from "../src/openrouter.ts";

test("parseDataUrl: returns mime and base64 for a valid data url", () => {
  const result = parseDataUrl("data:image/png;base64,AAAA");
  assert.ok(result);
  assert.equal(result!.mimeType, "image/png");
  assert.equal(result!.base64, "AAAA");
});

test("parseDataUrl: returns null for an http URL", () => {
  const result = parseDataUrl("https://example.com/img.png");
  assert.equal(result, null);
});

test("parseDataUrl: handles jpeg mime", () => {
  const result = parseDataUrl("data:image/jpeg;base64,/9j/");
  assert.ok(result);
  assert.equal(result!.mimeType, "image/jpeg");
});
