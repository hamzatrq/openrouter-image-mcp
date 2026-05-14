# openrouter-image-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any MCP-compatible client (Claude Code, Claude Desktop, Cursor, etc.) generate and edit images through [OpenRouter](https://openrouter.ai) — across **every** image-capable model OpenRouter exposes (Google Gemini, OpenAI GPT-5 Image, and more).

Unlike a thin wrapper, this server exposes **typed, per-model parameters** so the calling LLM can actually drive each model's controls (aspect ratio, image size, image-to-image strength, Recraft styles, …) and gets a clear error when it passes a parameter the chosen model doesn't accept.

---

## Features

- One stdio MCP server, every OpenRouter image model.
- Typed `imageConfig` surface mirroring OpenRouter's standardized `image_config` (`aspectRatio`, `imageSize`, `strength`, `style`, `rgbColors`, `backgroundRgbColor`, `textLayout`, `fontInputs`, `superResolutionReferences`).
- Per-model validation — passes are routed, mismatches are rejected with the accepted-key list.
- Image-to-image via local file path, URL, or base64.
- Returns generated images **both** as inline MCP image content **and** as saved files on disk (path returned).
- Discovery tool (`list_image_models`) the LLM can call to introspect supported models and their accepted parameters.
- Escape hatch (`extra` / `extra.image_config`) for anything not yet typed.

---

## Installation

### As an npm package

```bash
npm install -g @hamzatrq/openrouter-image-mcp
```

This installs an `openrouter-image-mcp` binary on your PATH.

### From source

```bash
git clone https://github.com/hamzatrq/openrouter-image-mcp.git
cd openrouter-image-mcp
npm install
npm run build
```

Built entrypoint: `dist/index.js`.

---

## Configuration

