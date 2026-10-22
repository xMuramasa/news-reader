// news-ui: serves the Vite build (dist/) with SPA fallback, long-lived caching for hashed assets, security headers and
// GET /healthz. /api/* is not proxied here (Caddy routes it to news-api); it answers 404.
// Env: PORT (default 3000), HOST (default 0.0.0.0), DIST_DIR (default ./dist next to this file).
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self'",
  // Radix dialogs lock scrolling with an injected <style> element, so inline styles stay allowed; scripts don't.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
};

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-cache";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function extOf(path: string): string {
  const last = path.slice(path.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot).toLowerCase() : "";
}

/** Vite's hashed output: /assets/<name>-<hash>.<ext>. Safe to cache forever. */
export function isHashedAsset(path: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path);
}

function respond(status: number, body: BodyInit | null, headers: Record<string, string>, head: boolean): Response {
  return new Response(head ? null : body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

function text(status: number, msg: string, head: boolean, extra: Record<string, string> = {}): Response {
  return respond(status, msg, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra }, head);
}

export interface HandlerOptions {
  distDir: string;
}

export function createHandler({ distDir }: HandlerOptions): (req: Request) => Promise<Response> {
  const root = resolve(distDir);
  const indexPath = join(root, "index.html");

  async function fileInfo(path: string) {
    try {
      const s = await stat(path);
      return s.isFile() ? s : null;
    } catch {
      return null;
    }
  }

  async function serveFile(req: Request, path: string, urlPath: string, head: boolean): Promise<Response | null> {
    const info = await fileInfo(path);
    if (!info) return null;
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers: Record<string, string> = {
      "Content-Type": TYPES[extOf(path)] ?? "application/octet-stream",
      "Cache-Control": isHashedAsset(urlPath) ? IMMUTABLE : NO_CACHE,
      ETag: etag,
      "Last-Modified": new Date(info.mtimeMs).toUTCString(),
    };
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim() === etag)) return respond(304, null, headers, true);
    headers["Content-Length"] = String(info.size);
    return respond(200, Bun.file(path), headers, head);
  }

  return async (req) => {
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) return text(405, "method not allowed", false, { Allow: "GET, HEAD" });

    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return text(400, "bad request", head);
    }
    const raw = url.pathname;

    if (raw === "/healthz") {
      const ok = (await fileInfo(indexPath)) !== null;
      return respond(ok ? 200 : 503, JSON.stringify({ status: ok ? "ok" : "missing build" }), {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      }, head);
    }
    if (raw === "/api" || raw.startsWith("/api/")) {
      return respond(404, JSON.stringify({ error: "not found" }), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, head);
    }

    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return text(400, "bad request", head);
    }
    // Traversal and oddities: encoded slashes/dots that decode to "..", backslashes, NUL, control characters.
    const segments = path.split("/");
    if (/[\\\u0000-\u001f\u007f]/.test(path) || segments.some((s) => s === ".." || s === ".")) return text(400, "bad request", head);
    if (segments.some((s) => s.startsWith("."))) return text(404, "not found", head);

    const full = resolve(root, `.${path}`);
    if (full !== root && !full.startsWith(root + sep)) return text(400, "bad request", head);

    if (extOf(path) && !path.endsWith("/")) {
      return (await serveFile(req, full, path, head)) ?? text(404, "not found", head);
    }
    // Client-side route (no file extension): the SPA shell.
    return (await serveFile(req, indexPath, "/index.html", head)) ?? text(503, "build missing", head);
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a port number 1-65535");
    process.exit(1);
  }
  const distDir = resolve(process.env.DIST_DIR ?? join(import.meta.dir, "dist"));
  const server = Bun.serve({ port, hostname, fetch: createHandler({ distDir }), maxRequestBodySize: 16 * 1024 });
  console.error(JSON.stringify({ level: "info", msg: "news-ui listening", addr: `${hostname}:${server.port}`, dist: distDir }));
  const stop = () => {
    void server.stop(true).then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
