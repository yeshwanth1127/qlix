"use client";

import { useEffect, useRef } from "react";

// ── Shapes ────────────────────────────────────────────────────────────────────
// The particle field is the brand mark. It starts SCRAMBLED, then re-forms into a
// line-art shape on each conversation turn, anchored to one half of the screen
// (the chat reply lives on the other half — see the page layout).
export type ConstellationShape = "scramble" | "brain" | "bulb" | "gear" | "rocket" | "check";

// Cadence for the shape cycle once the field has formed.
const CYCLE_MS = 2500;

// Emoji glyphs folded into the cycle — sampled as silhouettes (we only use the
// glyph's shape; colour comes from the particle palette).
const CYCLE_EMOJI = [
  "🤖", "💬", "🔒", "📊", "🎯", "⭐", "⚡", "🌐", "🔑", "🧩", "📌", "💎",
  "🧠", "💡", "🚀", "✅", "🛡️", "📁", "🔎", "✨", "🧪", "🔧", "👥", "💻",
  "📝", "🔔", "🎨", "🏗️", "🦾", "📡", "🧬", "🪄", "🗂️", "🔗", "📈", "🎮",
];
const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

type CycleEntry =
  | { kind: "shape"; shape: Exclude<ConstellationShape, "scramble"> }
  | { kind: "emoji"; glyph: string };

const CYCLE: CycleEntry[] = [
  { kind: "shape", shape: "brain" },
  { kind: "shape", shape: "bulb" },
  { kind: "shape", shape: "gear" },
  { kind: "shape", shape: "rocket" },
  { kind: "shape", shape: "check" },
  ...CYCLE_EMOJI.map((glyph) => ({ kind: "emoji" as const, glyph })),
];
export type ConstellationSide = "left" | "right" | "center";

// Back-compat alias — pages used to pass a `phase`; the active surface now drives
// `shape` + `side` directly.
export type ConstellationPhase = ConstellationShape;

// lucide-react line-art path data (24×24 viewBox), traced by the particles.
const SHAPE_PATHS: Record<Exclude<ConstellationShape, "scramble">, string[]> = {
  brain: [
    "M12 18V5",
    "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
    "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5",
    "M17.997 5.125a4 4 0 0 1 2.526 5.77",
    "M18 18a4 4 0 0 0 2-7.464",
    "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
    "M6 18a4 4 0 0 1-2-7.464",
    "M6.003 5.125a4 4 0 0 0-2.526 5.77",
  ],
  bulb: [
    "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
    "M9 18h6",
    "M10 22h4",
  ],
  gear: [
    "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
    "M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0z",
  ],
  rocket: [
    "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
    "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09",
    "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z",
    "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05",
  ],
  check: ["M20 6 9 17l-5-5"],
};

// ── Palette — ink on paper ─────────────────────────────────────────────────────
// On a light paper canvas particles are dark/saturated and use `multiply` blend,
// so overlaps read like layered ink rather than additive light.
type RGB = readonly [number, number, number];
const INK: RGB = [38, 32, 58];
const PLUM: RGB = [122, 77, 255];
const LICHEN: RGB = [21, 132, 110];
const AMBER: RGB = [214, 138, 8];

function pickColor(): RGB {
  const r = Math.random();
  if (r < 0.5) return INK;
  if (r < 0.8) return PLUM;
  if (r < 0.93) return LICHEN;
  return AMBER;
}

const N_SHAPE = 2300; // particles bound to the macro-shape (filled interior)
const N_FREE = 280; // sparse drift filling the paper around it
const SAMPLE_SIZE = 360; // offscreen raster resolution for shape sampling

interface Particle {
  cx: number; // current normalised position (shape-local), eased toward target
  cy: number;
  size: number;
  glyph: 0 | 1 | 2 | 3; // triangle | circle | diamond | square
  seed: number;
  tintBias: number;
  r: number;
  g: number;
  b: number;
  free: boolean;
  hx: number; // free-drift home
  hy: number;
}

// Sample the opaque pixels of an offscreen draw into a flat [x,y,…] array.
function rasterize(draw: (ctx: CanvasRenderingContext2D, size: number) => void): number[] {
  const S = SAMPLE_SIZE;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return [];
  draw(ctx, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const pts: number[] = [];
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      if (data[(y * S + x) * 4 + 3] > 80) pts.push(x, y);
    }
  }
  return pts;
}

// Rasterise lucide path data into points. We BOTH fill and stroke each subpath
// so the particles fill the shape's interior (implicitly-closed arcs fill their
// regions), not just trace the outline — open paths like the check just stroke.
function rasterizePaths(dList: string[]): number[] {
  return rasterize((ctx, S) => {
    const margin = S * 0.13;
    const scale = (S - margin * 2) / 24;
    ctx.translate(margin, margin);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (S * 0.02) / scale;
    for (const d of dList) {
      const path = new Path2D(d);
      ctx.fill(path);
      ctx.stroke(path);
    }
  });
}

