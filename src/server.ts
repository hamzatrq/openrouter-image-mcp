import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generateImage,
  type GenerateImageResult,
  type InputImage,
} from "./openrouter.js";
import {
  DEFAULT_MODEL_ID,
  IMAGE_CONFIG_DOCS,
  buildModelParamSummary,
  findModel,
  type ImageConfigKey,
  type ImageModel,
} from "./models.js";
import { resolveOutputDir, saveImage } from "./storage.js";

type Env = {
  apiKey: string;
  baseUrl: string;
  httpReferer?: string;
  appTitle?: string;
};

function readEnv(): Env {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Export it before launching the MCP server.",
    );
  }
  return {
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    httpReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
    appTitle: process.env.OPENROUTER_APP_TITLE?.trim() || undefined,
  };
}

const inputImageSchema = z.union([
  z.object({ url: z.string().url() }).strict(),
  z.object({ path: z.string().min(1) }).strict(),
  z
    .object({
      base64: z.string().min(1),
      mimeType: z.string().optional(),
    })
    .strict(),
]);

function toInputImage(raw: z.infer<typeof inputImageSchema>): InputImage {
  if ("url" in raw) return { kind: "url", url: raw.url };
  if ("path" in raw) return { kind: "path", path: raw.path };
  return { kind: "base64", data: raw.base64, mimeType: raw.mimeType };
}

const rgbTuple = z
  .tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ])
  .describe("[r, g, b] integers 0-255");

const imageConfigSchema = z
  .object({
    aspectRatio: z
      .string()
      .regex(/^\d+:\d+$/, 'Use "W:H" format like "1:1", "16:9", "2:3".')
      .optional()
      .describe(IMAGE_CONFIG_DOCS.aspect_ratio),
    imageSize: z
      .enum(["0.5K", "1K", "2K", "4K"])
      .optional()
      .describe(IMAGE_CONFIG_DOCS.image_size),
    strength: z.number().min(0).max(1).optional().describe(IMAGE_CONFIG_DOCS.strength),
    style: z.string().optional().describe(IMAGE_CONFIG_DOCS.style),
    rgbColors: z.array(rgbTuple).optional().describe(IMAGE_CONFIG_DOCS.rgb_colors),
    backgroundRgbColor: rgbTuple.optional().describe(IMAGE_CONFIG_DOCS.background_rgb_color),
    textLayout: z.unknown().optional().describe(IMAGE_CONFIG_DOCS.text_layout),
    fontInputs: z.unknown().optional().describe(IMAGE_CONFIG_DOCS.font_inputs),
    superResolutionReferences: z
      .array(z.string().url())
      .max(4)
      .optional()
      .describe(IMAGE_CONFIG_DOCS.super_resolution_references),
  })
  .strict();

type ImageConfigInput = z.infer<typeof imageConfigSchema>;

const CAMEL_TO_SNAKE: Record<keyof ImageConfigInput, ImageConfigKey> = {
  aspectRatio: "aspect_ratio",
  imageSize: "image_size",
  strength: "strength",
  style: "style",
  rgbColors: "rgb_colors",
  backgroundRgbColor: "background_rgb_color",
  textLayout: "text_layout",
  fontInputs: "font_inputs",
  superResolutionReferences: "super_resolution_references",
};

export function buildImageConfigWire(
  input: ImageConfigInput | undefined,
): { wire: Record<string, unknown>; usedKeys: ImageConfigKey[] } {
  const wire: Record<string, unknown> = {};
  const usedKeys: ImageConfigKey[] = [];
  if (!input) return { wire, usedKeys };
  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE) as Array<
    [keyof ImageConfigInput, ImageConfigKey]
  >) {
    const value = input[camel];
    if (value === undefined) continue;
    wire[snake] = value;
    usedKeys.push(snake);
  }
  return { wire, usedKeys };
}

export type ValidationFailure = { ok: false; reason: string };
export type ValidationOk = { ok: true };

