"use client";

import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AiBrainKnowledgeDocumentRow } from "@/lib/ai-brain-api";
import { cn } from "@/lib/utils/cn";
import { Loader2 } from "lucide-react";

const MAX_DOCS = 72;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function spherePoint(i: number, n: number, radius: number): THREE.Vector3 {
  if (n <= 0) return new THREE.Vector3(0, radius, 0);
  if (n === 1) return new THREE.Vector3(0, radius * 0.92, 0);
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius);
}

function truncateLabel(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Place label just past the node, along the ray from the brain core. */
function outwardFromCore(nodePos: THREE.Vector3, gap: number): [number, number, number] {
  const v = nodePos.clone();
  const len = v.length();
  if (len < 1e-6) return [0, gap + 0.55, 0];
  v.multiplyScalar((len + gap) / len);
  return [v.x, v.y, v.z];
}

function NodeLabel({
  position,
  role,
  title,
  detail,
  tone,
  distanceFactor = 5.2,
}: {
  position: [number, number, number];
  role: string;
  title: string;
  detail?: string;
  tone: "sky" | "amber" | "violet" | "emerald";
  distanceFactor?: number;
}) {
  const toneClasses = {
    sky: "border-sky-400/40 text-sky-100 shadow-sky-500/15",
    amber: "border-amber-400/40 text-amber-50 shadow-amber-500/15",
    violet: "border-violet-400/40 text-violet-50 shadow-violet-500/15",
    emerald: "border-emerald-400/40 text-emerald-50 shadow-emerald-500/15",
  } as const;

  return (
    <Html
      position={position}
      center
      distanceFactor={distanceFactor}
      zIndexRange={[200, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div
        className={cn(
          "max-w-[min(168px,34vw)] rounded-lg border bg-slate-950/90 px-2 py-1 shadow-xl backdrop-blur-md",
          toneClasses[tone],
        )}
      >
        <div className="text-[8px] font-bold uppercase tracking-widest text-white/70">{role}</div>
        <div className="truncate text-[11px] font-semibold leading-tight text-white">{title}</div>
        {detail ? <div className="mt-0.5 truncate text-[9px] leading-tight text-white/55">{detail}</div> : null}
      </div>
    </Html>
  );
}

function BrainCore({ onSelect, spin }: { onSelect: () => void; spin: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current && spin) mesh.current.rotation.y += dt * 0.12;
  });
  return (
    <mesh
      ref={mesh}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <icosahedronGeometry args={[0.58, 2]} />
      <meshStandardMaterial
        color="#3730a3"
        emissive="#6366f1"
        emissiveIntensity={0.9}
        metalness={0.45}
        roughness={0.22}
      />
    </mesh>
  );
}

function DocNode({
  position,
  color,
  selected,
  onClick,
}: {
  position: THREE.Vector3;
  color: string;
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const scale = selected ? 1.4 : 1;
  return (
    <mesh
      position={position}
      scale={scale}
      onClick={onClick}
    >
      <sphereGeometry args={[0.13, 20, 20]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 0.65 : 0.28}
        metalness={0.28}
        roughness={0.42}
      />
    </mesh>
  );
}

function Scene({
  documents,
  selectedId,
  setSelectedId,
  queryModelShort,
}: {
  documents: readonly AiBrainKnowledgeDocumentRow[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  queryModelShort: string;
}) {
  const displayDocs = useMemo(
    () => (documents.length > MAX_DOCS ? documents.slice(0, MAX_DOCS) : [...documents]),
    [documents],
  );

  const docPositions = useMemo(() => {
    const n = Math.max(displayDocs.length, 2);
    return displayDocs.map((_, i) => spherePoint(i, n, 3.05));
  }, [displayDocs]);

  const auditPos = useMemo(() => new THREE.Vector3(-2.15, 2.25, 0.95), []);
  const modelPos = useMemo(() => new THREE.Vector3(2.25, -1.85, 1.15), []);
  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const reduceMotion = prefersReducedMotion();
  const docLabelDistance = displayDocs.length > 24 ? 4.6 : 5.2;

  return (
    <>
      <ambientLight intensity={0.32} />
      <pointLight position={[7, 8, 6]} intensity={2} color="#38bdf8" />
      <pointLight position={[-7, -3, -5]} intensity={1.35} color="#e879f9" />
      <pointLight position={[-2, -7, 6]} intensity={0.85} color="#34d399" />
      <directionalLight position={[4, 10, 5]} intensity={0.55} color="#fde68a" />

      <group>
        <BrainCore onSelect={() => setSelectedId(null)} spin={!reduceMotion} />
        <NodeLabel
          position={[0, 1.05, 0]}
          role="Core"
          title="AI Brain"
          detail="Org RAG · embeddings hub"
          tone="sky"
        />

        <Line points={[origin, auditPos]} color="#fbbf24" lineWidth={1} opacity={0.42} transparent />
        <mesh
          position={auditPos}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(selectedId === "__audit__" ? null : "__audit__");
          }}
        >
          <boxGeometry args={[0.26, 0.26, 0.26]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#fbbf24"
            emissiveIntensity={selectedId === "__audit__" ? 0.7 : 0.35}
            metalness={0.35}
            roughness={0.35}
          />
        </mesh>
        <NodeLabel
          position={outwardFromCore(auditPos, 0.52)}
          role="Ledger"
          title="Audit (Layer 5)"
          detail="brain.query · ingest · policy"
          tone="amber"
        />

        <Line points={[origin, modelPos]} color="#c084fc" lineWidth={1} opacity={0.42} transparent />
        <mesh
          position={modelPos}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(selectedId === "__model__" ? null : "__model__");
          }}
        >
          <octahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial
            color="#7c3aed"
            emissive="#a78bfa"
            emissiveIntensity={selectedId === "__model__" ? 0.75 : 0.38}
            metalness={0.4}
            roughness={0.28}
          />
        </mesh>
        <NodeLabel
          position={outwardFromCore(modelPos, 0.48)}
          role="Model"
          title="Query model"
          detail={queryModelShort}
          tone="violet"
        />

        {displayDocs.map((doc, i) => {
          const pos = docPositions[i]!;
          const hue = hashHue(doc.collectionId);
          const col = new THREE.Color().setHSL(hue / 360, 0.75, 0.52);
          const hex = `#${col.getHexString()}`;
          return (
            <group key={doc.id}>
              <Line points={[origin, pos]} color={hex} lineWidth={1} opacity={0.32} transparent />
              <DocNode
                position={pos}
                color={hex}
                selected={selectedId === doc.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(selectedId === doc.id ? null : doc.id);
                }}
              />
              <NodeLabel
                position={outwardFromCore(pos, 0.36)}
                role="Document"
                title={truncateLabel(doc.title, 26)}
                detail={truncateLabel(`${doc.collectionName} · ${doc.chunkCount} chunks · ${doc.ingestStatus}`, 36)}
                tone="emerald"
                distanceFactor={docLabelDistance}
              />
            </group>
          );
        })}
      </group>

      <OrbitControls
        enableDamping
        dampingFactor={0.07}
        minDistance={4}
        maxDistance={14}
        autoRotate={!reduceMotion}
        autoRotateSpeed={0.4}
      />

      {!reduceMotion ? (
        <Sparkles count={48} scale={14} size={2} speed={0.25} opacity={0.4} color="#818cf8" />
      ) : null}
    </>
  );
}