function rasterizeEmoji(emoji: string): number[] {
  return rasterize((ctx, S) => {
    ctx.font = `${Math.floor(S * 0.68)}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000";
    ctx.fillText(emoji, S / 2, S / 2 + S * 0.02);
  });
}

// Normalise raw pixels into exactly N targets framed to [-1, 1].
function buildTargets(raw: number[], n: number, scale: number): Float32Array {
  const out = new Float32Array(n * 2);
  const count = raw.length / 2;
  if (count < 40) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * scale;
      out[2 * k] = Math.cos(a) * rad;
      out[2 * k + 1] = Math.sin(a) * rad;
    }
    return out;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < raw.length; i += 2) {
    const x = raw[i];
    const y = raw[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  for (let k = 0; k < n; k++) {
    const j = (Math.random() * count) | 0;
    out[2 * k] = ((raw[j * 2] - cx) / half) * scale + (Math.random() - 0.5) * 0.015;
    out[2 * k + 1] = ((raw[j * 2 + 1] - cy) / half) * scale + (Math.random() - 0.5) * 0.015;
  }
  return out;
}

function scrambleTargets(n: number): Float32Array {
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 0.25 + Math.pow(Math.random(), 0.5) * 1.25;
    out[2 * k] = Math.cos(a) * rad * 1.4;
    out[2 * k + 1] = Math.sin(a) * rad;
  }
  return out;
}

function buildShapeTargets(): Record<ConstellationShape, Float32Array> {
  return {
    scramble: scrambleTargets(N_SHAPE),
    brain: buildTargets(rasterizePaths(SHAPE_PATHS.brain), N_SHAPE, 0.95),
    bulb: buildTargets(rasterizePaths(SHAPE_PATHS.bulb), N_SHAPE, 0.9),
    gear: buildTargets(rasterizePaths(SHAPE_PATHS.gear), N_SHAPE, 0.95),
    rocket: buildTargets(rasterizePaths(SHAPE_PATHS.rocket), N_SHAPE, 0.95),
    check: buildTargets(rasterizePaths(SHAPE_PATHS.check), N_SHAPE, 0.82),
  };
}

function buildEmojiTargets(): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>();
  for (const emoji of CYCLE_EMOJI) {
    map.set(emoji, buildTargets(rasterizeEmoji(emoji), N_SHAPE, 0.88));
  }
  return map;
}

interface ParticleConstellationProps {
  readonly shape: ConstellationShape;
  readonly side?: ConstellationSide;
  readonly className?: string;
}

export function ParticleConstellation({ shape, side = "center", className }: ParticleConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<ConstellationShape>(shape);
  const sideRef = useRef<ConstellationSide>(side);

  useEffect(() => {
    shapeRef.current = shape;
    sideRef.current = side;
  }, [shape, side]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.mixBlendMode = "multiply"; // ink on paper
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      container.removeChild(canvas);
      return;
    }

    let shapeTargets = buildShapeTargets();
    let emojiTargets = buildEmojiTargets();
    // Re-sample once shortly after mount in case fonts/paths settled late.
    const retry = window.setTimeout(() => {
      shapeTargets = buildShapeTargets();
      emojiTargets = buildEmojiTargets();
    }, 250);
    const emojiRetry = window.setTimeout(() => {
      emojiTargets = buildEmojiTargets();
    }, 750);

    // Once formed, cycle line-art shapes + emoji silhouettes every CYCLE_MS.
    let cycleIdx = 0;
    const cycleTimer = window.setInterval(() => {
      if (shapeRef.current !== "scramble") cycleIdx = (cycleIdx + 1) % CYCLE.length;
    }, CYCLE_MS);

    const particles: Particle[] = [];
    const start = shapeTargets.scramble;
    for (let i = 0; i < N_SHAPE; i++) {
      const [r, g, b] = pickColor();
      particles.push({
        cx: start[2 * i],
        cy: start[2 * i + 1],
        size: 1.0 + Math.pow(Math.random(), 1.7) * 2.8,
        glyph: Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3,
        seed: Math.random() * Math.PI * 2,
        tintBias: Math.random(),
        r,
        g,
        b,
        free: false,
        hx: 0,
        hy: 0,
      });
    }
    for (let i = 0; i < N_FREE; i++) {
      const [r, g, b] = pickColor();
      const a = Math.random() * Math.PI * 2;
      const rad = 0.6 + Math.pow(Math.random(), 0.5) * 1.1;
      particles.push({
        cx: Math.cos(a) * rad,
        cy: Math.sin(a) * rad,
        size: 0.9 + Math.pow(Math.random(), 2) * 1.8,
        glyph: Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3,
        seed: Math.random() * Math.PI * 2,
        tintBias: Math.random(),
        r,
        g,
        b,
        free: true,
        hx: Math.cos(a) * rad,
        hy: Math.sin(a) * rad,
      });
    }

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 1;
    let h = 1;

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    // eased view state (so side flips + scale changes glide)
    let anchorX = w * 0.5;
    let anchorY = h * 0.5;
    let curR = Math.min(w, h) * 0.42;
    let unsettle = 1; // 1 while scrambled, 0 when formed

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();

    const drawGlyph = (p: Particle, x: number, y: number, s: number) => {
      switch (p.glyph) {
        case 1:
          ctx.beginPath();
          ctx.arc(x, y, s * 0.5, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 2:
          ctx.beginPath();
          ctx.moveTo(x, y - s * 0.6);
          ctx.lineTo(x + s * 0.6, y);
          ctx.lineTo(x, y + s * 0.6);
          ctx.lineTo(x - s * 0.6, y);
          ctx.closePath();
          ctx.fill();
          break;
        case 3:
          ctx.fillRect(x - s * 0.45, y - s * 0.45, s * 0.9, s * 0.9);
          break;
        default: {
          const hgt = s * 0.6;
          ctx.beginPath();
          ctx.moveTo(x, y - hgt);
          ctx.lineTo(x + s * 0.52, y + hgt * 0.7);
          ctx.lineTo(x - s * 0.52, y + hgt * 0.7);
          ctx.closePath();
          ctx.fill();
        }
      }
    };

    const loop = (now: number) => {
      const t = (now - t0) * 0.001;
      const curSide = sideRef.current;
      const scrambled = shapeRef.current === "scramble";
      if (scrambled) cycleIdx = 0; // start the cycle at brain once it forms
      let targets: Float32Array;
      if (scrambled) {
        targets = shapeTargets.scramble;
      } else {
        const cycleEntry = CYCLE[cycleIdx];
        targets =
          cycleEntry.kind === "shape"
            ? shapeTargets[cycleEntry.shape]
            : emojiTargets.get(cycleEntry.glyph) ?? shapeTargets.brain;
      }

      // eased targets for anchor / scale / restlessness
      const tAnchorX =
        scrambled || curSide === "center" ? w * 0.5 : curSide === "left" ? w * 0.16 : w * 0.84;
      const tAnchorY = h * 0.5;
      const tR = scrambled ? Math.min(w, h) * 0.5 : Math.min(w * 0.155, h * 0.3);
      const tUnsettle = scrambled ? 1 : 0;
      anchorX += (tAnchorX - anchorX) * 0.06;
      anchorY += (tAnchorY - anchorY) * 0.06;
      curR += (tR - curR) * 0.06;
      unsettle += (tUnsettle - unsettle) * 0.05;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";

      const breathe = 1 + Math.sin(t * 0.5) * 0.02;
      const ease = scrambled ? 0.02 : 0.075;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (p.free) {
          const ang = t * 0.05 + p.seed;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          p.cx = p.hx * ca - p.hy * sa + Math.sin(t * 0.4 + p.seed) * 0.03;
          p.cy = p.hx * sa + p.hy * ca + Math.cos(t * 0.35 + p.seed) * 0.03;
        } else {
          const tx = targets[2 * i];
          const ty = targets[2 * i + 1];
          p.cx += (tx - p.cx) * ease;
          p.cy += (ty - p.cy) * ease;
        }

        // restless shimmer while scrambled, gentle drift once formed
        const drift = 0.006 + unsettle * 0.05;
        const ox = (p.cx + Math.sin(t * 0.9 + p.seed) * drift) * breathe;
        const oy = (p.cy + Math.cos(t * 0.8 + p.seed * 1.3) * drift) * breathe;

        const x = anchorX + ox * curR;
        const y = anchorY + oy * curR;

        const pulse = 1 + 0.18 * Math.sin(t * 1.6 - Math.hypot(ox, oy) * 4 + p.seed);

        const mix = (scrambled ? 0.15 : 0.35) * p.tintBias;
        const r = p.r + (PLUM[0] - p.r) * mix;
        const g = p.g + (PLUM[1] - p.g) * mix;
        const b = p.b + (PLUM[2] - p.b) * mix;

        let alpha = (p.free ? 0.32 : 0.7) * pulse * (scrambled ? 0.75 : 1);
        alpha = Math.max(0, Math.min(0.9, alpha));

        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
        drawGlyph(p, x, y, p.size);
      }

      raf = requestAnimationFrame(loop);
    };

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) tryStart();
        else tryStop();
      },
      { threshold: 0 },
    );
    io.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) tryStart();
      else tryStop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryStart();

    return () => {
      tryStop();
      window.clearTimeout(retry);
      window.clearTimeout(emojiRetry);
      window.clearInterval(cycleTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        container.removeChild(canvas);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}

export default ParticleConstellation;
