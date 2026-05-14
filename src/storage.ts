import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveOutputDir(): string {
  const fromEnv = process.env.IMAGE_OUTPUT_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), ".openrouter-image-mcp", "images");
}

export function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function sanitizeForFilename(input: string, max = 40): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export async function saveImage(opts: {
  outputDir: string;
  base64: string;
  mimeType: string;
  promptHint?: string;
  index?: number;
}): Promise<string> {
  await fs.mkdir(opts.outputDir, { recursive: true });
  const ext = extensionForMime(opts.mimeType);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const hint = opts.promptHint ? `-${sanitizeForFilename(opts.promptHint)}` : "";
  const suffix = opts.index !== undefined ? `-${opts.index}` : "";
  const filename = `${ts}${hint}${suffix}.${ext}`;
  const fullPath = path.join(opts.outputDir, filename);
  await fs.writeFile(fullPath, Buffer.from(opts.base64, "base64"));
  return fullPath;
}
