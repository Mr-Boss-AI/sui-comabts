"use client";

/**
 * Phase 2 v2 — Error toast.
 *
 * Two flavours:
 *   - Sticky (action required): top-center, blood-red double rim,
 *     bronze "!" attention badge, parchment text, mono "Dismiss".
 *   - Auto-fade (5s): bottom-center, gunmetal fill, blood-red rim
 *     + 3px left edge, single "×" close. Used for transient WS /
 *     SDK / picker failures.
 */

import { useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";

export function ErrorToast() {
  const { state, dispatch } = useGame();
  const { errorMessage, errorTimestamp, errorSticky } = state;

  useEffect(() => {
    if (!errorMessage || errorSticky) return;
    const timer = setTimeout(() => {
      dispatch({ type: "SET_ERROR", message: null });
    }, 5000);
    return () => clearTimeout(timer);
  }, [errorTimestamp, errorSticky, errorMessage, dispatch]);

  if (!errorMessage) return null;

  if (errorSticky) {
    return (
      <div
        style={{
          position: "fixed",
          inset: "0 0 auto 0",
          zIndex: 50,
          display: "flex",
          justifyContent: "center",
          padding: "12px 16px 0",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            background: "var(--sc-panel)",
            border: "2px solid var(--sc-blood)",
            boxShadow: "4px 4px 0 0 var(--sc-blood-deep), var(--rim-top)",
            padding: "14px 18px",
            maxWidth: 720,
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            fontFamily: "var(--font-ui)",
            color: "var(--sc-parchment)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--sc-blood)",
              fontSize: 28,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            !
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: "var(--ls-stamp)",
                textTransform: "uppercase",
                color: "var(--sc-blood)",
                marginBottom: 4,
              }}
            >
              Action required
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--sc-parchment)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.45,
              }}
            >
              {errorMessage}
            </div>
          </div>
          <button
            onClick={() => dispatch({ type: "SET_ERROR", message: null })}
            style={{
              background: "var(--sc-blood)",
              color: "var(--sc-parchment)",
              border: "1px solid var(--sc-blood-deep)",
              padding: "5px 12px",
              fontFamily: "var(--font-ui)",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "var(--ls-button)",
              textTransform: "uppercase",
              cursor: "pointer",
              boxShadow: "var(--sh-plate-sm)",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-blood-deep)",
        borderLeft: "3px solid var(--sc-blood)",
        padding: "10px 14px",
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        boxShadow: "var(--sh-plate)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--sc-parchment)" }}>
        {errorMessage}
      </span>
      <button
        onClick={() => dispatch({ type: "SET_ERROR", message: null })}
        style={{
          background: "transparent",
          border: 0,
          color: "var(--fg-3)",
          fontSize: 16,
          cursor: "pointer",
          marginLeft: 4,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
