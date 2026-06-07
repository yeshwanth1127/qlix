"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { AiBrainKnowledgeDocumentRow } from "@/lib/ai-brain-api";
import "./NeuralBrainVisualizer.css";

const TAU = Math.PI * 2;

/** Cyberpunk accent palette (cyan, magenta, violet, + blends). */
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 245, 255], // cyan
  [255, 0, 170], // magenta
  [123, 0, 255], // violet
  [0, 255, 180], // teal
  [120, 170, 255], // ice
  [255, 90, 210], // pink
];

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface NeuronInput {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly color: readonly [number, number, number];
}

interface EngineNode {
  id: string;
  label: string;
  group: string;
  color: readonly [number, number, number];
  ux: number;
  uy: number;
  uz: number;
  ru: number;
  baseSize: number;
  phase: number;
  spawn: number;
  // per-frame projection
  sx: number;
  sy: number;
  depth: number;
  scale: number;
}

interface Edge {
  a: number;
  b: number;
}

interface Signal {
  edge: number;
  p: number;
  speed: number;
}

interface Ring {
  node: EngineNode;
  age: number;
  life: number;
}

const MAX_NODES = 96;

class NeuralEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private wCss = 0;
  private hCss = 0;
  private raf = 0;
  private running = false;
  private last = 0;
  private clock = 0;

  private nodes: EngineNode[] = [];
  private edges: Edge[] = [];
  private signals: Signal[] = [];
  private rings: Ring[] = [];

  private yaw = 0.3;
  private pitch = -0.12;
  private yawVel = 0;
  private pitchVel = 0;
  private dragging = false;
  private lastPx = 0;
  private lastPy = 0;
  private pointerX = -9999;
  private pointerY = -9999;
  private hovered = -1;
  private signalTimer = 0;
  private statTimer = 0;
  private reduce = false;

  private onStats: (s: { nodes: number; edges: number }) => void;

  constructor(canvas: HTMLCanvasElement, onStats: (s: { nodes: number; edges: number }) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.onStats = onStats;
    this.reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.style.touchAction = "none";
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
    if (this.dragging) {
      const dx = e.clientX - this.lastPx;
      const dy = e.clientY - this.lastPy;
      this.lastPx = e.clientX;
      this.lastPy = e.clientY;
      this.yaw += dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2);
      this.yawVel = dx * 0.006;
      this.pitchVel = dy * 0.006;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    this.canvas.releasePointerCapture?.(e.pointerId);
  };

  private onPointerLeave = () => {
    this.dragging = false;
    this.pointerX = -9999;
    this.pointerY = -9999;
  };

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.wCss = Math.max(1, rect.width);
    this.hCss = Math.max(1, rect.height);
    this.dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.canvas.width = Math.round(this.wCss * this.dpr);
    this.canvas.height = Math.round(this.hCss * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  sync(inputs: readonly NeuronInput[]) {
    const capped = inputs.slice(0, MAX_NODES);
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const next: EngineNode[] = [];
    for (const inp of capped) {
      const existing = byId.get(inp.id);
      if (existing) {
        existing.label = inp.label;
        existing.group = inp.group;
        existing.color = inp.color;
        next.push(existing);
      } else {
        const node = this.makeNode(inp);
        next.push(node);
        this.rings.push({ node, age: 0, life: 1 });
      }
    }
    this.nodes = next;
    this.buildEdges();
    this.signals = [];
    this.onStats({ nodes: this.nodes.length, edges: this.edges.length });
  }

  private makeNode(inp: NeuronInput): EngineNode {
    // uniform random direction on the unit sphere
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * TAU;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    return {
      id: inp.id,
      label: inp.label,
      group: inp.group,
      color: inp.color,
      ux: s * Math.cos(theta),
      uy: u,
      uz: s * Math.sin(theta),
      ru: 0.82 + Math.random() * 0.22,
      baseSize: 3.4 + Math.random() * 1.8,
      phase: Math.random() * TAU,
      spawn: 0,
      sx: 0,
      sy: 0,
      depth: 0,
      scale: 1,
    };
  }

  private buildEdges() {
    const n = this.nodes.length;
    this.edges = [];
    if (n < 2) return;
    const K = n <= 6 ? 2 : 3;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const a = this.nodes[i]!;
      const ax = a.ux * a.ru;
      const ay = a.uy * a.ru;
      const az = a.uz * a.ru;
      const dists: { j: number; d: number }[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = this.nodes[j]!;
        const dx = ax - b.ux * b.ru;
        const dy = ay - b.uy * b.ru;
        const dz = az - b.uz * b.ru;
        const bias = a.group === b.group ? 0.55 : 1;
        dists.push({ j, d: (dx * dx + dy * dy + dz * dz) * bias });
      }
      dists.sort((p, q) => p.d - q.d);
      for (let k = 0; k < Math.min(K, dists.length); k++) {
        const j = dists[k]!.j;
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.edges.push({ a: i, b: j });
        }
      }
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.clock += dt;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const f = dt / 16.67;
    if (!this.dragging) {
      const autoSpin = this.reduce ? 0 : 0.0016 * dt;
      this.yaw += autoSpin + this.yawVel;
      this.yawVel *= 0.94;
      this.pitch = clamp(this.pitch + this.pitchVel, -1.2, 1.2);
      this.pitchVel *= 0.9;
    }

    for (const node of this.nodes) {
      if (node.spawn < 1) node.spawn = Math.min(1, node.spawn + 0.045 * f);
      node.phase += 0.04 * f;
    }

    // spawn signals along edges
    this.signalTimer -= dt;
    if (this.signalTimer <= 0 && this.edges.length > 0 && !this.reduce) {
      this.signalTimer = 90 + Math.random() * 180;
      const burst = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < burst; i++) {
        this.signals.push({
          edge: Math.floor(Math.random() * this.edges.length),
          p: 0,
          speed: 0.006 + Math.random() * 0.012,
        });
      }
    }
    for (const sig of this.signals) sig.p += sig.speed * f;
    this.signals = this.signals.filter((s) => s.p < 1 && s.edge < this.edges.length);

    for (const ring of this.rings) ring.age += 0.02 * f;
    this.rings = this.rings.filter((r) => r.age < r.life);

    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 600;
      this.onStats({ nodes: this.nodes.length, edges: this.edges.length });
    }
  }

  private project() {
    const cx = this.wCss / 2;
    const cy = this.hCss / 2;
    const breath = 1 + (this.reduce ? 0 : 0.035 * Math.sin(this.clock * 0.0011));
    const base = Math.min(this.wCss, this.hCss) * 0.34;
    const load = clamp(this.nodes.length / 44, 0, 1);
    const R = base * (0.72 + 0.28 * load) * breath;
    const camDist = R * 3.2;
    const cyaw = Math.cos(this.yaw);
    const syaw = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);

    for (const node of this.nodes) {
      const x = node.ux * node.ru * R;
      const y = node.uy * node.ru * R;
      const z = node.uz * node.ru * R;
      const x1 = x * cyaw + z * syaw;
      const z1 = -x * syaw + z * cyaw;
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const scale = camDist / (camDist - z2);
      node.sx = cx + x1 * scale;
      node.sy = cy + y1 * scale;
      node.depth = z2 / R; // -1 (far) .. +1 (near)
      node.scale = scale;
    }
    return { cx, cy, R, breath, load };
  }

  private draw() {
    const ctx = this.ctx;
    const { cx, cy, R, breath, load } = this.project();

    // motion-trail fade
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0, 0, 15, 0.34)";
    ctx.fillRect(0, 0, this.wCss, this.hCss);

    // hover detection
    this.hovered = -1;
    if (this.pointerX > -9000) {
      let best = 24 * 24;
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i]!;
        const dx = n.sx - this.pointerX;
        const dy = n.sy - this.pointerY;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          this.hovered = i;
        }
      }
    }

    ctx.globalCompositeOperation = "lighter";

    // edges
    for (const e of this.edges) {
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      if (!a || !b) continue;
      const front = clamp((a.depth + b.depth) * 0.5 * 0.5 + 0.5, 0, 1);
      const alpha = (0.05 + 0.2 * front) * Math.min(a.spawn, b.spawn);
      if (alpha <= 0.01) continue;
      const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
      grad.addColorStop(0, `rgba(${a.color[0]},${a.color[1]},${a.color[2]},${alpha})`);
      grad.addColorStop(1, `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.5 + front * 1.1;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // signals travelling along edges
    for (const sig of this.signals) {
      const e = this.edges[sig.edge];
      if (!e) continue;
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      if (!a || !b) continue;
      const x = a.sx + (b.sx - a.sx) * sig.p;
      const y = a.sy + (b.sy - a.sy) * sig.p;
      const col = sig.p < 0.5 ? a.color : b.color;
      const fade = Math.sin(sig.p * Math.PI);
      ctx.shadowBlur = 14;
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.1, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // shockwave rings on new neurons
    for (const ring of this.rings) {
      const n = ring.node;
      const t = ring.age / ring.life;
      const rad = 6 + t * 60 * n.scale;
      const alpha = (1 - t) * 0.5 * n.spawn;
      ctx.strokeStyle = `rgba(${n.color[0]},${n.color[1]},${n.color[2]},${alpha})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, rad, 0, TAU);
      ctx.stroke();
    }

    // central core (the "brain")
    this.drawCore(cx, cy, R, breath, load);

    // neurons, painted back-to-front
    const order = this.nodes.map((_, i) => i).sort((p, q) => this.nodes[p]!.depth - this.nodes[q]!.depth);
    for (const i of order) {
      const n = this.nodes[i]!;
      const depthAlpha = clamp(0.32 + (n.depth + 1) * 0.34, 0, 1);
      const pulse = 1 + 0.18 * Math.sin(n.phase);
      const size = n.baseSize * n.scale * pulse * (0.4 + 0.6 * n.spawn);
      const a = depthAlpha * n.spawn;
      const [r, g, bch] = n.color;
      const isHover = i === this.hovered;
      const hb = isHover ? 1.6 : 1;

      // outer diffuse halo
      ctx.shadowBlur = size * 5 * hb;
      ctx.shadowColor = `rgba(${r},${g},${bch},0.9)`;
      ctx.fillStyle = `rgba(${r},${g},${bch},${0.1 * a})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, size * 1.15 * hb, 0, TAU);
      ctx.fill();

      // mid glow
      ctx.shadowBlur = size * 2.2 * hb;
      ctx.fillStyle = `rgba(${r},${g},${bch},${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, size * 0.7, 0, TAU);
      ctx.fill();

      // bright core
      ctx.shadowBlur = size * 1.2 * hb;
      ctx.fillStyle = `rgba(255,255,255,${0.92 * a})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, size * 0.34, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isHover) this.drawLabel(n);
    }

    ctx.globalCompositeOperation = "source-over";
  }

  private drawCore(cx: number, cy: number, R: number, breath: number, load: number) {
    const ctx = this.ctx;
    const pulse = 1 + 0.12 * Math.sin(this.clock * 0.003);
    const coreR = R * (0.07 + 0.05 * load) * breath * pulse + 6;
    const intensity = 0.35 + 0.5 * load;

    ctx.shadowBlur = coreR * 4;
    ctx.shadowColor = "rgba(0,245,255,0.9)";
    ctx.fillStyle = `rgba(0,245,255,${0.12 * intensity})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.1, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = coreR * 2.4;
    ctx.shadowColor = "rgba(123,0,255,0.9)";
    ctx.fillStyle = `rgba(123,0,255,${0.4 * intensity})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.1, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = coreR * 1.6;
    ctx.shadowColor = "rgba(0,245,255,1)";
    ctx.fillStyle = `rgba(255,255,255,${0.85})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.5, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawLabel(n: EngineNode) {
    const ctx = this.ctx;
    const text = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "11px 'Space Mono', monospace";
    const w = ctx.measureText(text).width + 16;
    const h = 22;
    const x = clamp(n.sx + 12, 6, this.wCss - w - 6);
    const y = clamp(n.sy - 28, 6, this.hCss - h - 6);
    ctx.fillStyle = "rgba(0,8,18,0.82)";
    ctx.strokeStyle = `rgba(${n.color[0]},${n.color[1]},${n.color[2]},0.8)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(234,253,255,0.95)";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 8, y + h / 2 + 1);
    ctx.globalCompositeOperation = "lighter";
  }
}

export interface NeuralBrainVisualizerProps {
  readonly documents: readonly AiBrainKnowledgeDocumentRow[];
  readonly loading?: boolean;
  readonly heightClass?: string;
}

export function NeuralBrainVisualizer({
  documents,
  loading = false,
  heightClass = "h-[560px]",
}: NeuralBrainVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeuralEngine | null>(null);
  const [stats, setStats] = useState<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 });

  const neurons = useMemo<NeuronInput[]>(
    () =>
      documents.map((d) => ({
        id: d.id,
        label: d.title || "Untitled",
        group: d.collectionName,
        color: PALETTE[hashIndex(d.collectionName, PALETTE.length)]!,
      })),
    [documents],
  );

  const legend = useMemo(() => {
    const map = new Map<string, readonly [number, number, number]>();
    for (const d of documents) {
      if (!map.has(d.collectionName)) {
        map.set(d.collectionName, PALETTE[hashIndex(d.collectionName, PALETTE.length)]!);
      }
    }
    return Array.from(map.entries()).slice(0, 6);
  }, [documents]);

  // create engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: NeuralEngine;
    try {
      engine = new NeuralEngine(canvas, setStats);
    } catch {
      return;
    }
    engineRef.current = engine;
    engine.resize();
    engine.start();

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // sync neurons whenever documents change
  useEffect(() => {
    engineRef.current?.sync(neurons);
  }, [neurons]);

  const load = clamp(Math.round((documents.length / 64) * 100), documents.length > 0 ? 4 : 0, 100);

  return (
    <div className={`nbv-root ${heightClass}`}>
      <canvas ref={canvasRef} className="nbv-canvas" aria-label="Neural knowledge map" />

      {/* effect overlays */}
      <div className="nbv-overlay nbv-vignette" aria-hidden />
      <div className="nbv-overlay nbv-scanlines" aria-hidden />
      <div className="nbv-overlay" aria-hidden>
        <div className="nbv-scanbeam" />
      </div>
      <div className="nbv-overlay nbv-grain" aria-hidden />

      {/* HUD */}
      <div className="nbv-hud">
        <motion.div
          className="nbv-topbar"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <div>
            <h2 className="nbv-title" data-text="AI BRAIN">
              AI BRAIN
            </h2>
            <p className="nbv-subtitle">Neural knowledge cortex</p>
          </div>
          <div className="nbv-statgrid">
            <div className="nbv-stat">
              <div className="nbv-stat__value">{documents.length}</div>
              <div className="nbv-stat__label">Neurons</div>
            </div>
            <div className="nbv-stat">
              <div className="nbv-stat__value nbv-stat__value--magenta">{stats.edges}</div>
              <div className="nbv-stat__label">Synapses</div>
            </div>
            <div className="nbv-stat">
              <div className="nbv-stat__value nbv-stat__value--violet">{load}%</div>
              <div className="nbv-stat__label">Cognition</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="nbv-bottombar"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        >
          <div className="nbv-legend">
            {legend.map(([name, color]) => (
              <div key={name} className="nbv-legend__item">
                <span
                  className="nbv-legend__dot"
                  style={{ color: `rgb(${color[0]},${color[1]},${color[2]})` }}
                />
                {name}
              </div>
            ))}
          </div>
          <div className="nbv-hint">Drag to rotate · hover a neuron</div>
        </motion.div>
      </div>

      {documents.length === 0 && !loading ? (
        <div className="nbv-empty">
          <div className="nbv-empty__title">CORTEX DORMANT</div>
          <div className="nbv-empty__sub">
            Ingest documents in the Knowledge tab — each becomes a glowing neuron in the network.
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="nbv-loading">
          <span className="nbv-loading__ring" />
          Initializing cortex…
        </div>
      ) : null}
    </div>
  );
}
