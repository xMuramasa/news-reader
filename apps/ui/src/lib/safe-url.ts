// The one gate for links built from briefing content. Only absolute http(s) URLs with a host and no credentials pass;
// anything else (javascript:, data:, relative, protocol-relative, malformed) is rendered as plain text by the caller.

const MAX_URL_LENGTH = 2048;

/** The normalized URL when it is safe to put in an href, else null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  // Require the scheme to be spelled out: no protocol-relative or relative links.
  if (!/^https?:\/\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

/** Host name for display, without a leading "www.". */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const NVD_BASE = "https://nvd.nist.gov/vuln/detail/";
const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;

/** NVD page for a CVE id, or null if it isn't one. */
export function nvdUrl(cve: string): string | null {
  const id = cve.trim().toUpperCase();
  return CVE_ID.test(id) ? NVD_BASE + id : null;
}
