#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadCatalog } from "./models.js";
import { createServer } from "./server.js";
import { loadOperatorConfig } from "./config.js";

const VERSION = "0.3.0";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  const autoSync = (process.env.AUTO_SYNC_CATALOG ?? "true").toLowerCase() !== "false";
  const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  const transport = (process.env.TRANSPORT || "stdio").toLowerCase();

  const operatorConfig = loadOperatorConfig();
  const t0 = Date.now();
  const { models, source } = await loadCatalog({ autoSync, baseUrl });
  console.error(
    `openrouter-image-mcp v${VERSION}: catalog loaded (${source}, ${models.length} models, ${Date.now() - t0}ms)`,
  );
  if (operatorConfig.allowedModels.length > 0) {
    console.error(
      `Operator allowlist active: ${operatorConfig.allowedModels.join(", ")}`,
    );
  }

  const makeMcp = () =>
    createServer({
      catalog: models,
      catalogSource: source,
      serverVersion: VERSION,
      operatorConfig,
    });

  if (transport === "http") {
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? "0.0.0.0";
    const path = process.env.MCP_PATH ?? "/mcp";

    const handler = async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, version: VERSION, catalogSource: source }));
        return;
      }
      if (req.url !== path && !req.url?.startsWith(`${path}?`)) {
        res.writeHead(404).end("Not found");
        return;
      }

      const body = req.method === "POST" ? await readJsonBody(req) : undefined;
      const mcp = makeMcp();
      const transportInstance = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await mcp.connect(transportInstance);
        await transportInstance.handleRequest(req, res, body);
      } catch (err) {
        console.error("HTTP transport error:", err);
        if (!res.headersSent) res.writeHead(500).end("Internal error");
      } finally {
        try {
          await transportInstance.close();
        } catch {
          /* ignore */
        }
      }
    };

    const httpServer = createHttpServer((req, res) => {
      handler(req, res).catch((err) => {
        console.error("Unhandled HTTP error:", err);
        if (!res.headersSent) res.writeHead(500).end("Internal error");
      });
    });
    httpServer.listen(port, host, () => {
      console.error(`openrouter-image-mcp HTTP listening on ${host}:${port}${path}`);
    });
    return;
  }

  if (transport !== "stdio") {
    console.error(`Unknown TRANSPORT="${transport}". Use "stdio" (default) or "http".`);
    process.exit(2);
  }

  const mcp = makeMcp();
  const stdio = new StdioServerTransport();
  await mcp.connect(stdio);
  console.error("openrouter-image-mcp listening on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting openrouter-image-mcp:", err);
  process.exit(1);
});
