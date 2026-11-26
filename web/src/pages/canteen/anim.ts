/* Simulator motion: Web Animations API only, no dependencies. Everything is a no-op under prefers-reduced-motion. */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function reducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
  } catch {
    return false;
  }
}

/** Live prefers-reduced-motion flag (the webm loops are not rendered while it is on). */
export function useReducedMotion(): boolean {
  const [on, setOn] = useState(reducedMotion);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const h = () => setOn(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return on;
}

const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";
export const FLIGHT_MS = 320;

/**
 * FLIP flight: a cloned icon travels from `from` (a viewport rect) to `to` along a shallow arc, then the target pops in.
 * The target stays invisible until the clone lands (fill: backwards on a delayed keyframe set).
 */
export function flyIcon(src: string, from: DOMRect, to: HTMLElement, delay = 0): void {
  if (reducedMotion() || typeof document === "undefined") return;
  const end = to.getBoundingClientRect();
  if (!from.width || !end.width) return;
  const clone = document.createElement("img");
  clone.src = src;
  clone.alt = "";
  clone.setAttribute("aria-hidden", "true");
  clone.className = "cs-flyer";
  Object.assign(clone.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.appendChild(clone);
  const dx = end.left + end.width / 2 - (from.left + from.width / 2);
  const dy = end.top + end.height / 2 - (from.top + from.height / 2);
  const s = end.width / from.width;
  const lift = Math.min(90, 30 + Math.hypot(dx, dy) * 0.12);
  const fly = clone.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 0.95 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${(1 + s) / 2 + 0.12})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1 },
    ],
    { duration: FLIGHT_MS, delay, easing: "cubic-bezier(.45, 0, .2, 1)", fill: "both" },
  );
  const done = () => clone.remove();
  fly.onfinish = done;
  fly.oncancel = done;
  popIn(to, delay + FLIGHT_MS - 20);
}

/** Landing pop (also used alone when an ingredient appears without a flight). */
export function popIn(el: HTMLElement, delay = 0): void {
  if (reducedMotion()) return;
  el.animate(
    [
      { transform: "scale(.55)", opacity: 0 },
      { transform: "scale(1.16)", opacity: 1, offset: 0.55 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 300, delay, easing: EASE_OUT, fill: "backwards" },
  );
}

/** Shrink and fade, then resolve (immediately under reduced motion). */
export function shrinkOut(el: HTMLElement | null | undefined): Promise<void> {
  if (!el || reducedMotion()) return Promise.resolve();
  const a = el.animate(
    [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(.35) rotate(-12deg)", opacity: 0 },
    ],
    { duration: 170, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" },
  );
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Scroll flip-in when a new branch skill activates. */
export function flipIn(el: HTMLElement | null | undefined, delay = 0): void {
  if (!el || reducedMotion()) return;
  el.animate(
    [
      { transform: "perspective(700px) rotateY(88deg)", opacity: 0.2 },
      { transform: "perspective(700px) rotateY(-8deg)", opacity: 1, offset: 0.7 },
      { transform: "perspective(700px) rotateY(0)", opacity: 1 },
    ],
    { duration: 520, delay, easing: EASE_OUT, fill: "backwards" },
  );
}
