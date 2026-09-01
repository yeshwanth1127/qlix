"use client";

import { useEffect, useRef } from "react";
import styles from "./ParticleText.module.css";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const hexToRgb = (hex) => {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const mixRgb = (from, to, amount) => ({
  r: Math.round(from.r + (to.r - from.r) * amount),
  g: Math.round(from.g + (to.g - from.g) * amount),
  b: Math.round(from.b + (to.b - from.b) * amount),
});

const resolveFontSize = (value, container, fontWeight, fontFamily) => {
  if (typeof value === "number") return value;
  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${value};font-weight:${fontWeight};font-family:${fontFamily}`;
  container.appendChild(probe);
  const size = parseFloat(window.getComputedStyle(probe).fontSize) || 48;
  probe.remove();
  return size;
};

export function ParticleText({
  text,
  particleSize = 1.7,
  density = 4,
  color = "#012F13",
  highlightColor = "#8BC53D",
  scatter = 100,
  gatherDuration = 2800,
  stagger = 900,
  pointerRepel = 28,
  repelRadius = 90,
  idleDrift = 0.45,
  trigger = "mount",
  fontSize = "clamp(1.75rem, 5vw, 3rem)",
  fontWeight = 300,
  fontFamily = "inherit",
  glow = false,
  className = "",
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!container || !canvas || !ctx) return;

    let particles = [];
    let animationFrame = null;
    let resizeFrame = null;
    let buildId = 0;
    let gathering = false;
    let gatherStart = 0;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    const pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0 };

    const startGather = (fromScatter = true) => {
      if (!particles.length) return;
      const spread = reducedMotion ? 0 : scatter;
      for (const particle of particles) {
        if (fromScatter) {
          const angle = particle.seed * Math.PI * 2;
          const distance = spread * (0.35 + particle.depth * 0.75);
          particle.x = particle.targetX + Math.cos(angle) * distance;
          particle.y = particle.targetY + Math.sin(angle) * distance;
        }
        particle.startX = particle.x;
        particle.startY = particle.y;
        particle.delay = reducedMotion ? 0 : particle.seed * stagger;
      }
      gatherStart = performance.now();
      gathering = true;
    };

    const render = (now) => {
      ctx.clearRect(0, 0, width, height);
      ctx.shadowBlur = glow && !reducedMotion ? particleSize * 3 : 0;
      ctx.shadowColor = highlightColor;
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;
      let complete = true;

      for (const particle of particles) {
        let baseX = particle.targetX;
        let baseY = particle.targetY;
        let progress = 1;
        if (gathering) {
          const local = (now - gatherStart - particle.delay) / Math.max(1, reducedMotion ? 1 : gatherDuration);
          progress = clamp(local, 0, 1);
          const eased = easeOutCubic(progress);
          baseX = particle.startX + (particle.targetX - particle.startX) * eased;
          baseY = particle.startY + (particle.targetY - particle.startY) * eased;
          if (progress < 1) complete = false;
        } else if (!reducedMotion && idleDrift > 0) {
          const time = now * 0.001;
          baseX += Math.sin(time * 0.9 + particle.seed * 10) * idleDrift * particle.depth;
          baseY += Math.cos(time * 0.75 + particle.depth * 10) * idleDrift * particle.depth;
        }

        if (pointer.active && !reducedMotion && pointerRepel > 0) {
          const dx = baseX - pointer.smoothX;
          const dy = baseY - pointer.smoothY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < repelRadius) {
            const force = Math.pow(1 - distance / repelRadius, 2) * pointerRepel;
            baseX += (dx / distance) * force;
            baseY += (dy / distance) * force;
          }
        }

        const follow = reducedMotion ? 1 : 0.12;
        particle.x += (baseX - particle.x) * follow;
        particle.y += (baseY - particle.y) * follow;
        ctx.globalAlpha = clamp(0.35 + progress * 0.65, 0, 1);
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (gathering && complete) gathering = false;
      animationFrame = window.requestAnimationFrame(render);
    };

    const sampleText = async () => {
      const currentBuild = ++buildId;
      const rect = container.getBoundingClientRect();
      width = Math.floor(rect.width);
      height = Math.floor(rect.height);
      if (width <= 0 || height <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const computed = window.getComputedStyle(container);
      const family = fontFamily === "inherit" ? computed.fontFamily || "sans-serif" : fontFamily;
      let size = resolveFontSize(fontSize, container, fontWeight, family);
      let font = `${fontWeight} ${size}px ${family}`;
      try {
        await document.fonts?.load(font);
        await document.fonts?.ready;
      } catch {}
      if (currentBuild !== buildId) return;

      const offscreen = document.createElement("canvas");
      const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.font = font;
      const maxWidth = width * 0.94;
      let metrics = offCtx.measureText(text);
      if (metrics.width > maxWidth) {
        size = Math.max(18, size * (maxWidth / metrics.width));
        font = `${fontWeight} ${size}px ${family}`;
        offCtx.font = font;
        metrics = offCtx.measureText(text);
      }

      const ascent = Math.ceil(metrics.actualBoundingBoxAscent || size * 0.78);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent || size * 0.22);
      const padding = Math.max(10, Math.ceil(size * 0.08));
      offscreen.width = Math.ceil(metrics.width) + padding * 2;
      offscreen.height = ascent + descent + padding * 2;
      offCtx.font = font;
      offCtx.textBaseline = "alphabetic";
      offCtx.fillStyle = "#fff";
      offCtx.fillText(text, padding, padding + ascent);

      const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      const targets = [];
      const step = Math.max(2, Math.floor(density));
      for (let y = 0; y < offscreen.height; y += step) {
        for (let x = 0; x < offscreen.width; x += step) {
          const alpha = imageData.data[(y * offscreen.width + x) * 4 + 3];
          if (alpha > 40) targets.push({ x: width / 2 - offscreen.width / 2 + x, y: height / 2 - offscreen.height / 2 + y, alpha: alpha / 255 });
        }
      }

      const maxParticles = Math.max(700, Math.min(4200, Math.floor((width * height) / 75)));
      const stride = Math.max(1, Math.ceil(targets.length / maxParticles));
      const base = hexToRgb(color);
      const highlight = hexToRgb(highlightColor);
      particles = targets.filter((_, index) => index % stride === 0).map((target, index) => {
        const seed = ((index * 9301 + 49297) % 233280) / 233280;
        const depth = 0.45 + (((index * 233 + 97) % 1000) / 1000) * 0.9;
        const blend = clamp(target.x / Math.max(1, width) + (seed - 0.5) * 0.22, 0, 1);
        const mixed = base && highlight ? mixRgb(base, highlight, blend) : null;
        const angle = seed * Math.PI * 2;
        const distance = (reducedMotion ? 0 : scatter) * (0.35 + depth * 0.75);
        return {
          x: target.x + Math.cos(angle) * distance,
          y: target.y + Math.sin(angle) * distance,
          startX: target.x,
          startY: target.y,
          targetX: target.x,
          targetY: target.y,
          size: Math.max(0.7, particleSize * (0.75 + target.alpha * 0.45)),
          color: mixed ? `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})` : color,
          seed,
          depth,
          delay: seed * stagger,
        };
      });

      pointer.x = pointer.smoothX = width / 2;
      pointer.y = pointer.smoothY = height / 2;
      if (reducedMotion) {
        for (const particle of particles) particle.x = particle.targetX, particle.y = particle.targetY;
        gathering = false;
      } else {
        startGather(false);
      }
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(render);
    };

    const queueSample = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(sampleText);
    };
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
    };
    const onPointerLeave = () => { pointer.active = false; };
    const onPointerEnter = (event) => { onPointerMove(event); if (trigger === "hover") startGather(true); };
    const onClick = () => { if (trigger === "click") startGather(true); };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event) => { reducedMotion = event.matches; void sampleText(); };

    motionQuery.addEventListener("change", onMotionChange);
    canvas.addEventListener("pointerenter", onPointerEnter);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);
    const observer = new ResizeObserver(queueSample);
    observer.observe(container);
    void sampleText();

    return () => {
      buildId += 1;
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("pointerenter", onPointerEnter);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [text, particleSize, density, color, highlightColor, scatter, gatherDuration, stagger, pointerRepel, repelRadius, idleDrift, trigger, fontSize, fontWeight, fontFamily, glow]);

  return (
    <div ref={containerRef} className={`${styles.root} ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
