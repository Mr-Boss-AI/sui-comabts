"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Phase 2 v2 Forged Metal — modal.
 *
 * Bronze-rim hard-corner panel on a flat-dim scrim. No backdrop blur
 * (design system mandate — frosted glass kills the forged-plate look).
 * Pop-in animation via the design-tokens-v2 motion curves.
 *
 * Drop-in compatible with the v1 Modal API. Every existing call site
 * keeps working — title rendering, escape-to-close, scrim-click-to-close,
 * `wide` size flag.
 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Bumps maxWidth from 460 → 720. */
  wide?: boolean;
  /** Bumps maxWidth from 460 → 960 — used by the Player Profile modal
   *  to host the mini equipment frame side-by-side with the stats column. */
  extraWide?: boolean;
}

export function Modal({ open, onClose, title, children, wide, extraWide }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "v2modal-fade 200ms var(--ease-out) both",
      }}
    >
      <style>{`
        @keyframes v2modal-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes v2modal-pop {
          from { opacity: 0; transform: translateY(8px) scale(.97) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>
      <div
        style={{
          background: "var(--sc-panel)",
          border: "2px solid var(--sc-bronze)",
          borderRadius: "var(--r-sharp)",
          boxShadow: "var(--sh-pop), var(--rim-top)",
          width: "100%",
          maxWidth: extraWide ? 960 : wide ? 720 : 460,
          margin: "0 16px",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
          animation: "v2modal-pop 280ms var(--ease-pop) both",
        }}
      >
        {title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--sc-rim)",
              padding: "12px 18px",
              background: "var(--sc-panel-2)",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: 20,
                color: "var(--sc-bronze)",
                letterSpacing: "0.01em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              type="button"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--fg-2)",
                fontSize: 22,
                lineHeight: 1,
                cursor: "pointer",
                padding: "4px 8px",
                fontFamily: "var(--font-ui)",
              }}
            >
              ×
            </button>
          </div>
        )}
        <div
          style={{
            padding: 22,
            overflowY: "auto",
            color: "var(--sc-parchment)",
          }}
          className="scroll-plate"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
