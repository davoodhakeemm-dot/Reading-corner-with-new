import "dotenv/config";
import http from "node:http";
import path from "node:path";
import express from "express";

import { createApiRouter } from "./api";
import { attachWebSocketServer } from "./ws";

function readCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === flag && args[i + 1]) return args[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

const IS_PROD = process.env["NODE_ENV"] === "production";
const cliPort = readCliArg("--port") ?? readCliArg("-p");
const envPort = process.env["PORT"];
const nginxPort = process.env["NGINX_PORT"];
const defaultAppPort = process.env["DEFAULT_APP_PORT"] ?? "3000";
const resolvedPortRaw =
  cliPort ??
  (!IS_PROD && envPort && nginxPort && envPort === nginxPort ? defaultAppPort : envPort) ??
  defaultAppPort;
const PORT = Number.parseInt(resolvedPortRaw, 10) || 3000;
const HOST = readCliArg("--host") || process.env["HOST"] || "0.0.0.0";

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  const httpServer = http.createServer(app);

  // Real-time WebSocket server multiplexed on port 3000 (/ws)
  attachWebSocketServer(httpServer);

  // Backend REST API routes (auth, NFC links, media, blocking, messages)
  app.use("/api", createApiRouter());

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: "custom",
    });
    app.use(vite.middlewares);
  } else {
    const publicDir = path.resolve(process.cwd(), ".output/public");
    app.use(express.static(publicDir, { index: false }));

    const ssrPath = path.resolve(process.cwd(), ".output/server/_ssr/ssr.mjs");
    const ssrMod = (await import(ssrPath)) as {
      default?: { fetch: (req: Request) => Promise<Response> };
      fetch?: (req: Request) => Promise<Response>;
    };
    const ssrFetch = ssrMod.default?.fetch ?? ssrMod.fetch;
    if (!ssrFetch) {
      throw new Error(
        "Unable to locate TanStack Start SSR fetch handler in .output/server/_ssr/ssr.mjs",
      );
    }

    app.use(async (req, res, next) => {
      try {
        const origin = `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;
        const url = new URL(req.originalUrl, origin);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
        }

        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const bodyChunks: Buffer[] = [];
        if (hasBody) {
          for await (const chunk of req) {
            bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        }

        const webReq = new Request(url, {
          method: req.method,
          headers,
          ...(hasBody && bodyChunks.length > 0 ? { body: Buffer.concat(bodyChunks) } : {}),
        });

        const webRes = await ssrFetch(webReq);
        res.status(webRes.status);
        webRes.headers.forEach((value, key) => {
          res.append(key, value);
        });
        if (webRes.body) {
          const buf = Buffer.from(await webRes.arrayBuffer());
          res.send(buf);
        } else {
          res.end();
        }
      } catch (err) {
        next(err);
      }
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Reading Corner server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
