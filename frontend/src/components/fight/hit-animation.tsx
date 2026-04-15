"use client";

import { useEffect, useState } from "react";
import type { HitResult } from "@/types/game";
import { ZONE_LABELS } from "@/types/game";

interface FloatingTextProps {
  hit: HitResult;
  side: "left" | "right";
}

export function FloatingText({ hit, side }: FloatingTextProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  let text: string;
  let color: string;
  let size: string;

  if (hit.blocked) {
    text = "BLOCKED";
    color = "text-blue-400";
    size = "text-sm";
  } else if (hit.dodged) {
    text = "DODGE";
    color = "text-cyan-400";
    size = "text-sm";
  } else if (hit.crit) {
    text = `CRIT! -${Math.round(hit.damage)}`;
    color = "text-red-400";
    size = "text-xl font-black";
  } else {
    text = `-${Math.round(hit.damage)}`;
    color = "text-orange-400";
    size = "text-base font-bold";
  }

  return (
    <div
      className={`absolute ${side === "left" ? "left-4" : "right-4"} pointer-events-none animate-float-up ${color} ${size}`}
      style={{ top: `${20 + Math.random() * 40}%` }}
    >
      {text}
    </div>
  );
}
