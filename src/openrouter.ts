import { promises as fs } from "node:fs";

export type InputImage =
  | { kind: "url"; url: string }
  | { kind: "path"; path: string }
  | { kind: "base64"; data: string; mimeType?: string };

export type GenerateImageParams = {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  inputImages?: InputImage[];
  modalities?: Array<"image" | "text">;
  imageConfig?: Record<string, unknown>;
  httpReferer?: string;
  appTitle?: string;
  extraBody?: Record<string, unknown>;
};

export type GeneratedImage = {
  mimeType: string;
  base64: string;
};

export type GenerateImageResult = {
  text: string;
  images: GeneratedImage[];
  raw: unknown;
};

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function resolveInputImageToDataUrl(image: InputImage): Promise<string> {
  if (image.kind === "url") return image.url;
  if (image.kind === "base64") {
    const mime = image.mimeType ?? "image/png";
    return `data:${mime};base64,${image.data}`;
  }
  const buf = await fs.readFile(image.path);
  const mime = guessMimeFromPath(image.path);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function guessMimeFromPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function parseDataUrl(url: string): GeneratedImage | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const {
    apiKey,
    baseUrl,
    model,
    prompt,
    inputImages = [],
    modalities = ["image", "text"],
    imageConfig,
    httpReferer,
    appTitle,
    extraBody = {},
  } = params;

  const userContent: ContentPart[] = [{ type: "text", text: prompt }];
  for (const img of inputImages) {
    const dataUrl = await resolveInputImageToDataUrl(img);
    userContent.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const extraImageConfig = (extraBody as { image_config?: Record<string, unknown> })
    .image_config;
  const { image_config: _ignored, ...extraBodyRest } = extraBody as Record<string, unknown>;
  const mergedImageConfig: Record<string, unknown> = {
    ...(extraImageConfig ?? {}),
    ...(imageConfig ?? {}),
  };

  const body: Record<string, unknown> = {
    model,
    modalities,
    stream: false,
    messages: [{ role: "user", content: userContent }],
    ...extraBodyRest,
  };
  if (Object.keys(mergedImageConfig).length > 0) {
    body.image_config = mergedImageConfig;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (httpReferer) headers["HTTP-Referer"] = httpReferer;
  if (appTitle) headers["X-Title"] = appTitle;

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed (${response.status} ${response.statusText}): ${rawText.slice(0, 2000)}`,
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`OpenRouter returned non-JSON response: ${rawText.slice(0, 500)}`);
  }

  if (parsed?.error) {
    const message = parsed.error?.message ?? JSON.stringify(parsed.error);
    throw new Error(`OpenRouter error: ${message}`);
  }

  const message = parsed?.choices?.[0]?.message ?? {};
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter((c: any) => c?.type === "text" && typeof c.text === "string")
            .map((c: any) => c.text)
            .join("\n")
        : "";

  const imageBlocks: any[] = Array.isArray(message.images) ? message.images : [];
  const images: GeneratedImage[] = [];
  for (const block of imageBlocks) {
    const candidate = block?.image_url?.url ?? block?.url;
    if (typeof candidate !== "string") continue;
    const parsedImage = parseDataUrl(candidate);
    if (parsedImage) {
      images.push(parsedImage);
      continue;
    }
    if (/^https?:\/\//i.test(candidate)) {
      const fetched = await fetch(candidate);
      if (!fetched.ok) {
        throw new Error(
          `Failed to download image at ${candidate}: ${fetched.status} ${fetched.statusText}`,
        );
      }
      const buf = Buffer.from(await fetched.arrayBuffer());
      const mime = fetched.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
      images.push({ mimeType: mime, base64: buf.toString("base64") });
    }
  }

  return { text, images, raw: parsed };
}
