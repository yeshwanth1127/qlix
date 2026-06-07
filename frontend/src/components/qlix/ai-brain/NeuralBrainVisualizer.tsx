"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { AiBrainKnowledgeDocumentRow } from "@/lib/ai-brain-api";
import "./NeuralBrainVisualizer.css";

const TAU = Math.PI * 2;

/** Refined, restrained accent palette — soft enough to read against dark, distinct per collection. */
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [125, 211, 252], // sky
  [167, 139, 250], // violet
  [94, 234, 212], // teal
  [244, 114, 182], // pink
  [251, 191, 36], // amber
  [129, 140, 248], // indigo
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

  private yaw = 0.3;
  private pitch = -0.1;
  private yawVel = 0;
  private pitchVel = 0;
  private dragging = false;
  private moved = false;
  private downX = 0;
  private downY = 0;
  private lastPx = 0;
  private lastPy = 0;
  private pointerX = -9999;
  private pointerY = -9999;
  private hovered = -1;
  private selectedId: string | null = null;
  private signalTimer = 0;
  private statTimer = 0;
  private reduce = false;

  private onStats: (s: { nodes: number; edges: number }) => void;
  private onSelect: (id: string | null) => void;

  constructor(
    canvas: HTMLCanvasElement,
    onStats: (s: { nodes: number; edges: number }) => void,
    onSelect: (id: string | null) => void,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.onStats = onStats;
    this.onSelect = onSelect;
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

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.moved = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
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
      if (Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 4) {
        this.moved = true;
      }
      this.yaw += dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2);
      this.yawVel = dx * 0.006;
      this.pitchVel = dy * 0.006;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.canvas.releasePointerCapture?.(e.pointerId);
    const wasDragging = this.dragging;
    this.dragging = false;
    // A click (no meaningful drag) selects the neuron under the cursor, or
    // clears the selection when clicking empty space.
    if (wasDragging && !this.moved) {
      const rect = this.canvas.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      const id = hit >= 0 ? this.nodes[hit]!.id : null;
      this.selectedId = id;
      this.onSelect(id);
    }
  };

  private onPointerLeave = () => {
    this.dragging = false;
    this.pointerX = -9999;
    this.pointerY = -9999;
  };

  private hitTest(px: number, py: number): number {
    let best = 26 * 26;
    let idx = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]!;
      const dx = n.sx - px;
      const dy = n.sy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        idx = i;
      }
    }
    return idx;
  }

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
        next.push(this.makeNode(inp));
      }
    }
    this.nodes = next;
    this.buildEdges();
    this.signals = [];
    if (this.selectedId && !byId.has(this.selectedId) && !next.some((n) => n.id === this.selectedId)) {
      this.selectedId = null;
      this.onSelect(null);
    }
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
      ru: 0.84 + Math.random() * 0.18,
      baseSize: 3.2 + Math.random() * 1.4,
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
    // Clamp to a non-negative step: rAF timestamps can jump backwards across
    // tab-resume/visibility changes, and a negative dt would run the simulation
    // in reverse.
    const dt = Math.min(50, Math.max(0, now - this.last));
    this.last = now;
    this.clock += dt;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const f = dt / 16.67;
    if (!this.dragging) {
      const autoSpin = this.reduce ? 0 : 0.0012 * dt;
      this.yaw += autoSpin + this.yawVel;
      this.yawVel *= 0.94;
      this.pitch = clamp(this.pitch + this.pitchVel, -1.2, 1.2);
      this.pitchVel *= 0.9;
    }

    for (const node of this.nodes) {
      if (node.spawn < 1) node.spawn = Math.min(1, node.spawn + 0.05 * f);
      node.phase += 0.03 * f;
    }

    // signals travel only along edges touching the selected neuron — keeps the
    // resting state calm and minimal, with motion focused on what you picked.
    this.signalTimer -= dt;
    if (this.signalTimer <= 0 && this.edges.length > 0 && !this.reduce) {
      this.signalTimer = 140 + Math.random() * 220;
      const selIdx = this.selectedId ? this.nodes.findIndex((n) => n.id === this.selectedId) : -1;
      const pool =
        selIdx >= 0
          ? this.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.a === selIdx || e.b === selIdx)
          : this.edges.map((e, i) => ({ e, i }));
      if (pool.length > 0) {
        const pick = pool[Math.floor(Math.random() * pool.length)]!;
        this.signals.push({ edge: pick.i, p: 0, speed: 0.007 + Math.random() * 0.01 });
      }
    }
    for (const sig of this.signals) sig.p += sig.speed * f;
    this.signals = this.signals.filter((s) => s.p < 1 && s.edge < this.edges.length);

    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 600;
      this.onStats({ nodes: this.nodes.length, edges: this.edges.length });
    }
  }

  private project() {
    const cx = this.wCss / 2;
    const cy = this.hCss / 2;
    const base = Math.min(this.wCss, this.hCss) * 0.34;
    const load = clamp(this.nodes.length / 44, 0, 1);
    const R = base * (0.74 + 0.26 * load);
    const camDist = R * 3.4;
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
    return { cx, cy, R };
  }

  private draw() {
    const ctx = this.ctx;
    const { cx, cy, R } = this.project();

    // Crisp clear each frame — the dark gradient lives in CSS behind the canvas,
    // so the graph reads cleanly with no ghost trails.
    ctx.clearRect(0, 0, this.wCss, this.hCss);

    // hover detection
    this.hovered = this.pointerX > -9000 ? this.hitTest(this.pointerX, this.pointerY) : -1;
    this.canvas.style.cursor = this.hovered >= 0 ? "pointer" : this.dragging ? "grabbing" : "grab";

    const selIdx = this.selectedId ? this.nodes.findIndex((n) => n.id === this.selectedId) : -1;

    ctx.globalCompositeOperation = "lighter";

    // edges — thin and quiet; the edges of a selected neuron brighten.
    for (const e of this.edges) {
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      if (!a || !b) continue;
      const front = clamp((a.depth + b.depth) * 0.25 + 0.5, 0, 1);
      const linked = selIdx >= 0 && (e.a === selIdx || e.b === selIdx);
      const dimmed = selIdx >= 0 && !linked;
      const base = dimmed ? 0.02 : 0.05 + 0.14 * front;
      const alpha = (linked ? base + 0.22 : base) * Math.min(a.spawn, b.spawn);
      if (alpha <= 0.01) continue;
      const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
      grad.addColorStop(0, `rgba(${a.color[0]},${a.color[1]},${a.color[2]},${alpha})`);
      grad.addColorStop(1, `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = linked ? 1.3 : 0.5 + front * 0.7;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // signals
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
      ctx.shadowBlur = 8;
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
      ctx.fillStyle = `rgba(255,255,255,${0.8 * fade})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // central core — small and understated
    this.drawCore(cx, cy, R);

    // neurons, painted back-to-front
    const order = this.nodes
      .map((_, i) => i)
      .sort((p, q) => this.nodes[p]!.depth - this.nodes[q]!.depth);
    for (const i of order) {
      const n = this.nodes[i]!;
      const depthAlpha = clamp(0.4 + (n.depth + 1) * 0.3, 0, 1);
      const isSelected = i === selIdx;
      const isHover = i === this.hovered;
      const dimmed = selIdx >= 0 && !isSelected;
      const emphasis = isSelected ? 1.5 : isHover ? 1.25 : 1;
      const pulse = 1 + 0.12 * Math.sin(n.phase);
      const size = n.baseSize * n.scale * pulse * (0.4 + 0.6 * n.spawn) * emphasis;
      const a = depthAlpha * n.spawn * (dimmed ? 0.4 : 1);
      const [r, g, bch] = n.color;

      // soft halo
      ctx.shadowBlur = size * (isSelected ? 4 : 2.6);
      ctx.shadowColor = `rgba(${r},${g},${bch},0.85)`;
      ctx.fillStyle = `rgba(${r},${g},${bch},${0.45 * a})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, size * 0.72, 0, TAU);
      ctx.fill();

      // bright core
      ctx.shadowBlur = size * 1.1;
      ctx.fillStyle = `rgba(255,255,255,${0.92 * a})`;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, size * 0.34, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      // selection ring
      if (isSelected) {
        ctx.globalCompositeOperation = "source-over";
        const ringR = size * 1.4 + 6;
        ctx.strokeStyle = `rgba(${r},${g},${bch},0.9)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, ringR, 0, TAU);
        ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
      }
    }

    // labels (selected always, hover transiently) — drawn on top, no glow
    if (selIdx >= 0) this.drawLabel(this.nodes[selIdx]!);
    if (this.hovered >= 0 && this.hovered !== selIdx) this.drawLabel(this.nodes[this.hovered]!);

    ctx.globalCompositeOperation = "source-over";
  }

  private drawCore(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const pulse = 1 + 0.08 * Math.sin(this.clock * 0.0024);
    const coreR = R * 0.05 * pulse + 4;

    ctx.shadowBlur = coreR * 3;
    ctx.shadowColor = "rgba(160,180,255,0.7)";
    ctx.fillStyle = "rgba(160,180,255,0.18)";
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.8, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = coreR * 1.4;
    ctx.shadowColor = "rgba(200,215,255,0.9)";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.5, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawLabel(n: EngineNode) {
    const ctx = this.ctx;
    const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 18;
    const h = 24;
    const x = clamp(n.sx + 14, 6, this.wCss - w - 6);
    const y = clamp(n.sy - 30, 6, this.hCss - h - 6);
    ctx.fillStyle = "rgba(10,12,20,0.9)";
    ctx.strokeStyle = `rgba(${n.color[0]},${n.color[1]},${n.color[2]},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(235,240,255,0.96)";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 9, y + h / 2 + 1);
  }
}

export interface NeuralBrainVisualizerProps {
  readonly documents: readonly AiBrainKnowledgeDocumentRow[];
  readonly loading?: boolean;
  readonly heightClass?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function NeuralBrainVisualizer({
  documents,
  loading = false,
  heightClass = "h-[560px]",
}: NeuralBrainVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeuralEngine | null>(null);
  const [stats, setStats] = useState<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId],
  );
  const selectedColor = selectedDoc
    ? PALETTE[hashIndex(selectedDoc.collectionName, PALETTE.length)]!
    : null;

  // create engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: NeuralEngine;
    try {
      engine = new NeuralEngine(canvas, setStats, setSelectedId);
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

  // keep the engine's selection in step with React state
  useEffect(() => {
    engineRef.current?.setSelected(selectedId);
  }, [selectedId]);

  const load = clamp(
    Math.round((documents.length / 64) * 100),
    documents.length > 0 ? 4 : 0,
    100,
  );

  return (
    <div className={`nbv-root ${heightClass}`}>
      <canvas ref={canvasRef} className="nbv-canvas" aria-label="Neural knowledge map" />

      {/* HUD */}
      <div className="nbv-hud">
        <div className="nbv-topbar">
          <div>
            <h2 className="nbv-title">AI Brain</h2>
            <p className="nbv-subtitle">Neural knowledge map</p>
          </div>
          <div className="nbv-stats">
            <div className="nbv-stat">
              <span className="nbv-stat__value">{documents.length}</span>
              <span className="nbv-stat__label">Neurons</span>
            </div>
            <span className="nbv-stat__sep" aria-hidden />
            <div className="nbv-stat">
              <span className="nbv-stat__value">{stats.edges}</span>
              <span className="nbv-stat__label">Links</span>
            </div>
            <span className="nbv-stat__sep" aria-hidden />
            <div className="nbv-stat">
              <span className="nbv-stat__value">{load}%</span>
              <span className="nbv-stat__label">Loaded</span>
            </div>
          </div>
        </div>

        <div className="nbv-bottombar">
          {legend.length > 0 ? (
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
          ) : (
            <span />
          )}
          <div className="nbv-hint">Drag to rotate · click a neuron</div>
        </div>
      </div>

      {/* Selected neuron detail card */}
      <AnimatePresence>
        {selectedDoc && selectedColor ? (
          <motion.div
            key={selectedDoc.id}
            className="nbv-detail"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{
              ["--nbv-detail-accent" as string]: `rgb(${selectedColor[0]},${selectedColor[1]},${selectedColor[2]})`,
            }}
          >
            <div className="nbv-detail__head">
              <span className="nbv-detail__dot" />
              <span className="nbv-detail__collection">{selectedDoc.collectionName}</span>
              <button
                type="button"
                className="nbv-detail__close"
                aria-label="Close"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            </div>
            <div className="nbv-detail__title">{selectedDoc.title || "Untitled"}</div>
            <div className="nbv-detail__meta">
              <span>
                {selectedDoc.chunkCount} chunk{selectedDoc.chunkCount === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>{formatDate(selectedDoc.createdAt)}</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {documents.length === 0 && !loading ? (
        <div className="nbv-empty">
          <div className="nbv-empty__title">No neurons yet</div>
          <div className="nbv-empty__sub">
            Ingest documents in the Knowledge tab — each becomes a node in the map.
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="nbv-loading">
          <span className="nbv-loading__ring" />
          Loading map…
        </div>
      ) : null}
    </div>
  );
}
