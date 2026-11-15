// HTTP + Socket.IO server factory (used by index.ts and the tests).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@sm/shared";
import { SocketGateway, type GatewayOptions } from "./socketGateway";

export interface StartOptions extends GatewayOptions {
  /** Comma-separated allowed origins; defaults to process.env.CLIENT_ORIGIN. */
  clientOrigin?: string;
  sweepIntervalMs?: number;
  /** Directory of the built web client to serve (single-service deploy). null disables; undefined auto-detects. */
  staticDir?: string | null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
};

/** STATIC_DIR env, else apps/client/dist relative to the repo root or the server workspace. */
function findStaticDir(): string | null {
  const candidates = [
    process.env.STATIC_DIR,
    resolve(process.cwd(), "apps/client/dist"),
    resolve(process.cwd(), "../client/dist"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

function serveStatic(root: string, urlPath: string, req: IncomingMessage, res: ServerResponse): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    decoded = "/";
  }
  const filePath = normalize(join(root, decoded));
  const insideRoot = filePath === root || filePath.startsWith(root + sep);
  let target = join(root, "index.html"); // SPA fallback
  if (insideRoot && existsSync(filePath) && statSync(filePath).isFile()) target = filePath;
  const ext = extname(target).toLowerCase();
  const isAsset = target.includes(`${sep}assets${sep}`);
  const isMedia = ext === ".mp3";
  const headers: Record<string, string | number> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": isAsset ? "public, max-age=31536000, immutable" : isMedia ? "public, max-age=86400" : "no-cache",
    "accept-ranges": "bytes",
  };
  const size = statSync(target).size;

  // Byte-range support: Safari refuses to play audio without it, and it lets browsers stream/loop media.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] !== "" || range[2] !== "")) {
    let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] === "" || range[2] === "" ? size - 1 : Number(range[2]);
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return void res.end();
    createReadStream(target, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(target).pipe(res);
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
  gateway: SocketGateway;
}

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * CORS: explicit CLIENT_ORIGIN list (comma-separated) is always allowed.
 * Without it, or when NODE_ENV !== "production", any localhost origin is allowed too
 * (default dev client: http://localhost:5173). Requests without an Origin (native clients) are allowed.
 */
export function makeOriginCheck(clientOrigin: string | undefined, production: boolean): (origin: string | undefined) => boolean {
  const list = (clientOrigin ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const allowLocal = list.length === 0 || !production;
  if (list.length === 0) list.push("http://localhost:5173");
  return (origin) => {
    if (!origin) return true;
    if (list.includes("*") || list.includes(origin)) return true;
    return allowLocal && LOCALHOST_ORIGIN.test(origin);
  };
}

export async function startServer(port: number, opts: StartOptions = {}): Promise<RunningServer> {
  const isAllowed = makeOriginCheck(opts.clientOrigin ?? process.env.CLIENT_ORIGIN, process.env.NODE_ENV === "production");

  const staticDir = opts.staticDir === undefined ? findStaticDir() : opts.staticDir;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && staticDir) {
      serveStatic(staticDir, path, req, res);
      return;
    }
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: true, service: "space-mission-server" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: {
      origin: (origin, cb) => cb(null, isAllowed(origin)),
      credentials: true,
    },
    pingInterval: 10_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 64 * 1024,
  });

  const gateway = new SocketGateway(io, opts);
  const sweep = setInterval(() => gateway.sweep(), opts.sweepIntervalMs ?? 5_000);
  sweep.unref();

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, () => {
      http.off("error", reject);
      resolve();
    });
  });
  const actualPort = (http.address() as AddressInfo).port;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(sweep);
    gateway.close();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
  };

  return { port: actualPort, close, gateway };
}
