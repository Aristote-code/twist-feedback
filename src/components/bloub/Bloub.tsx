"use client";

import { useEffect, useId, useState } from "react";
import { BotEngine, type BotFrame } from "./bot/engine";
import { DEMI_VIEWBOX as VB, RAYON } from "./bot/repere";

// React renderer for the bloub avatar (MIT, github.com/jeremy-prt/bloub; see
// ./LICENSE). The engine in ./bot is the upstream code unchanged; this file
// replaces its Vue component for the "idle" state only: the body, and the eyes
// as holes cut through it that blink and drift on their own.

export type BloubProps = {
  /** Width and height in px. The body fills about 63% of it. */
  size?: number;
  /** Body colour. */
  color?: string;
  /** What shows through the eyes. */
  eyes?: string;
  /** Animate (blinking, gaze drift). Otherwise one still frame is drawn. */
  animated?: boolean;
  /** Accessible name; leave empty when the avatar is decorative. */
  label?: string;
  className?: string;
};

// A moment where the eyes are open, for still frames and the first paint.
const STILL_AT = 1.2;

export function Bloub({ size = 64, color = "#ffffff", eyes = "#4f46e5", animated = false, label, className }: BloubProps) {
  const [engine] = useState(() => new BotEngine(RAYON, "idle"));
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(STILL_AT));
  const maskId = `bloub-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    let clock = STILL_AT;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      clock += last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      setFrame(engine.sample(clock));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, engine]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
      </defs>
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={eyes} />
        <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={color} mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}