export function validateAgainstModel(
  model: ImageModel | undefined,
  used: { keys: ImageConfigKey[]; aspectRatio?: string; imageSize?: string; hasInputImages: boolean },
): ValidationFailure | ValidationOk {
  if (!model) return { ok: true };

  const rejectedKeys = used.keys.filter((k) => !model.acceptedImageConfig.includes(k));
  if (rejectedKeys.length > 0) {
    return {
      ok: false,
      reason: `Model ${model.id} does not accept these imageConfig keys: ${rejectedKeys.join(", ")}. Accepted keys for this model: ${model.acceptedImageConfig.join(", ") || "(none — pass image_config-less requests, or use extra)"}.`,
    };
  }

  if (
    used.aspectRatio !== undefined &&
    model.acceptedAspectRatios &&
    !model.acceptedAspectRatios.includes(used.aspectRatio)
  ) {
    return {
      ok: false,
      reason: `Model ${model.id} does not accept aspectRatio "${used.aspectRatio}". Accepted: ${model.acceptedAspectRatios.join(", ")}.`,
    };
  }

  if (
    used.imageSize !== undefined &&
    model.acceptedImageSizes &&
    !model.acceptedImageSizes.includes(used.imageSize)
  ) {
    return {
      ok: false,
      reason: `Model ${model.id} does not accept imageSize "${used.imageSize}". Accepted: ${model.acceptedImageSizes.join(", ")}.`,
    };
  }

  if (used.hasInputImages && !model.supportsImageInput) {
    return {
      ok: false,
      reason: `Model ${model.id} does not accept image input. Use a model with supportsImageInput=true, or omit inputImages.`,
    };
  }

  return { ok: true };
}

export type ServerDeps = {
  catalog: ImageModel[];
  catalogSource: "live" | "hardcoded";
  serverVersion: string;
};

