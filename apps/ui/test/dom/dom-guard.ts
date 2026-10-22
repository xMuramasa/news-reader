// DOM tests need happy-dom from test/setup-dom.ts. A bare `bun test` at the repo root doesn't preload it; fail loudly
// with the right command instead of with confusing errors.
if (typeof document === "undefined") {
  throw new Error("UI DOM tests need happy-dom: run `bun run test:ui` from the repo root (or `bun run test` in apps/ui).");
}
