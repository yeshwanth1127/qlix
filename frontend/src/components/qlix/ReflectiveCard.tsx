"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import "./ReflectiveCard.css";

/* ─── Shared webcam stream (one permission prompt, many cards) ───────────── */
let _stream: MediaStream | null = null;
let _refs = 0;

async function acquireStream(): Promise<MediaStream | null> {
  if (_stream) {
    _refs++;
    return _stream;
  }
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    });
    _refs = 1;
    return _stream;
  } catch {
    // webcam unavailable — visual degrades gracefully to noise + sheen only
    return null;
  }
}

function releaseStream() {
  _refs = Math.max(0, _refs - 1);
  if (_refs === 0 && _stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export interface ReflectiveCardProps {
  children?: ReactNode;
  /** Blur applied to the webcam layer (px) */
  blurStrength?: number;
  /** Opacity of the metallic sheen gradient (0–1) */
  metalness?: number;
  /** Opacity of the noise texture (0–1) */
  roughness?: number;
  /** Semi-transparent tint over the webcam layer */
  overlayColor?: string;
  /** Displacement map scale — how much the surface warps */
  displacementStrength?: number;
  /** Noise tile size — larger = bigger ripples */
  noiseScale?: number;
  /** Specular shininess constant */
  specularConstant?: number;
  /** Desaturation of webcam feed (0 = full colour, 1 = greyscale) */
  grayscale?: number;
  /** Glass-edge distortion strength */
  glassDistortion?: number;
  /** Base text colour for content */
  color?: string;
  /** Classes applied to the outermost container (border-radius, overflow, sizing) */
  className?: string;
  /** Classes applied to the content wrapper (flex layout, padding, gap) */
  contentClassName?: string;
  style?: CSSProperties;
}

export function ReflectiveCard({
  children,
  blurStrength = 10,
  color = "white",
  metalness = 0.65,
  roughness = 0.38,
  overlayColor = "rgba(10, 10, 14, 0.50)",
  displacementStrength = 14,
  noiseScale = 1.3,
  specularConstant = 1.6,
  grayscale = 0.85,
  glassDistortion = 10,
  className = "",
  contentClassName = "",
  style = {},
}: ReflectiveCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Sanitise React's `:r0:` format to a valid CSS id fragment
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `rcf-${uid}`;

  useEffect(() => {
    let active = true;
    void acquireStream().then((s) => {
      if (!active || !s || !videoRef.current) return;
      videoRef.current.srcObject = s;
    });
    return () => {
      active = false;
      releaseStream();
    };
  }, []);

  const baseFreq = 0.03 / Math.max(0.1, noiseScale);
  const saturation = 1 - Math.max(0, Math.min(1, grayscale));

  const cssVars = {
    "--rc-blur": `${blurStrength}px`,
    "--rc-metalness": metalness,
    "--rc-roughness": roughness,
    "--rc-overlay": overlayColor,
    "--rc-color": color,
    "--rc-sat": saturation,
    "--rc-filter": `url(#${filterId})`,
  } as CSSProperties;

  return (
    <div className={`rc-container ${className}`} style={{ ...style, ...cssVars }}>
      {/* SVG filter defs — hidden, zero-size */}
      <svg className="rc-svg-defs" aria-hidden="true">
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="turbulence"
              baseFrequency={baseFreq}
              numOctaves={2}
              result="noise"
            />
            <feColorMatrix in="noise" type="luminanceToAlpha" result="noiseAlpha" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={displacementStrength}
              xChannelSelector="R"
              yChannelSelector="G"
              result="rippled"
            />
            <feSpecularLighting
              in="noiseAlpha"
              surfaceScale={displacementStrength}
              specularConstant={specularConstant}
              specularExponent={20}
              lightingColor="#ffffff"
              result="light"
            >
              <fePointLight x={0} y={0} z={300} />
            </feSpecularLighting>
            <feComposite in="light" in2="rippled" operator="in" result="light-effect" />
            <feBlend in="light-effect" in2="rippled" mode="screen" result="metallic" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="solidAlpha"
            />
            <feMorphology in="solidAlpha" operator="erode" radius={45} result="eroded" />
            <feGaussianBlur in="eroded" stdDeviation={10} result="blurred" />
            <feComponentTransfer in="blurred" result="glassMap">
              <feFuncA type="linear" slope={0.5} intercept={0} />
            </feComponentTransfer>
            <feDisplacementMap
              in="metallic"
              in2="glassMap"
              scale={glassDistortion}
              xChannelSelector="A"
              yChannelSelector="A"
              result="final"
            />
          </filter>
        </defs>
      </svg>

      {/* Webcam reflection — gracefully absent when permissions denied */}
      <video ref={videoRef} autoPlay playsInline muted className="rc-video" />

      {/* Layered visual effects */}
      <div className="rc-noise" />
      <div className="rc-sheen" />
      <div className="rc-border" />

      {/* Content slot */}
      <div className={`rc-content ${contentClassName}`}>{children}</div>
    </div>
  );
}
