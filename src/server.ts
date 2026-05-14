import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateImage, type InputImage } from "./openrouter.js";
import {
  DEFAULT_MODEL_ID,
  IMAGE_CONFIG_DOCS,
  IMAGE_MODELS,
  findModel,
  type ImageConfigKey,
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
  .tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)])
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
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(IMAGE_CONFIG_DOCS.strength),
    style: z.string().optional().describe(IMAGE_CONFIG_DOCS.style),
    rgbColors: z
      .array(rgbTuple)
      .optional()
      .describe(IMAGE_CONFIG_DOCS.rgb_colors),
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

function buildImageConfigWire(
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

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "openrouter-image-mcp", version: "0.1.0" },
    {
      instructions:
        "Generates images via OpenRouter. Call `list_image_models` first to see model IDs and which `imageConfig` keys each model accepts, then call `generate_image`.",
    },
  );

  server.registerTool(
    "list_image_models",
    {
      description:
        "List supported image-generation models with their accepted imageConfig keys and whether they accept image input (for edits).",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              defaultModel: DEFAULT_MODEL_ID,
              imageConfigDocs: IMAGE_CONFIG_DOCS,
              models: IMAGE_MODELS,
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
      description:
        "Generate (or edit) an image via OpenRouter. Pass a prompt and an optional model + imageConfig. Each model only accepts a subset of imageConfig keys — call list_image_models for the per-model accepted set. Returns saved file paths plus inline image content.",
      inputSchema: {
        prompt: z.string().min(1).describe("Text prompt describing the desired image."),
        model: z
          .string()
          .optional()
          .describe(
            `OpenRouter model ID. Any image-capable slug works; call list_image_models for the curated set. Defaults to ${DEFAULT_MODEL_ID}.`,
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
            "Standardized OpenRouter image_config knobs. Server validates each provided key against the chosen model's acceptedImageConfig.",
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
            "Escape hatch: extra top-level fields merged into the OpenRouter request body. Use `extra.image_config` to pass image_config keys not yet typed here.",
          ),
      },
    },
    async ({ prompt, model, inputImages, imageConfig, modalities, extra }) => {
      const env = readEnv();
      const modelId = model?.trim() || DEFAULT_MODEL_ID;
      const known = findModel(modelId);

      const { wire: imageConfigWire, usedKeys } = buildImageConfigWire(imageConfig);

      if (known) {
        const rejected = usedKeys.filter((k) => !known.acceptedImageConfig.includes(k));
        if (rejected.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Model ${modelId} does not accept these imageConfig keys: ${rejected.join(
                  ", ",
                )}. Accepted keys for this model: ${known.acceptedImageConfig.join(", ") || "(none)"}.`,
              },
            ],
          };
        }

        if (inputImages && inputImages.length > 0 && !known.supportsImageInput) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Model ${modelId} does not accept image input. Use a model with supportsImageInput=true, or omit inputImages.`,
              },
            ],
          };
        }
      }

      const resolvedModalities =
        modalities ?? (known?.modalities ? [...known.modalities] : ["image", "text"]);

      const result = await generateImage({
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

      if (result.images.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Model ${modelId} returned no images. Assistant text: ${result.text || "(empty)"}`,
            },
          ],
        };
      }

      const outputDir = resolveOutputDir();
      const savedPaths: string[] = [];
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        const savedPath = await saveImage({
          outputDir,
          base64: img.base64,
          mimeType: img.mimeType,
          promptHint: prompt,
          index: result.images.length > 1 ? i : undefined,
        });
        savedPaths.push(savedPath);
      }

      const summary = {
        model: modelId,
        savedPaths,
        text: result.text || undefined,
      };

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
      for (const img of result.images) {
        content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
      }

      return { content };
    },
  );

  return server;
}
