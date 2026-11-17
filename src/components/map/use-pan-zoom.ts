"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const MAP_W = 1000;
export const MAP_H = 700;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

interface Viewport {
  /** Container size in CSS px. */
  w: number;
  h: number;
  /** CSS px per map unit at zoom 1 (SVG uses "slice", so the map always fills). */
  unitPx: number;
  /** Visible map-unit rectangle at zoom 1. */
  vx0: number;
  vy0: number;
  vw: number;
  vh: number;
}

function computeViewport(w: number, h: number): Viewport {
  const unitPx = Math.max(w / MAP_W, h / MAP_H) || 1;
  const vw = w / unitPx;
  const vh = h / unitPx;
  return { w, h, unitPx, vw, vh, vx0: (MAP_W - vw) / 2, vy0: (MAP_H - vh) / 2 };
}

function clamp(t: ViewTransform, vp: Viewport): ViewTransform {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k));
  // The transformed map [x, x + W*k] must cover the visible range [vx0, vx0 + vw],
  // with some overscroll so edge properties can be centred above overlays (the
  // map artwork extends past its edges).
  const padX = vp.vw * 0.2;
  const padY = vp.vh * 0.35;
  const minX = vp.vx0 + vp.vw - MAP_W * k - padX;
  const maxX = vp.vx0 + padX;
  const minY = vp.vy0 + vp.vh - MAP_H * k - padY;
  const maxY = vp.vy0 + padY;
  return {
    k,
    x: Math.min(maxX, Math.max(minX, t.x)),
    y: Math.min(maxY, Math.max(minY, t.y)),
  };
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/**
 * Pan / zoom for the SVG map: mouse drag, wheel zoom at cursor, two-finger pinch,
 * animated fly-to. Clicks on markers still work: a drag only starts after the
 * pointer moves a few pixels, and the click that ends a drag is swallowed.
 */
export function usePanZoom() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState<Viewport>(() => computeViewport(MAP_W, MAP_H));
  const [ready, setReady] = useState(false);
  const [t, setT] = useState<ViewTransform>({ k: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  const vpRef = useRef(vp);
  const anim = useRef<number | null>(null);
  const dragged = useRef(false);

  const commit = useCallback((next: ViewTransform) => {
    const c = clamp(next, vpRef.current);
    tRef.current = c;
    setT(c);
  }, []);

  const stopAnim = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const next = computeViewport(width, height);
      vpRef.current = next;
      setVp(next);
      setReady(true);
      commit(tRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [commit]);

  /** Client px -> map units in the untransformed viewBox. */
  const clientToView = useCallback((cx: number, cy: number) => {
    const el = containerRef.current;
    const v = vpRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: v.vx0 + (cx - r.left) / v.unitPx, y: v.vy0 + (cy - r.top) / v.unitPx };
  }, []);

  const zoomAt = useCallback(
    (viewPt: { x: number; y: number }, factor: number) => {
      const cur = tRef.current;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur.k * factor));
      const f = k / cur.k;
      commit({ k, x: viewPt.x - (viewPt.x - cur.x) * f, y: viewPt.y - (viewPt.y - cur.y) * f });
    },
    [commit],
  );

  const animateTo = useCallback(
    (target: ViewTransform, ms = 520) => {
      stopAnim();
      const from = tRef.current;
      const to = clamp(target, vpRef.current);
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / ms);
        const e = easeInOut(p);
        commit({
          k: from.k + (to.k - from.k) * e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        });
        anim.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [commit],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const v = vpRef.current;
      const cur = tRef.current;
      const c = { x: v.vx0 + v.vw / 2, y: v.vy0 + v.vh / 2 };
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur.k * factor));
      const f = k / cur.k;
      animateTo({ k, x: c.x - (c.x - cur.x) * f, y: c.y - (c.y - cur.y) * f }, 260);
    },
    [animateTo],
  );

  /** Centre a map point, zooming in to at least `minK`. */
  const flyTo = useCallback(
    (pt: { x: number; y: number }, minK = 2.2, offsetPx = { x: 0, y: 0 }) => {
      const v = vpRef.current;
      const k = Math.max(tRef.current.k, minK);
      const cx = v.vx0 + v.vw / 2 + offsetPx.x / v.unitPx;
      const cy = v.vy0 + v.vh / 2 + offsetPx.y / v.unitPx;
      animateTo({ k, x: cx - pt.x * k, y: cy - pt.y * k });
    },
    [animateTo],
  );

  const reset = useCallback(() => animateTo({ k: 1, x: 0, y: 0 }), [animateTo]);

  // Wheel zoom (non-passive so the page does not scroll) and pointer gestures.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number } | null = null;
    let downAt: { x: number; y: number } | null = null;
    let pinchDist = 0;
    let capturing = false;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(clientToView(e.clientX, e.clientY), factor);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      stopAnim();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged.current = false;
      if (pointers.size === 1) {
        last = { x: e.clientX, y: e.clientY };
        downAt = last;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = vpRef.current;
      if (pointers.size === 1 && last && downAt) {
        if (!dragged.current && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) return;
        if (!capturing) {
          el.setPointerCapture(e.pointerId);
          capturing = true;
        }
        dragged.current = true;
        const cur = tRef.current;
        commit({ k: cur.k, x: cur.x + (e.clientX - last.x) / v.unitPx, y: cur.y + (e.clientY - last.y) / v.unitPx });
        last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        dragged.current = true;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt(clientToView((a.x + b.x) / 2, (a.y + b.y) / 2), d / pinchDist);
        pinchDist = d;
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (capturing && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      capturing = false;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        last = p;
        downAt = p;
      } else {
        last = null;
      }
    };

    // Swallow the click that ends a drag so markers are not selected by accident.
    const onClickCapture = (e: MouseEvent) => {
      if (dragged.current) {
        e.stopPropagation();
        e.preventDefault();
        dragged.current = false;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClickCapture, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [clientToView, commit, zoomAt]);

  useEffect(() => stopAnim, []);

  /** Map point -> CSS px inside the container. */
  const toScreen = useCallback(
    (pt: { x: number; y: number }) => ({
      left: (pt.x * t.k + t.x - vp.vx0) * vp.unitPx,
      top: (pt.y * t.k + t.y - vp.vy0) * vp.unitPx,
    }),
    [t, vp],
  );

  return { containerRef, t, vp, ready, toScreen, zoomBy, flyTo, reset };
}
