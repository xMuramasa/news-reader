// Runs before first paint (classic blocking script, same origin, so the CSP needs no inline script). Mirrors
// parseSettings/applySettings in src/lib/settings.ts; test/dom/settings.test.ts keeps them in step.
(function () {
  var s = {};
  try {
    var v = JSON.parse(localStorage.getItem("news-reader:settings") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) s = v;
  } catch (e) {}
  function pick(list, v, d) {
    return typeof v === "string" && list.indexOf(v) !== -1 ? v : d;
  }
  // No stored theme ("follow the system"): Endfield dark when the OS prefers dark, else Endfield, like systemTheme().
  var system = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "endfield-dark" : "endfield";
  var theme = pick(["endfield", "endfield-dark", "light", "dark", "sepia"], s.theme, system);
  var d = document.documentElement;
  d.setAttribute("data-theme", theme);
  d.setAttribute("data-size", pick(["s", "m", "l", "xl"], s.size, "m"));
  d.setAttribute("data-font", pick(["serif", "sans"], s.font, "serif"));
  d.setAttribute("data-width", pick(["narrow", "medium", "wide"], s.width, "medium"));
})();
