"use client";

import Grainient from "./Grainient";

/**
 * Fixed, full-viewport animated gradient that sits behind all dashboard chrome.
 * Tuned to dark, low-saturation tones so the frosted `qlix-glass-*` panels read
 * clearly on top. `pointer-events-none` keeps it purely decorative.
 */
export function DashboardBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-screen w-screen"
    >
      <Grainient
        color1="#1e3253"
        color2="#10131c"
        color3="#0a0a0b"
        timeSpeed={0.12}
        warpStrength={1.0}
        warpAmplitude={70.0}
        rotationAmount={420.0}
        noiseScale={1.6}
        grainAmount={0.07}
        contrast={1.15}
        saturation={0.85}
        zoom={1.15}
      />
    </div>
  );
}
