"use client";

/**
 * NFT Portrait Picker — Phase 2.
 *
 * Triggered when the player clicks the central portrait frame on the
 * Character screen. Lists every NFT in the connected wallet that has a
 * Display.name or Display.image_url and lets the player pick one as a
 * COSMETIC portrait. No on-chain tx, no wallet popup, no stat impact.
 *
 * Selection persists in localStorage keyed by wallet address (see
 * `lib/nft-portrait.ts::portraitKeyForWallet`) so swapping wallets in
 * the same browser yields independent portraits.
 *
 * State machine + filtering + persistence live in `lib/nft-portrait.ts`
 * and are tested by `scripts/qa-nft-portrait-picker.ts`. This file
 * is just the React shell — fetches via `useCurrentClient`, renders
 * the four states (loading / empty / error / ready), and dispatches
 * Esc / scrim / Cancel / Set as Portrait.
 */

import { useEffect, useState } from "react";
import {
  useCurrentAccount,
  useCurrentClient,
} from "@mysten/dapp-kit-react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  filterPortraitCandidates,
  nextSelectionState,
  pickerStateOf,
  type NftCandidate,
  type RawOwnedObject,
  type SelectionState,
} from "@/lib/nft-portrait";

interface NftPortraitPickerProps {
  /** Currently-saved portrait (null if none). Used to seed staged
   *  selection + determine "Set as Portrait" enabled state. */
  current: NftCandidate | null;
  /** Fired with the new selection (or null for clear) when the user
   *  commits. The parent persists to localStorage. */
  onPick: (item: NftCandidate | null) => void;
  /** Close without committing — dropping any staged change. */
  onClose: () => void;
}

const MAX_FETCH_OBJECTS = 200; // upper bound — most wallets carry < 50 NFTs

