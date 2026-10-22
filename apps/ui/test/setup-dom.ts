// Preloaded for the DOM tests only (test/dom). happy-dom replaces globals such as fetch and Response, so the static
// server tests (test/server) run in a separate `bun test` process without it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:3000/", width: 390, height: 844 });

const { cleanup } = await import("@testing-library/react");
afterEach(() => {
  cleanup();
  localStorage.clear();
});