Environment variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | — | Get one at https://openrouter.ai/keys |
| `IMAGE_OUTPUT_DIR` | no | `~/.openrouter-image-mcp/images` | Where generated PNG/JPG/WEBP files are written. |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api/v1` | Override for proxies / staging. |
| `OPENROUTER_HTTP_REFERER` | no | — | Sent as `HTTP-Referer` header — used by OpenRouter for app attribution. |
| `OPENROUTER_APP_TITLE` | no | — | Sent as `X-Title` header — app name shown on the OpenRouter dashboard. |

A `.env.example` is included; copy it to `.env` for local development. The server itself does **not** auto-load `.env` — set the variables in the MCP client's config (see below).

---

## Connecting it to an MCP client

### Claude Code

Add to `~/.claude/mcp.json` (user-global) or a project `.mcp.json`:

```json
{
  "mcpServers": {
    "openrouter-image": {
      "command": "npx",
      "args": ["-y", "@hamzatrq/openrouter-image-mcp"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the platform equivalent:

```json
{
  "mcpServers": {
    "openrouter-image": {
      "command": "npx",
      "args": ["-y", "@hamzatrq/openrouter-image-mcp"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

### From source / local build

```json
{
  "mcpServers": {
    "openrouter-image": {
      "command": "node",
      "args": ["/absolute/path/to/openrouter-image-mcp/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

---

## Tools

### `list_image_models`

No arguments. Returns the curated model catalog (id, provider, modalities, `supportsImageInput`, `acceptedImageConfig`) plus a documentation map for every `imageConfig` key. Call this first if you want the calling LLM to know what's valid.

### `generate_image`

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | `string` | yes | Description of the desired image. |
| `model` | `string` | no | Any OpenRouter image-capable slug. Defaults to `google/gemini-2.5-flash-image`. |
| `inputImages` | `Array<{url} \| {path} \| {base64,mimeType?}>` | no | Source images for image-to-image. Requires a model with `supportsImageInput: true`. |
| `imageConfig` | `object` | no | Typed `image_config` knobs — see table below. |
| `modalities` | `Array<"image" \| "text">` | no | Defaults to the chosen model's declared modalities. |
| `extra` | `Record<string, unknown>` | no | Escape hatch merged into the request body. Use `extra.image_config` for `image_config` keys not yet typed. |

**Returns:** an MCP content array containing
1. a JSON text block with `{ model, savedPaths, text }`, followed by
2. one `type: "image"` content block per generated image (base64).

#### `imageConfig` parameters

All optional; server validates each against the chosen model's `acceptedImageConfig`.

| Key | Type | Applies to | Notes |
| --- | --- | --- | --- |
| `aspectRatio` | `"W:H"` string | Universal | e.g. `"1:1"`, `"16:9"`, `"2:3"`, `"3:2"`. |
| `imageSize` | `"0.5K" \| "1K" \| "2K" \| "4K"` | Universal | Output resolution tier. |
| `strength` | `number` (0–1) | Recraft | Image-to-image deviation from input. |
| `style` | `string` | Recraft V3 | Artistic style preset. |
| `rgbColors` | `Array<[r,g,b]>` | Recraft | Palette influencing output. |
| `backgroundRgbColor` | `[r,g,b]` | Recraft | Background color. |
| `textLayout` | object | Recraft V3 | Positions text on the image. |
| `fontInputs` | object | Sourceful | Custom-font rendering. |
| `superResolutionReferences` | `string[]` (≤ 4 URLs) | Sourceful | Reference images for SR. |

> **Note.** The current OpenRouter catalog lists only Google Gemini and OpenAI GPT-5 Image families as image-output models — so right now every catalogued model only accepts `aspectRatio` + `imageSize`. The Recraft/Sourceful keys are typed and ready for when those providers return to the catalog.

---

## Example calls

Text-to-image with aspect ratio:

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "An isometric pixel-art coffee shop at dawn",
    "model": "google/gemini-2.5-flash-image",
    "imageConfig": { "aspectRatio": "16:9", "imageSize": "2K" }
  }
}
```

Image-to-image edit:

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "Make it night-time with neon signage",
    "model": "openai/gpt-5.4-image-2",
    "inputImages": [{ "path": "/Users/me/Pictures/cafe.png" }]
  }
}
```

Validation error you'll see if you pass a param the model doesn't accept:

```
Model openai/gpt-5-image does not accept these imageConfig keys: strength.
Accepted keys for this model: aspect_ratio, image_size.
```

---

## Supported models

The curated catalog (also returned by `list_image_models`):

| Model | Image input | Notes |
| --- | --- | --- |
| `google/gemini-2.5-flash-image` (default) | yes | General-purpose. |
| `google/gemini-3-pro-image-preview` | yes | Preview channel. |
| `google/gemini-3.1-flash-image-preview` | yes | Preview channel. |
| `openai/gpt-5.4-image-2` | yes | Latest OpenAI image model. |
| `openai/gpt-5-image` | yes | |
| `openai/gpt-5-image-mini` | yes | Cheaper / faster. |
| `openrouter/auto` | yes | Auto-router; OpenRouter picks the model. |

You can also pass any OpenRouter image-capable slug not in this list — validation is skipped for unknown models and the request is sent through as-is.

---

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/ and chmod +x the bin
npm run dev         # tsc --watch
```

Project layout:

```
src/
  index.ts        # stdio entrypoint
  server.ts       # McpServer + tool registrations + per-model validation
  openrouter.ts   # POST /chat/completions with modalities + image_config
  models.ts       # catalog + acceptedImageConfig registry + parameter docs
  storage.ts      # writes generated images to disk
```

Run the server manually for debugging:

```bash
OPENROUTER_API_KEY=sk-or-v1-... node dist/index.js
```

It speaks MCP over stdio — pipe JSON-RPC messages in to test.

---

## Contributing

Issues and pull requests welcome at <https://github.com/hamzatrq/openrouter-image-mcp>. When OpenRouter adds new image-generation models or new `image_config` keys, please send a PR updating `src/models.ts`.

## License

[MIT](./LICENSE)
