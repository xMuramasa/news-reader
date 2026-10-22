// Small HTTP toolkit: JSON responses with security headers, errors, a router with 404/405, and a size-capped body
// reader.
import type { Logger } from "./log.ts";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
    public readonly headers: Record<string, string> = {},
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }
}

export const badRequest = (error: string) => new HttpError(400, { error });
export const notFound = (error = "not found") => new HttpError(404, { error });

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export type Handler = (req: Request, params: string[], url: URL) => Promise<Response> | Response;

export interface Route {
  pattern: RegExp;
  methods: Partial<Record<"GET" | "POST" | "PUT" | "DELETE", Handler>>;
}

/** Dispatch to a route; unknown paths are 404, known paths with other methods 405 (HEAD works where GET does). */
export function router(routes: Route[], log: Logger): (req: Request) => Promise<Response> {
  return async (req) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return json(400, { error: "bad request" });
    }
    try {
      for (const route of routes) {
        const m = route.pattern.exec(url.pathname);
        if (!m) continue;
        const method = req.method === "HEAD" ? "GET" : req.method;
        const handler = route.methods[method as keyof Route["methods"]];
        if (!handler) {
          const allow = Object.keys(route.methods);
          if (allow.includes("GET")) allow.push("HEAD");
          return json(405, { error: "method not allowed" }, { Allow: allow.join(", ") });
        }
        const params = m.slice(1).map((p) => {
          try {
            return decodeURIComponent(p ?? "");
          } catch {
            throw badRequest("invalid path");
          }
        });
        const res = await handler(req, params, url);
        return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
      }
      return json(404, { error: "not found" });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, err.body, err.headers);
      log.error("unhandled error", { path: url.pathname, method: req.method, error: (err as Error).message });
      return json(500, { error: "internal error" });
    }
  };
}

/**
 * Read the request body, refusing anything over `limit` bytes: first by Content-Length, then by counting the bytes
 * actually received (chunked bodies or a lying header).
 */
export async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, { error: `body larger than ${limit} bytes` });
  const cl = req.headers.get("content-length");
  if (cl !== null) {
    if (!/^\d+$/.test(cl.trim())) throw badRequest("invalid Content-Length");
    if (Number(cl) > limit) throw tooLarge();
  }
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function isJsonContentType(req: Request): boolean {
  const ct = req.headers.get("content-type");
  return ct !== null && /^application\/json\s*(?:;.*)?$/i.test(ct.trim());
}

// ---------------------------------------------------------------------------------------------------------------
// Query parameters

export function singleParam(url: URL, name: string): string | undefined {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw badRequest(`${name} given more than once`);
  return all[0];
}

export function intParam(url: URL, name: string, dflt: number, min: number, max: number): number {
  const raw = singleParam(url, name);
  if (raw === undefined || raw === "") return dflt;
  if (!/^\d{1,6}$/.test(raw)) throw badRequest(`${name} must be an integer ${min}-${max}`);
  const n = Number(raw);
  if (n < min || n > max) throw badRequest(`${name} must be an integer ${min}-${max}`);
  return n;
}
