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
  notes?: string;
};

const UNIVERSAL: ImageConfigKey[] = ["aspect_ratio", "image_size"];

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "google/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "General-purpose text-to-image and image editing. Returns text + image.",
  },
  {
    id: "google/gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image (Preview)",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "Gemini 3 Pro image model on the preview channel.",
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image (Preview)",
    provider: "Google",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "Newer Gemini Flash image model on the preview channel.",
  },
  {
    id: "openai/gpt-5.4-image-2",
    label: "GPT-5.4 Image 2",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "OpenAI's latest image model. Accepts image + text + file input.",
  },
  {
    id: "openai/gpt-5-image",
    label: "GPT-5 Image",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "GPT-5 image model. Supports image input for edits.",
  },
  {
    id: "openai/gpt-5-image-mini",
    label: "GPT-5 Image Mini",
    provider: "OpenAI",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "Cheaper/faster GPT-5 image variant.",
  },
  {
    id: "openrouter/auto",
    label: "OpenRouter Auto",
    provider: "OpenRouter",
    modalities: ["image", "text"],
    supportsImageInput: true,
    acceptedImageConfig: [...UNIVERSAL],
    notes: "Auto-router: OpenRouter selects an image-capable model. Use when you don't care which.",
  },
];

export const DEFAULT_MODEL_ID = "google/gemini-2.5-flash-image";

export function findModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export const IMAGE_CONFIG_DOCS: Record<ImageConfigKey, string> = {
  aspect_ratio:
    'Aspect ratio of the output image as "W:H" (e.g. "1:1", "16:9", "2:3", "3:2"). Universal across image-generation models on OpenRouter.',
  image_size:
    'Output resolution tier. One of "0.5K", "1K", "2K", "4K". Universal across image-generation models on OpenRouter.',
  strength:
    "Image-to-image strength in [0.0, 1.0]. Lower values stay closer to the input image. Recraft only.",
  style:
    "Artistic style preset name. Recraft V3 only.",
  rgb_colors:
    "Palette of RGB colors that should influence the output. Recraft only.",
  background_rgb_color:
    "Specific background color in RGB. Recraft only.",
  text_layout:
    "Structured spec for placing text at positions on the image. Recraft V3 only.",
  font_inputs:
    "Custom font specs for text rendering. Sourceful only.",
  super_resolution_references:
    "Up to 4 reference image URLs that enhance low-quality elements. Sourceful only.",
};
