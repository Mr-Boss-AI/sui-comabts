"use client";

/**
 * Stacked DM-incoming toasts — top-right corner, beneath the
 * fight-request stack.
 *
 * One toast per channel where unread bumped while the panel for that
 * peer was NOT open. Click "Reply" to open the DM panel; click ×
 * to dismiss without opening. Auto-fades after 8 s.
 *
 * Pre-fix (2026-05-06 hotfix #4 — the "Sx never received the
 * message" half of Bug 2): the recipient got a chat sound and a
 * silent unread counter bump, with no visible cue. Reproducible in
 * the two-wallet live test: Mr_Boss sent "hi", Sx's UI showed
 * nothing. This toast is the missing surface.
 */

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";

const TOAST_TTL_MS = 8_000;

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface ToastShape {
  id: string;
  peerWallet: string;
  peerName: string;
  channelId: string;
  unreadCount: number;
  createdAt: number;
}

function DmToastCard({ toast }: { toast: ToastShape }) {
  const { dispatch } = useGame();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Self-dismiss after TTL. The 500 ms interval above keeps `now`
  // moving so the bar animates; the TTL check happens in the same
  // loop via dispatch. Kept inside the component so each toast owns
  // its own lifecycle and dismissals don't cascade.
  useEffect(() => {
    const elapsed = now - toast.createdAt;
    if (elapsed >= TOAST_TTL_MS) {
      dispatch({ type: "DISMISS_DM_TOAST", id: toast.id });
    }
  }, [now, toast.createdAt, toast.id, dispatch]);

  function open() {
    dispatch({ type: "OPEN_DM", peerWallet: toast.peerWallet });
    // OPEN_DM also dismisses peer-matching toasts in the reducer,
    // but call DISMISS explicitly so this code path is robust to
    // any future reducer reshuffle.
    dispatch({ type: "DISMISS_DM_TOAST", id: toast.id });
  }

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "DISMISS_DM_TOAST", id: toast.id });
  }

  const remainingPct = Math.max(
    0,
    100 - ((now - toast.createdAt) / TOAST_TTL_MS) * 100,
  );
  const countLabel = toast.unreadCount > 1 ? ` (${toast.unreadCount})` : "";

  return (
    <div
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
      style={{
        cursor: "pointer",
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-steel)",
        boxShadow: "4px 4px 0 0 var(--sc-steel-deep), var(--rim-top)",
        padding: 12,
        maxWidth: 360,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "border-color var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--sc-bronze)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--sc-steel)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            color: "var(--sc-steel)",
          }}
        >
          New DM{countLabel}
        </span>
        <button
          onClick={close}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            border: 0,
            color: "var(--fg-3)",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
            marginLeft: 8,
          }}
        >
          ×
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13 }}>
        <span style={{ color: "var(--sc-steel)", fontWeight: 800 }}>
          {toast.peerName}
        </span>{" "}
        sent you a message
      </p>
      <p
        style={{
          margin: "2px 0 0",
          fontSize: 10,
          color: "var(--fg-3)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {truncate(toast.peerWallet)}
      </p>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 10,
          color: "var(--sc-bronze)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Click to reply →
      </p>
      <div
        style={{
          height: 2,
          background: "var(--sc-page)",
          marginTop: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "var(--sc-steel)",
            width: `${remainingPct}%`,
            transition: "width 500ms linear",
          }}
        />
      </div>
    </div>
  );
}

export function DmToasts() {
  const { state } = useGame();
  if (state.dmIncomingToasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-40 flex flex-col gap-3 max-w-sm pointer-events-none mt-4">
      {/* Offset so we sit beneath FightRequestToasts (top-4 right-4 z-50).
          Both stacks render right-aligned; toasts can't overlap because
          fight-request toasts have their own height-driven layout. The
          z-index split lets fight-request stay on top — fight challenges
          are time-critical (90 s decision window), DMs aren't. */}
      {state.dmIncomingToasts
        .slice()
        .reverse()
        .map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <DmToastCard toast={t} />
          </div>
        ))}
    </div>
  );
}
