export type ImageConfigKey =
  | "aspect_ratio"
  | "image_size"
  | "strength"
  | "style"
  | "rgb_colors"
  | "background_rgb_color"
  | "text_layout"
  | "font_inputs"
  | "super_resolution_references";

export type ImageModel = {
  id: string;
  label: string;
  provider: string;
  modalities: Array<"image"> | Array<"image" | "text">;
  supportsImageInput: boolean;
  /** OpenRouter image_config keys this model is documented to accept. */
  acceptedImageConfig: ImageConfigKey[];
  /** Enum of accepted aspect_ratio values. Empty/undefined = unknown, pass through. */
  acceptedAspectRatios?: string[];
  /** Enum of accepted image_size values. Empty/undefined = unknown, pass through. */
  acceptedImageSizes?: string[];
  notes?: string;
};

const GEMINI_ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
];
const GEMINI_IMAGE_SIZES = ["0.5K", "1K", "2K", "4K"];

const GPT54_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
];
const GPT54_IMAGE_SIZES = ["1K", "2K"];

const UNIVERSAL_CONFIG_KEYS: ImageConfigKey[] = ["aspect_ratio", "image_size"];

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "google/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL_CONFIG_KEYS],
    acceptedAspectRatios: [...GEMINI_ASPECT_RATIOS],
    acceptedImageSizes: [...GEMINI_IMAGE_SIZES],
    notes: "General-purpose text-to-image and image editing.",
  },
  {
    id: "google/gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image (Preview)",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL_CONFIG_KEYS],
    acceptedAspectRatios: [...GEMINI_ASPECT_RATIOS],
    acceptedImageSizes: [...GEMINI_IMAGE_SIZES],
    notes: "Gemini 3 Pro image model on the preview channel.",
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image (Preview)",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL_CONFIG_KEYS],
    acceptedAspectRatios: [...GEMINI_ASPECT_RATIOS],
    acceptedImageSizes: [...GEMINI_IMAGE_SIZES],
    notes: "Gemini 3.1 Flash image model on the preview channel.",
  },
  {
    id: "openai/gpt-5.4-image-2",
    label: "GPT-5.4 Image 2",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL_CONFIG_KEYS],
    acceptedAspectRatios: [...GPT54_ASPECT_RATIOS],
    acceptedImageSizes: [...GPT54_IMAGE_SIZES],
    notes:
      "OpenAI's latest image model. Note: only accepts 1K/2K image_size — not 0.5K or 4K.",
  },
  {
    id: "openai/gpt-5-image",
    label: "GPT-5 Image",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [],
    notes:
      "GPT-5 image model. Does not appear to honor image_config; pass prompt-driven size/aspect cues instead.",
  },
  {
    id: "openai/gpt-5-image-mini",
    label: "GPT-5 Image Mini",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [],
    notes:
      "Cheaper/faster GPT-5 image variant. Does not appear to honor image_config; pass prompt-driven size/aspect cues instead.",
  },
  {
    id: "openrouter/auto",
    label: "OpenRouter Auto",
    provider: "OpenRouter",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL_CONFIG_KEYS],
    notes:
      "Auto-router: OpenRouter selects an image-capable model. Accepted aspect_ratio/image_size depend on which model gets picked.",
  },
];

export const DEFAULT_MODEL_ID = "google/gemini-2.5-flash-image";

export function findModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export const IMAGE_CONFIG_DOCS: Record<ImageConfigKey, string> = {
  aspect_ratio:
    'Aspect ratio as "W:H". Accepted values are per-model — see acceptedAspectRatios in list_image_models.',
  image_size:
    'Output resolution tier. Accepted values are per-model — see acceptedImageSizes in list_image_models.',
  strength:
    "Image-to-image strength in [0.0, 1.0]. Lower values stay closer to the input. Recraft only.",
  style: "Artistic style preset name. Recraft V3 only.",
  rgb_colors: "Palette of RGB colors that should influence the output. Recraft only.",
  background_rgb_color: "Specific background color in RGB. Recraft only.",
  text_layout: "Structured spec for placing text at positions. Recraft V3 only.",
  font_inputs: "Custom font specs for text rendering. Sourceful only.",
  super_resolution_references:
    "Up to 4 reference image URLs that enhance low-quality elements. Sourceful only.",
};

/** Concise per-model accepted-value summary, suitable for embedding in tool descriptions. */
export function buildModelParamSummary(): string {
  const lines: string[] = [];
  for (const m of IMAGE_MODELS) {
    const ar = m.acceptedAspectRatios?.join(", ") ?? "(unknown — pass-through)";
    const sz = m.acceptedImageSizes?.join(", ") ?? "(unknown — pass-through)";
    if (m.acceptedImageConfig.length === 0) {
      lines.push(`- ${m.id}: imageConfig not supported.`);
    } else {
      lines.push(
        `- ${m.id}:\n    aspectRatio: ${ar}\n    imageSize:   ${sz}`,
      );
    }
  }
  return lines.join("\n");
}