export function NftPortraitPicker({
  current,
  onPick,
  onClose,
}: NftPortraitPickerProps) {
  const account = useCurrentAccount();
  const client = useCurrentClient() as SuiGrpcClient | null;

  const [candidates, setCandidates] = useState<NftCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState>({
    staged: current,
    canCommit: false,
  });
  const [failedImgs, setFailedImgs] = useState<Record<string, true>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  // Esc closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset selection when `current` changes (e.g. parent reopened picker
  // after a save).
  useEffect(() => {
    setSelection({ staged: current, canCommit: false });
  }, [current]);

  // Fetch owned NFTs once on open.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!account || !client) {
        setCandidates([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const all: RawOwnedObject[] = [];
        let cursor: string | null = null;
        let hasNextPage = true;
        // Walk all pages — most wallets cap at one page anyway. Bound
        // by MAX_FETCH_OBJECTS so a pathological wallet doesn't stall.
        // listOwnedObjects with no `type` filter returns ALL objects;
        // we filter to portrait candidates client-side via
        // filterPortraitCandidates.
        while (hasNextPage && all.length < MAX_FETCH_OBJECTS) {
          const res: Awaited<
            ReturnType<typeof client.listOwnedObjects<{ display: true }>>
          > = await client.listOwnedObjects({
            owner: account.address,
            cursor,
            include: { display: true },
          });
          for (const obj of res.objects) {
            all.push(obj as unknown as RawOwnedObject);
          }
          cursor = res.cursor ?? null;
          hasNextPage = Boolean(res.hasNextPage) && cursor !== null;
        }
        if (cancelled) return;
        setCandidates(filterPortraitCandidates(all));
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch wallet NFTs",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [account, client]);

  function handlePick(item: NftCandidate) {
    setSelection((prev) => nextSelectionState(prev, { kind: "pick", item }, current));
  }

  function handleCommit() {
    if (!selection.canCommit) return;
    onPick(selection.staged);
    onClose();
  }

  function handleClear() {
    onPick(null);
    onClose();
  }

  const state = pickerStateOf({ isLoading, error, candidates });

  return (
    <>
      {/* Scrim — flat dim, no backdrop blur (design system mandate) */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          zIndex: 100,
          animation: "nft-fade 200ms var(--ease-out) both",
        }}
        aria-hidden
      />
      {/* Modal — bronze-rimmed forged plate */}
      <div
        role="dialog"
        aria-label="Choose Portrait"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, 92vw)",
          maxHeight: "85vh",
          background: "var(--sc-panel)",
          border: "2px solid var(--sc-bronze)",
          borderRadius: 0,
          boxShadow: "var(--sh-pop), var(--rim-top)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "nft-pop 280ms var(--ease-pop) both",
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        <style>{`
          @keyframes nft-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes nft-pop {
            from { opacity: 0; transform: translate(-50%, -46%) scale(.96) }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1) }
          }
          @keyframes nft-shimmer { from { background-position: -200% 0 } to { background-position: 200% 0 } }
          .nft-thumb { transition: transform .15s, border-color .15s; }
          .nft-thumb:hover { transform: translateY(-2px); border-color: var(--sc-bronze) !important; }
          .nft-grid::-webkit-scrollbar { width: 6px; }
          .nft-grid::-webkit-scrollbar-thumb { background: var(--sc-rim-2); border-radius: 3px; }
          .nft-grid::-webkit-scrollbar-thumb:hover { background: var(--sc-bronze-deep); }
        `}</style>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--sc-rim)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <span
              className="sc-stamp"
              style={{
                color: "var(--sc-bronze)",
                borderColor: "var(--sc-bronze)",
                background: "var(--sc-page)",
              }}
            >
              Cosmetic · No stat impact
            </span>
            <h2
              style={{
                margin: "8px 0 2px",
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                color: "var(--sc-bronze)",
              }}
            >
              Choose Portrait
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--fg-2)",
                lineHeight: 1.4,
                maxWidth: 460,
              }}
            >
              Display any NFT from your wallet in the central frame. Pure
              cosmetic — your equipped gear still drives stats and combat.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            type="button"
            style={{
              border: "1px solid var(--sc-rim-2)",
              background: "var(--sc-page)",
              color: "var(--fg-2)",
              padding: "6px 10px",
              cursor: "pointer",
              borderRadius: 2,
              fontWeight: 700,
              fontSize: 16,
              lineHeight: 1,
              fontFamily: "var(--font-ui)",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body — 4 render slots driven by pickerStateOf ─────────── */}
        <div
          className="nft-grid"
          style={{
            padding: 16,
            overflowY: "auto",
            flex: 1,
            minHeight: 260,
          }}
        >
          {state === "loading" && <LoadingShimmer />}

          {state === "error" && (
            <EmptyMessage
              title="Couldn't read wallet"
              body={error ?? "Try again in a moment — the RPC may be flaky."}
              actionHref={null}
            />
          )}

          {state === "empty" && (
            <EmptyMessage
              title="No NFTs found"
              body="Mint an item or buy one in the Marketplace, then come back to set it as your portrait."
              actionHref="marketplace"
            />
          )}

          {state === "ready" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 10,
              }}
            >
              {candidates.map((it) => {
                const isSelected = selection.staged?.objectId === it.objectId;
                const failed = failedImgs[it.objectId];
                return (
                  <button
                    key={it.objectId}
                    type="button"
                    className="nft-thumb"
                    onClick={() => handlePick(it)}
                    onMouseEnter={() => setHovered(it.objectId)}
                    onMouseLeave={() => setHovered(null)}
                    title={it.name}
                    style={{
                      position: "relative",
                      background: "var(--sc-page)",
                      border: `2px solid ${isSelected ? "var(--sc-bronze)" : "var(--sc-rim-2)"}`,
                      borderRadius: 0,
                      padding: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                      boxShadow: isSelected
                        ? "0 0 0 1px var(--sc-bronze), inset 0 0 0 1px rgba(200,154,63,.4)"
                        : "inset 0 1px 0 rgba(255,255,255,.04)",
                      color: "var(--sc-parchment)",
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: "1 / 1",
                        background: "var(--sc-panel-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {failed || !it.imageUrl ? (
                        <div
                          style={{
                            padding: 4,
                            fontSize: 9,
                            fontWeight: 700,
                            color: "var(--fg-3)",
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            textAlign: "center",
                            lineHeight: 1.2,
                          }}
                        >
                          {it.name}
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.imageUrl}
                          alt={it.name}
                          onError={() =>
                            setFailedImgs((m) => ({ ...m, [it.objectId]: true }))
                          }
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            padding: 4,
                          }}
                        />
                      )}
                      {isSelected && (
                        <div
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            background: "var(--sc-bronze)",
                            color: "var(--sc-page)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 0 0 2px var(--sc-page)",
                            fontWeight: 900,
                            fontSize: 13,
                          }}
                          aria-label="Selected"
                        >
                          ✓
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--fg-1)",
                        textAlign: "center",
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {it.name}
                    </div>
                    {hovered === it.objectId && it.typeTag && (
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          bottom: "calc(100% + 6px)",
                          transform: "translateX(-50%)",
                          background: "var(--sc-page)",
                          border: "1px solid var(--sc-bronze)",
                          padding: "4px 8px",
                          fontSize: 10,
                          color: "var(--sc-parchment)",
                          whiteSpace: "nowrap",
                          zIndex: 5,
                          pointerEvents: "none",
                          fontFamily: "var(--font-mono)",
                          maxWidth: 260,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {shortType(it.typeTag)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--sc-rim)",
            background: "var(--sc-panel-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={handleClear}
            disabled={!current}
            style={{
              background: "transparent",
              border: 0,
              color: current ? "var(--fg-2)" : "var(--fg-3)",
              fontFamily: "var(--font-ui)",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              cursor: current ? "pointer" : "not-allowed",
              padding: "6px 0",
              opacity: current ? 1 : 0.4,
            }}
          >
            Clear portrait
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <FooterButton variant="ghost" onClick={onClose}>
              Cancel
            </FooterButton>
            <FooterButton
              variant="bronze"
              onClick={handleCommit}
              disabled={!selection.canCommit}
            >
              Set as Portrait
            </FooterButton>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Subcomponents ────────────────────────────────────────────────── */

function FooterButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: "ghost" | "bronze";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const bronze = variant === "bronze";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "var(--ls-button)",
        textTransform: "uppercase",
        padding: "9px 18px",
        border: `2px solid ${
          disabled
            ? "var(--sc-rim-2)"
            : bronze
              ? "var(--sc-bronze-deep)"
              : "var(--sc-rim-2)"
        }`,
        borderRadius: "var(--r-button)",
        background: disabled
          ? "var(--sc-panel-2)"
          : bronze
            ? "var(--sc-bronze)"
            : "var(--sc-panel-2)",
        color: disabled
          ? "var(--fg-3)"
          : bronze
            ? "var(--sc-page)"
            : "var(--fg-1)",
        boxShadow: disabled ? "none" : "var(--sh-plate-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition:
          "transform var(--d-base) var(--ease-pop), box-shadow var(--d-base) var(--ease-pop), background var(--d-fast) linear",
      }}
    >
      {children}
    </button>
  );
}

