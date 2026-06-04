"use client";

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { gsap } from "gsap";
import "./StaggeredMenu.css";

export interface StaggeredMenuItem {
  href: string;
  label: string;
  ariaLabel?: string;
}

export interface StaggeredMenuHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

interface StaggeredMenuProps {
  position?: "left" | "right";
  colors?: string[];
  items?: StaggeredMenuItem[];
  displayItemNumbering?: boolean;
  className?: string;
  accentColor?: string;
  /** When false the built-in header/toggle button is hidden; control via the forwarded ref instead. */
  renderHeader?: boolean;
  logoUrl?: string;
  menuButtonColor?: string;
  openMenuButtonColor?: string;
  changeMenuColorOnOpen?: boolean;
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
}

export const StaggeredMenu = forwardRef<StaggeredMenuHandle, StaggeredMenuProps>(
  (
    {
      position = "right",
      colors = ["#1a1a2e", "#0f0f1a"],
      items = [],
      displayItemNumbering = false,
      className,
      accentColor,
      renderHeader = true,
      logoUrl,
      menuButtonColor = "#fff",
      openMenuButtonColor = "#fff",
      changeMenuColorOnOpen = true,
      onMenuOpen,
      onMenuClose,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const openRef = useRef(false);

    const panelRef = useRef<HTMLElement>(null);
    const preLayersRef = useRef<HTMLDivElement>(null);
    const preLayerElsRef = useRef<HTMLElement[]>([]);

    // Toggle-button refs (only used when renderHeader=true)
    const plusHRef = useRef<HTMLSpanElement>(null);
    const plusVRef = useRef<HTMLSpanElement>(null);
    const iconRef = useRef<HTMLSpanElement>(null);
    const textInnerRef = useRef<HTMLSpanElement>(null);
    const textWrapRef = useRef<HTMLSpanElement>(null);
    const toggleBtnRef = useRef<HTMLButtonElement>(null);

    const [textLines, setTextLines] = useState(["Menu", "Close"]);

    const openTlRef = useRef<gsap.core.Timeline | null>(null);
    const closeTweenRef = useRef<gsap.core.Tween | null>(null);
    const spinTweenRef = useRef<gsap.core.Tween | null>(null);
    const textCycleAnimRef = useRef<gsap.core.Tween | null>(null);
    const colorTweenRef = useRef<gsap.core.Tween | null>(null);
    const busyRef = useRef(false);

    useLayoutEffect(() => {
      const ctx = gsap.context(() => {
        const panel = panelRef.current;
        const preContainer = preLayersRef.current;
        if (!panel) return;

        const preLayers = preContainer
          ? Array.from(preContainer.querySelectorAll<HTMLElement>(".sm-prelayer"))
          : [];
        preLayerElsRef.current = preLayers;

        const offscreen = position === "left" ? -100 : 100;
        gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
        if (preContainer) gsap.set(preContainer, { xPercent: 0, opacity: 1 });

        const plusH = plusHRef.current;
        const plusV = plusVRef.current;
        const icon = iconRef.current;
        const textInner = textInnerRef.current;
        if (plusH && plusV && icon && textInner) {
          gsap.set(plusH, { transformOrigin: "50% 50%", rotate: 0 });
          gsap.set(plusV, { transformOrigin: "50% 50%", rotate: 90 });
          gsap.set(icon, { rotate: 0, transformOrigin: "50% 50%" });
          gsap.set(textInner, { yPercent: 0 });
        }
        if (toggleBtnRef.current) {
          gsap.set(toggleBtnRef.current, { color: menuButtonColor });
        }
      });
      return () => ctx.revert();
    }, [menuButtonColor, position]);

    const buildOpenTimeline = useCallback(() => {
      const panel = panelRef.current;
      const layers = preLayerElsRef.current;
      if (!panel) return null;

      openTlRef.current?.kill();
      closeTweenRef.current?.kill();
      closeTweenRef.current = null;

      const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
      const numberEls = Array.from(
        panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item"),
      );

      const offscreen = position === "left" ? -100 : 100;
      const layerStates = layers.map((el) => ({ el, start: offscreen }));

      if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
      if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });

      const tl = gsap.timeline({ paused: true });

      layerStates.forEach((ls, i) => {
        tl.fromTo(
          ls.el,
          { xPercent: ls.start },
          { xPercent: 0, duration: 0.5, ease: "power4.out" },
          i * 0.07,
        );
      });

      const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
      const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
      const panelDuration = 0.65;

      tl.fromTo(
        panel,
        { xPercent: offscreen },
        { xPercent: 0, duration: panelDuration, ease: "power4.out" },
        panelInsertTime,
      );

      if (itemEls.length) {
        const itemsStart = panelInsertTime + panelDuration * 0.15;
        tl.to(
          itemEls,
          { yPercent: 0, rotate: 0, duration: 1, ease: "power4.out", stagger: { each: 0.1 } },
          itemsStart,
        );
        if (numberEls.length) {
          tl.to(
            numberEls,
            { duration: 0.6, ease: "power2.out", "--sm-num-opacity": 1, stagger: { each: 0.08 } },
            itemsStart + 0.1,
          );
        }
      }

      openTlRef.current = tl;
      return tl;
    }, [position]);

    const playOpen = useCallback(() => {
      if (busyRef.current) return;
      busyRef.current = true;
      const tl = buildOpenTimeline();
      if (tl) {
        tl.eventCallback("onComplete", () => {
          busyRef.current = false;
        });
        tl.play(0);
      } else {
        busyRef.current = false;
      }
    }, [buildOpenTimeline]);

    const playClose = useCallback(() => {
      openTlRef.current?.kill();
      openTlRef.current = null;

      const panel = panelRef.current;
      const layers = preLayerElsRef.current;
      if (!panel) return;

      closeTweenRef.current?.kill();
      const offscreen = position === "left" ? -100 : 100;
      closeTweenRef.current = gsap.to([...layers, panel], {
        xPercent: offscreen,
        duration: 0.32,
        ease: "power3.in",
        overwrite: "auto",
        onComplete: () => {
          const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
          if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
          const numberEls = Array.from(
            panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item"),
          );
          if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
          busyRef.current = false;
        },
      });
    }, [position]);

    const animateIcon = useCallback((opening: boolean) => {
      const icon = iconRef.current;
      if (!icon) return;
      spinTweenRef.current?.kill();
      spinTweenRef.current = opening
        ? gsap.to(icon, { rotate: 225, duration: 0.8, ease: "power4.out", overwrite: "auto" })
        : gsap.to(icon, { rotate: 0, duration: 0.35, ease: "power3.inOut", overwrite: "auto" });
    }, []);

    const animateColor = useCallback(
      (opening: boolean) => {
        const btn = toggleBtnRef.current;
        if (!btn) return;
        colorTweenRef.current?.kill();
        if (changeMenuColorOnOpen) {
          colorTweenRef.current = gsap.to(btn, {
            color: opening ? openMenuButtonColor : menuButtonColor,
            delay: 0.18,
            duration: 0.3,
            ease: "power2.out",
          });
        } else {
          gsap.set(btn, { color: menuButtonColor });
        }
      },
      [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor],
    );

    const animateText = useCallback((opening: boolean) => {
      const inner = textInnerRef.current;
      if (!inner) return;
      textCycleAnimRef.current?.kill();

      const currentLabel = opening ? "Menu" : "Close";
      const targetLabel = opening ? "Close" : "Menu";
      const seq = [currentLabel];
      let last = currentLabel;
      for (let i = 0; i < 3; i++) {
        last = last === "Menu" ? "Close" : "Menu";
        seq.push(last);
      }
      if (last !== targetLabel) seq.push(targetLabel);
      seq.push(targetLabel);
      setTextLines(seq);

      gsap.set(inner, { yPercent: 0 });
      const finalShift = ((seq.length - 1) / seq.length) * 100;
      textCycleAnimRef.current = gsap.to(inner, {
        yPercent: -finalShift,
        duration: 0.5 + seq.length * 0.07,
        ease: "power4.out",
      });
    }, []);

    const doOpen = useCallback(() => {
      openRef.current = true;
      setOpen(true);
      onMenuOpen?.();
      playOpen();
      if (renderHeader) {
        animateIcon(true);
        animateColor(true);
        animateText(true);
      }
    }, [renderHeader, playOpen, animateIcon, animateColor, animateText, onMenuOpen]);

    const doClose = useCallback(() => {
      if (!openRef.current) return;
      openRef.current = false;
      setOpen(false);
      onMenuClose?.();
      playClose();
      if (renderHeader) {
        animateIcon(false);
        animateColor(false);
        animateText(false);
      }
    }, [renderHeader, playClose, animateIcon, animateColor, animateText, onMenuClose]);

    const toggleMenu = useCallback(() => {
      if (openRef.current) doClose();
      else doOpen();
    }, [doOpen, doClose]);

    useImperativeHandle(ref, () => ({ open: doOpen, close: doClose, toggle: toggleMenu }), [
      doOpen,
      doClose,
      toggleMenu,
    ]);

    // Sync button color when props change
    React.useEffect(() => {
      if (!toggleBtnRef.current) return;
      gsap.set(toggleBtnRef.current, {
        color: changeMenuColorOnOpen
          ? openRef.current
            ? openMenuButtonColor
            : menuButtonColor
          : menuButtonColor,
      });
    }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor]);

    const prelayerColors = (() => {
      const raw = colors.length ? colors.slice(0, 4) : ["#1e1e22", "#35353c"];
      const arr = [...raw];
      if (arr.length >= 3) arr.splice(Math.floor(arr.length / 2), 1);
      return arr;
    })();

    return (
      <div
        className={[className, "staggered-menu-wrapper sm-fixed-wrapper"].filter(Boolean).join(" ")}
        style={accentColor ? ({ "--sm-accent": accentColor } as React.CSSProperties) : undefined}
        data-position={position}
        data-open={open || undefined}
      >
        <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
          {prelayerColors.map((c, i) => (
            <div key={i} className="sm-prelayer" style={{ background: c }} />
          ))}
        </div>

        {renderHeader && (
          <header className="staggered-menu-header" aria-label="Navigation header">
            <div className="sm-logo" aria-label="Logo">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="sm-logo-img"
                  draggable={false}
                  width={110}
                  height={24}
                />
              )}
            </div>
            <button
              ref={toggleBtnRef}
              className="sm-toggle"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="staggered-menu-panel"
              onClick={toggleMenu}
              type="button"
            >
              <span ref={textWrapRef} className="sm-toggle-textWrap" aria-hidden="true">
                <span ref={textInnerRef} className="sm-toggle-textInner">
                  {textLines.map((l, i) => (
                    <span className="sm-toggle-line" key={i}>
                      {l}
                    </span>
                  ))}
                </span>
              </span>
              <span ref={iconRef} className="sm-icon" aria-hidden="true">
                <span ref={plusHRef} className="sm-icon-line" />
                <span ref={plusVRef} className="sm-icon-line" />
              </span>
            </button>
          </header>
        )}

        {/* Backdrop — captures clicks outside the panel to close the menu */}
        {open && (
          <button
            type="button"
            className="sm-backdrop"
            aria-label="Close menu"
            onClick={doClose}
          />
        )}

        <aside
          id="staggered-menu-panel"
          ref={panelRef}
          className="staggered-menu-panel"
          aria-hidden={!open}
        >
          <div className="sm-panel-inner">
            <ul
              className="sm-panel-list"
              role="list"
              data-numbering={displayItemNumbering || undefined}
            >
              {items.length ? (
                items.map((item, idx) => (
                  <li className="sm-panel-itemWrap" key={item.href}>
                    <Link
                      className="sm-panel-item"
                      href={item.href}
                      aria-label={item.ariaLabel ?? item.label}
                      data-index={idx + 1}
                      onClick={doClose}
                    >
                      <span className="sm-panel-itemLabel">{item.label}</span>
                    </Link>
                  </li>
                ))
              ) : (
                <li className="sm-panel-itemWrap" aria-hidden="true">
                  <span className="sm-panel-item">
                    <span className="sm-panel-itemLabel">No items</span>
                  </span>
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    );
  },
);

StaggeredMenu.displayName = "StaggeredMenu";
export default StaggeredMenu;