export function createServer(deps: ServerDeps): McpServer {
  const { catalog, catalogSource, serverVersion } = deps;

  const server = new McpServer(
    { name: "openrouter-image-mcp", version: serverVersion },
    {
      instructions: [
        "Generates images via OpenRouter.",
        `Catalog source: ${catalogSource}.`,
        "Tool description embeds per-model accepted imageConfig values. Use them verbatim.",
      ].join(" "),
    },
  );

  server.registerTool(
    "list_image_models",
    {
      description:
        "List supported image-generation models with their accepted imageConfig keys, allowed aspect ratios, allowed image sizes, and whether they accept image input.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              defaultModel: DEFAULT_MODEL_ID,
              catalogSource,
              imageConfigDocs: IMAGE_CONFIG_DOCS,
              models: catalog,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "generate_image",
    {
      description: [
        "Generate (or edit) image(s) via OpenRouter. Returns saved file paths plus inline image content and metadata.",
        "",
        "Each model only accepts specific imageConfig values. Do NOT guess — use these:",
        "",
        buildModelParamSummary(catalog),
        "",
        "Use `count` to generate multiple variations in parallel (1-8).",
        "For image-to-image, pass `inputImages` (only on models with supportsImageInput=true).",
        "Call `list_image_models` for a programmatic view of the same data.",
      ].join("\n"),
      inputSchema: {
        prompt: z.string().min(1).describe("Text prompt describing the desired image."),
        model: z
          .string()
          .optional()
          .describe(
            `OpenRouter model ID. Any image-capable slug works; call list_image_models for the curated set. Defaults to ${DEFAULT_MODEL_ID}.`,
          ),
        count: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe(
            "Number of independent images to generate in parallel (1-8). Each is a separate OpenRouter call. Defaults to 1.",
          ),
        inputImages: z
          .array(inputImageSchema)
          .optional()
          .describe(
            "Reference/source images for image-to-image. Each entry is one of { url } | { path } | { base64, mimeType? }. Only works on models with supportsImageInput=true.",
          ),
        imageConfig: imageConfigSchema
          .optional()
          .describe(
            "Standardized OpenRouter image_config knobs. Server validates each provided key/value against the chosen model.",
          ),
        modalities: z
          .array(z.enum(["image", "text"]))
          .optional()
          .describe(
            "Override response modalities. Defaults to ['image','text'] for multimodal models, ['image'] for image-only ones.",
          ),
        extra: z
          .record(z.unknown())
          .optional()
          .describe(
            "Escape hatch: extra top-level fields merged into the OpenRouter request body. Use `extra.image_config` for image_config keys not yet typed here.",
          ),
      },
    },
    async ({ prompt, model, count, inputImages, imageConfig, modalities, extra }, extraCtx) => {
      const env = readEnv();
      const modelId = model?.trim() || DEFAULT_MODEL_ID;
      const known = findModel(catalog, modelId);
      const { wire: imageConfigWire, usedKeys } = buildImageConfigWire(imageConfig);

      const validation = validateAgainstModel(known, {
        keys: usedKeys,
        aspectRatio: imageConfig?.aspectRatio,
        imageSize: imageConfig?.imageSize,
        hasInputImages: Boolean(inputImages && inputImages.length > 0),
      });
      if (!validation.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: validation.reason }],
        };
      }

      const resolvedModalities =
        modalities ?? (known?.modalities ? [...known.modalities] : ["image", "text"]);

      const n = count ?? 1;
      const progressToken = extraCtx?._meta?.progressToken;
      const sendNotification = extraCtx?.sendNotification;

      const fanOut = Array.from({ length: n }, async (_unused, idx) => {
        const r = await generateImage({
          apiKey: env.apiKey,
          baseUrl: env.baseUrl,
          httpReferer: env.httpReferer,
          appTitle: env.appTitle,
          model: modelId,
          prompt,
          inputImages: inputImages?.map(toInputImage),
          modalities: resolvedModalities,
          imageConfig: Object.keys(imageConfigWire).length > 0 ? imageConfigWire : undefined,
          extraBody: extra,
        });
        if (progressToken !== undefined && sendNotification) {
          await sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: idx + 1,
              total: n,
              message: `Generated ${idx + 1}/${n} (${r.metadata.latencyMs}ms)`,
            },
          }).catch(() => {
            /* notification failures shouldn't fail the call */
          });
        }
        return r;
      });

      const settled = await Promise.allSettled(fanOut);
      const successes: GenerateImageResult[] = [];
      const failures: string[] = [];
      for (const s of settled) {
        if (s.status === "fulfilled") successes.push(s.value);
        else failures.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
      }

      const allImages = successes.flatMap((r) => r.images);
      if (allImages.length === 0) {
        const last = successes.at(-1);
        const tail = failures.length > 0 ? `; errors: ${failures.join(" | ")}` : "";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Model ${modelId} returned no images${tail}. Last assistant text: ${last?.text || "(empty)"}`,
            },
          ],
        };
      }

      const outputDir = resolveOutputDir();
      const savedPaths: string[] = [];
      let imageIndex = 0;
      for (const r of successes) {
        for (const img of r.images) {
          const savedPath = await saveImage({
            outputDir,
            base64: img.base64,
            mimeType: img.mimeType,
            promptHint: prompt,
            index: allImages.length > 1 ? imageIndex : undefined,
          });
          savedPaths.push(savedPath);
          imageIndex++;
        }
      }

      const summary = {
        model: modelId,
        requested: n,
        succeeded: successes.length,
        failed: failures.length,
        savedPaths,
        metadata: successes.map((r) => r.metadata),
        text: successes
          .map((r) => r.text)
          .filter((t) => t)
          .join("\n---\n") || undefined,
        errors: failures.length > 0 ? failures : undefined,
      };

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
      for (const r of successes) {
        for (const img of r.images) {
          content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
        }
      }

      return { content };
    },
  );

  return server;
}