export interface BrainLinkMap3DProps {
  readonly documents: readonly AiBrainKnowledgeDocumentRow[];
  readonly brain: { readonly queryModel: string } | null;
  readonly loading: boolean;
  /** Tailwind height class for the canvas/placeholder. Defaults to `h-[360px]`. */
  readonly heightClass?: string;
}

export function BrainLinkMap3D({
  documents,
  brain,
  loading,
  heightClass = "h-[360px]",
}: BrainLinkMap3DProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedInfo = useMemo(() => {
    if (!brain) return null;
    if (selectedId === "__audit__") {
      return {
        title: "Audit ledger",
        subtitle: "Layer 5 — brain.query, ingest, and policy signals attributed to this workspace.",
        chip: "Ledger",
        chipClass: "bg-amber-500/20 text-amber-300 border-amber-400/40",
      };
    }
    if (selectedId === "__model__") {
      return {
        title: "Query model",
        subtitle: brain.queryModel,
        chip: "RAG",
        chipClass: "bg-violet-500/20 text-violet-200 border-violet-400/40",
      };
    }
    const d = documents.find((x) => x.id === selectedId);
    if (!d) return null;
    return {
      title: d.title,
      subtitle: `${d.collectionName} · ${d.chunkCount} chunks · ${d.ingestStatus}`,
      chip: "Document",
      chipClass: "bg-cyan-500/15 text-cyan-200 border-cyan-400/35",
    };
  }, [brain, documents, selectedId]);

  if (loading) {
    return (
      <div className={cn("relative flex items-center justify-center bg-gradient-to-b from-indigo-950/40 via-[--bg-base] to-cyan-950/25", heightClass)}>
        <Loader2 className="size-8 animate-spin text-cyan-400" aria-hidden />
      </div>
    );
  }

  if (!brain) {
    return (
      <div className={cn("relative flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-violet-950/35 via-[--bg-base] to-fuchsia-950/20 px-6 text-center", heightClass)}>
        <p className="max-w-sm text-[13px] text-[--text-secondary]">
          Provision the brain agent to open the 3D link map. Every ingested document will connect to the core for RAG and audit.
        </p>
      </div>
    );
  }

  const truncatedTotal = documents.length > MAX_DOCS;

  return (
    <div className="relative">
      <div
        className={cn(
          "relative cursor-grab overflow-hidden bg-gradient-to-b from-indigo-950/50 via-[--bg-base] to-sky-950/35 active:cursor-grabbing dark:from-indigo-950/60 dark:to-sky-950/45",
          heightClass,
        )}
        style={{ touchAction: "none" }}
      >
        <Canvas
          className="size-full"
          camera={{ position: [0, 0.65, 8.2], fov: 48 }}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
        >
          <Suspense fallback={null}>
            <Scene
              documents={documents}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              queryModelShort={truncateLabel(brain.queryModel, 38)}
            />
          </Suspense>
        </Canvas>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-violet-500/20 bg-gradient-to-r from-indigo-950/20 via-transparent to-cyan-950/20 px-3 py-2.5 dark:from-indigo-950/35 dark:to-cyan-950/25">
        {selectedInfo ? (
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${selectedInfo.chipClass}`}
              >
                {selectedInfo.chip}
              </span>
              <span className="truncate text-[13px] font-medium text-[--text-primary]">{selectedInfo.title}</span>
            </div>
            <p className="break-words font-mono text-[11px] leading-snug text-[--text-secondary]">{selectedInfo.subtitle}</p>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-[--text-tertiary]">
            <span className="font-medium text-cyan-600 dark:text-cyan-400">Drag</span> to orbit ·{" "}
            <span className="font-medium text-violet-600 dark:text-violet-400">Scroll</span> to zoom ·{" "}
            <span className="font-medium text-fuchsia-600 dark:text-fuchsia-400">Click</span> the core, documents, ledger, or model.
          </p>
        )}
        {truncatedTotal ? (
          <span className="shrink-0 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-200">
            Showing {MAX_DOCS} of {documents.length} docs
          </span>
        ) : null}
      </div>
    </div>
  );
}