function LoadingShimmer() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
      }}
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            aspectRatio: "1 / 1",
            background:
              "linear-gradient(90deg, var(--sc-panel-2) 0%, var(--sc-panel-3) 50%, var(--sc-panel-2) 100%)",
            backgroundSize: "200% 100%",
            animation: "nft-shimmer 1.6s linear infinite",
            border: "1px solid var(--sc-rim-2)",
          }}
        />
      ))}
    </div>
  );
}

function EmptyMessage({
  title,
  body,
  actionHref,
}: {
  title: string;
  body: string;
  actionHref: "marketplace" | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        textAlign: "center",
        gap: 12,
        color: "var(--fg-2)",
        minHeight: 220,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          border: "2px dashed var(--sc-rim-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--sc-ash)",
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1,
        }}
        aria-hidden
      >
        ?
      </div>
      <div
        style={{
          fontWeight: 800,
          fontSize: 16,
          color: "var(--sc-parchment)",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.45 }}>
        {body}
      </div>
      {actionHref === "marketplace" && <MarketplaceLink />}
    </div>
  );
}

/** Link emits a custom event so the parent route can intercept and
 *  dispatch SET_AREA. The Character screen mounts inside the same
 *  game-screen that owns currentArea, so a window event is the
 *  thinnest way to nudge it without prop-drilling.
 *  TODO Phase 2: pull the nav dispatcher into a hook the picker can
 *  consume directly. Today this falls back to a no-op + hint copy. */
function MarketplaceLink() {
  function go() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("sc:nav", { detail: { area: "marketplace" } }));
  }
  return (
    <button
      type="button"
      onClick={go}
      style={{
        marginTop: 4,
        color: "var(--sc-bronze)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        textDecoration: "none",
        borderBottom: "1px solid var(--sc-bronze)",
        paddingBottom: 2,
        background: "transparent",
        border: 0,
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
      }}
    >
      Open Marketplace →
    </button>
  );
}

/** Compact type-tag like `0xabc::nft::Item` → `nft::Item` for hover
 *  tooltips. Pure but kept in-file because it's UI-presentation only. */
function shortType(tag: string): string {
  const parts = tag.split("::");
  if (parts.length < 3) return tag;
  return parts.slice(1).join("::");
}
