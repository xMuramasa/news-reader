// The Endfield contour lines: 18 closed, wobbly rings around a point at 78 % / 72 % of the viewport, behind all content.
// Same formula as the macOS app (EndfieldBackground.swift). An inline <svg>: the CSP's img-src 'self' blocks data: images.
import { useEffect, useState } from "react";
import { resolvedTheme, useSettings } from "@/lib/settings";

const RINGS = 18;
const STEPS = 180;
const SETTLE_MS = 150;

/** The 18 rings as SVG path data, one closed path each. Deterministic for a size. */
export function contourPaths(w: number, h: number): string[] {
  const cx = w * 0.78;
  const cy = h * 0.72;
  const paths: string[] = [];
  for (let k = 1; k <= RINGS; k++) {
    const r0 = k * Math.min(w, h) * 0.045;
    let d = "";
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * 2 * Math.PI;
      const r = r0 * (1 + 0.1 * Math.sin(3 * t + k * 0.35) + 0.06 * Math.sin(5 * t - k * 0.2) + 0.04 * Math.sin(2 * t + 1.3));
      d += `${i === 0 ? "M" : "L"}${(cx + r * Math.cos(t) * 1.35).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
    }
    paths.push(`${d}Z`);
  }
  return paths;
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

export function EndfieldPaper() {
  const theme = resolvedTheme(useSettings());
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSize(viewport()), SETTLE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!theme.startsWith("endfield")) return null;
  return (
    <svg
      aria-hidden
      data-testid="endfield-paper"
      width={size.w}
      height={size.h}
      className="pointer-events-none fixed top-0 left-0 -z-10 fill-none stroke-contour print:hidden"
      strokeWidth={1}
    >
      {contourPaths(size.w, size.h).map((d, i) => (
        <path key={i} d={d} strokeOpacity={(i + 1) % 5 === 0 ? 0.9 : 0.55} />
      ))}
    </svg>
  );
}
