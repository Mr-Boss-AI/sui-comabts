"use client";

/**
 * DM panel — branches on the transport flag.
 *
 *   NEXT_PUBLIC_DM_TRANSPORT=plaintext   (default) — plain WS + Supabase
 *                                                    persistence (Hotfix #6)
 *   NEXT_PUBLIC_DM_TRANSPORT=encrypted             — Sui Stack Messaging
 *                                                    SDK (deferred until SDK
 *                                                    reaches beta)
 *
 * The chrome (header, bubbles, input, scroll-on-message) is identical
 * across transports — only the data layer differs:
 *
 *   plaintext lifecycle:
 *     1. Open → `dm_history` WS request → panel renders the page +
 *        clears unread (server clears server-side as part of history).
 *     2. Send → optimistic bubble appended; `dm_send` WS request →
 *        server persists + echoes `dm_message_sent` (matched by
 *        clientId) → panel swaps optimistic for confirmed.
 *     3. Incoming → panel listens for `dm_message_received` for the
 *        open channel and appends.
 *     No wallet popup, no chain tx, no Walrus, no Seal.
 *
 *   encrypted lifecycle (preserved behind the flag, ready to flip back):
 *     1. Open → `lookup_dm_channel` → SDK `getMessages`.
 *     2. Send → `runDmSend` (executeCreateChannelTransaction +
 *        executeSendMessageTransaction wrapped in withTimeout).
 *     The SDK is alpha — see Hotfix #5 for the timeout / cancel
 *     instrumentation that surrounds it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import {
  useCurrentAccount,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import { Button } from "@/components/ui/button";
import {
  ensureClient,
  ensureChannel,
  resolveMemberCap,
  sendMessage as sdkSendMessage,
  getMessages as sdkGetMessages,
  TESTNET_DISCLOSURE,
  type DecryptedMessageWire,
} from "@/lib/messaging";
import { runDmSend, PIPELINE_BUDGETS } from "@/lib/dm-send-pipeline";
import {
  runPlaintextDmSend,
  runPlaintextDmHistory,
} from "@/lib/dm-plaintext-pipeline";
import type { DmMessageWire } from "@/types/ws-messages";

/**
 * Transport flag — read at module init so it tree-shakes cleanly in
 * production builds. NEXT_PUBLIC_* env vars are inlined at build time
 * by Next.js, so the unused branch's imports stay in source but the
 * dead code drops out of the bundle.
 */
const TRANSPORT_MODE: "plaintext" | "encrypted" =
  process.env.NEXT_PUBLIC_DM_TRANSPORT === "encrypted" ? "encrypted" : "plaintext";

const SDK_AVAILABLE = true; // build-time flag; flipped if the SDK fails to import

const CANCEL_BUTTON_AFTER_MS = 25_000;

const PLAINTEXT_DISCLOSURE =
  "Private messages — visible only to you and the other player. " +
  "Stored on the SUI Combats server (encrypted in transit; plaintext at rest). " +
  "End-to-end encryption returns when the Sui Stack Messaging SDK reaches beta.";

if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log(
    `[dm-panel] transport=${TRANSPORT_MODE} loaded`,
    TRANSPORT_MODE === "encrypted"
      ? `(encrypted master budget ${PIPELINE_BUDGETS.master / 1000}s)`
      : "(plaintext WS + Supabase)",
  );
}

interface LocalMessage {
  id: string;
  sender: string;
  text: string;
  createdAtMs: number;
  pending?: boolean;
  failed?: boolean;
}

function wireToLocal(wire: DmMessageWire): LocalMessage {
  return {
    id: wire.id,
    sender: wire.senderWallet,
    text: wire.body,
    createdAtMs: wire.createdAtMs,
  };
}

function decryptedToLocal(wire: DecryptedMessageWire): LocalMessage {
  return {
    id: wire.id,
    sender: wire.sender,
    text: wire.text,
    createdAtMs: wire.createdAtMs,
  };
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function DmPanel() {
  const { state, dispatch } = useGame();
  const peer = state.openDmPeer;
  const account = useCurrentAccount();
  const dAppKit = useDAppKit() as unknown as DAppKit;

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [memberCapId, setMemberCapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(true);
  const lastOptimisticIdRef = useRef<string | null>(null);
  // Encrypted-mode-only: bumped to force the load effect to re-run
  // sdkGetMessages without remounting the panel (after a successful
  // send + on every incoming `dm_unread_changed`).
  const [refreshKey, setRefreshKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Reset state on peer change (both transports) ──────────────────
  useEffect(() => {
    if (!peer || !account) return;
    setChannelId(null);
    setMemberCapId(null);
    setMessages([]);
    setError(null);
    setSdkError(null);
  }, [peer, account]);

  // ─── ENCRYPTED transport: lookup + load via SDK ───────────────────
  // The encrypted code path is preserved verbatim from Hotfix #5; the
  // tree-shake on TRANSPORT_MODE in the conditionals removes it from
  // production bundles when the flag is "plaintext" (the default).
  useEffect(() => {
    if (TRANSPORT_MODE !== "encrypted") return;
    if (!peer || !account) return;
    state.socket.send({ type: "lookup_dm_channel", peerWallet: peer });
  }, [peer, account, state.socket]);

  useEffect(() => {
    if (TRANSPORT_MODE !== "encrypted") return;
    if (!peer || !account) return;
    const lower = peer.toLowerCase();
    const me = account.address.toLowerCase();
    const matched = state.dmChannels.find(
      (c) =>
        (c.participantA === me && c.participantB === lower) ||
        (c.participantA === lower && c.participantB === me),
    );
    if (matched && matched.channelId !== channelId) {
      setChannelId(matched.channelId);
    }
  }, [state.dmChannels, peer, account, channelId]);

  useEffect(() => {
    if (TRANSPORT_MODE !== "encrypted") return;
    if (!channelId || !peer || !account) return;
    let cancelled = false;
    (async () => {
      const isInitialLoad = refreshKey === 0;
      if (isInitialLoad) setLoading(true);
      setError(null);
      try {
        const signer = new CurrentAccountSigner(dAppKit);
        const bundle = ensureClient(signer as never, account.address);
        const wire = await sdkGetMessages(bundle, { channelId, limit: 50 });
        if (cancelled) return;
        setMessages((prev) => {
          if (isInitialLoad) return wire.map(decryptedToLocal);
          const stillPending = prev.filter((m) => m.pending && !m.failed);
          const wireKeys = new Set(
            wire.map((w) => `${w.sender.toLowerCase()}|${w.text}`),
          );
          const remaining = stillPending.filter(
            (m) => !wireKeys.has(`${m.sender.toLowerCase()}|${m.text}`),
          );
          return [...wire.map(decryptedToLocal), ...remaining];
        });
        const channel = state.dmChannels.find((c) => c.channelId === channelId);
        if (channel) {
          const me = account.address.toLowerCase();
          const cap =
            channel.participantA === me
              ? channel.memberCapA
              : channel.memberCapB;
          if (cap) setMemberCapId(cap);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setSdkError(msg);
        if (isInitialLoad) setError(`Could not load messages: ${msg}`);
      } finally {
        if (!cancelled && isInitialLoad) setLoading(false);
      }
    })();
    state.socket.send({ type: "clear_dm_unread", channelId });
    return () => {
      cancelled = true;
    };
  }, [channelId, peer, account, dAppKit, state.dmChannels, state.socket, refreshKey]);

  // ─── PLAINTEXT transport: dm_history on open ──────────────────────
  useEffect(() => {
    if (TRANSPORT_MODE !== "plaintext") return;
    if (!peer || !account) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await runPlaintextDmHistory(
          {
            wsSend: (msg) =>
              state.socket.send(
                msg as Parameters<typeof state.socket.send>[0],
              ),
            subscribe: (handler) =>
              state.socket.addHandler(handler as Parameters<typeof state.socket.addHandler>[0]),
            onStep: (s) => {
              // eslint-disable-next-line no-console
              console.log("[dm-history]", s, "@", new Date().toISOString());
            },
          },
          { peerWallet: peer, limit: 50 },
        );
        if (cancelled) return;
        setChannelId(result.channelId);
        setMessages(result.messages.map(wireToLocal));
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Could not load history: ${msg}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peer, account, state.socket]);

  // ─── PLAINTEXT transport: subscribe to incoming + appends live ────
  useEffect(() => {
    if (TRANSPORT_MODE !== "plaintext") return;
    if (!channelId || !peer) return;
    const peerLower = peer.toLowerCase();
    const unsubscribe = state.socket.addHandler((msg) => {
      // We listen for any `dm_message_received` whose channelId
      // matches the open channel. The reducer ALSO bumps the
      // unread count on the same event — but the panel-side append
      // here is what makes the message appear in the OPEN view
      // without waiting for a remount or refresh-key bump.
      // De-duped by message id so re-subscribes don't double-render.
      if (
        (msg as { type?: string }).type === "dm_message_received" &&
        (msg as { message?: { channelId?: string } }).message?.channelId ===
          channelId
      ) {
        const wire = (msg as { message: DmMessageWire }).message;
        // Only append if the sender is the OTHER side. Self-sends
        // are already optimistic-rendered then snapped to confirmed
        // via the `dm_message_sent` echo path; appending again
        // here would duplicate.
        if (wire.senderWallet.toLowerCase() === peerLower) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === wire.id)) return prev;
            return [...prev, wireToLocal(wire)];
          });
          // Acknowledge the message so the recipient's unread
          // counter doesn't keep climbing while the panel is open.
          state.socket.send({ type: "clear_dm_unread", channelId });
        }
      }
    });
    return unsubscribe;
  }, [channelId, peer, state.socket]);

  // ─── ENCRYPTED transport: refresh on unread change ────────────────
  const lastSeenUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    if (TRANSPORT_MODE !== "encrypted") return;
    if (!channelId) return;
    const live = state.dmUnreadByChannel[channelId] ?? 0;
    if (lastSeenUnreadRef.current === null) {
      lastSeenUnreadRef.current = live;
      return;
    }
    if (live > lastSeenUnreadRef.current) {
      lastSeenUnreadRef.current = live;
      setRefreshKey((k) => k + 1);
      state.socket.send({ type: "clear_dm_unread", channelId });
    } else if (live < lastSeenUnreadRef.current) {
      lastSeenUnreadRef.current = live;
    }
  }, [channelId, state.dmUnreadByChannel, state.socket]);

  // ─── Auto-scroll on new messages (both transports) ────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function close() {
    dispatch({ type: "OPEN_DM", peerWallet: null });
  }

  // ─── Plaintext send ────────────────────────────────────────────────
  async function handleSendPlaintext() {
    if (!peer || !account || !draft.trim() || sending) return;
    const text = draft.trim().slice(0, 2000);
    setSending(true);
    setError(null);
    const optimisticId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: LocalMessage = {
      id: optimisticId,
      sender: account.address,
      text,
      createdAtMs: Date.now(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const confirmed = await runPlaintextDmSend(
        {
          wsSend: (msg) =>
            state.socket.send(msg as Parameters<typeof state.socket.send>[0]),
          subscribe: (handler) =>
            state.socket.addHandler(
              handler as Parameters<typeof state.socket.addHandler>[0],
            ),
          onStep: (s) => {
            // eslint-disable-next-line no-console
            console.log("[dm-send]", s, "@", new Date().toISOString());
          },
        },
        {
          peerWallet: peer,
          body: text,
          clientId: optimisticId,
        },
      );
      // Snap optimistic to confirmed using the server's id + timestamp.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? {
                id: confirmed.id,
                sender: confirmed.senderWallet,
                text: confirmed.body,
                createdAtMs: confirmed.createdAtMs,
              }
            : m,
        ),
      );
      // First send between two wallets returns a fresh channelId; pin it.
      if (!channelId) setChannelId(confirmed.channelId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, pending: false, failed: true } : m,
        ),
      );
      setError(msg);
      // eslint-disable-next-line no-console
      console.error("[dm-panel] plaintext send failed:", err);
    } finally {
      setSending(false);
    }
  }

  // ─── Encrypted send ────────────────────────────────────────────────
  async function handleSendEncrypted() {
    if (!peer || !account || !draft.trim() || sending) return;
    if (!SDK_AVAILABLE) {
      setError("Encrypted DMs unavailable on this build.");
      return;
    }
    const text = draft.trim().slice(0, 2000);
    setSending(true);
    setSendingStartedAt(Date.now());
    setShowCancel(false);
    setError(null);
    const signer = new CurrentAccountSigner(dAppKit);
    const bundle = ensureClient(signer as never, account.address);
    const optimistic: LocalMessage = {
      id: `pending-${Date.now()}`,
      sender: account.address,
      text,
      createdAtMs: Date.now(),
      pending: true,
    };
    lastOptimisticIdRef.current = optimistic.id;
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const result = await runDmSend(
        {
          bundle,
          ensureChannel,
          resolveMemberCap,
          sendMessage: sdkSendMessage,
          wsSend: (msg) =>
            state.socket.send(msg as Parameters<typeof state.socket.send>[0]),
          onStep: (step) => {
            // eslint-disable-next-line no-console
            console.log("[dm-send]", step, "@", new Date().toISOString());
          },
        },
        {
          peer,
          myAddress: account.address,
          text,
          existingChannelId: channelId,
          existingMemberCapId: memberCapId,
        },
      );
      setChannelId(result.channelId);
      setMemberCapId(result.memberCapId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id ? { ...m, pending: false } : m,
        ),
      );
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id ? { ...m, pending: false, failed: true } : m,
        ),
      );
      setError(msg);
      // eslint-disable-next-line no-console
      console.error("[dm-panel] encrypted send failed:", err);
    } finally {
      setSending(false);
      setSendingStartedAt(null);
      setShowCancel(false);
      lastOptimisticIdRef.current = null;
    }
  }

  function handleSend() {
    if (TRANSPORT_MODE === "plaintext") {
      void handleSendPlaintext();
    } else {
      void handleSendEncrypted();
    }
  }

  function handleCancelSend() {
    // Encrypted-only escape hatch — the plaintext path is too fast
    // to need one. Flips the optimistic bubble to "failed", releases
    // the Sending lock, lets the user retry.
    const optId = lastOptimisticIdRef.current;
    if (optId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optId ? { ...m, pending: false, failed: true } : m,
        ),
      );
    }
    setError(
      "Cancelled. The send may still complete on chain — check your wallet history.",
    );
    setSending(false);
    setSendingStartedAt(null);
    setShowCancel(false);
    lastOptimisticIdRef.current = null;
  }

  // Cancel-button surface ticker (encrypted only — plaintext sends
  // round-trip in single-digit ms, no escape hatch needed).
  useEffect(() => {
    if (TRANSPORT_MODE !== "encrypted") return;
    if (!sending || !sendingStartedAt) {
      if (showCancel) setShowCancel(false);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() - sendingStartedAt >= CANCEL_BUTTON_AFTER_MS) {
        setShowCancel(true);
      }
    }, 250);
    return () => clearInterval(id);
  }, [sending, sendingStartedAt, showCancel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const peerLabel = useMemo(() => {
    if (!peer) return "";
    const p = state.onlinePlayers.find(
      (op) => op.walletAddress.toLowerCase() === peer.toLowerCase(),
    );
    return p?.name ?? truncate(peer);
  }, [state.onlinePlayers, peer]);

  if (!peer) return null;

  const headerBadge = TRANSPORT_MODE === "encrypted" ? "encrypted" : "private";
  const sendButtonLabel =
    TRANSPORT_MODE === "encrypted"
      ? sending
        ? "Signing…"
        : "Send"
      : sending
        ? "Sending…"
        : "Send";
  const disclosureText =
    TRANSPORT_MODE === "encrypted" ? TESTNET_DISCLOSURE : PLAINTEXT_DISCLOSURE;

  return (
    <div
      className="fixed bottom-0 right-0 sm:right-4 sm:bottom-4 z-40 w-full sm:w-96 max-h-[80vh] flex flex-col"
      style={{
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-bronze)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--sh-pop), var(--rim-top)",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          borderBottom: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              color: "var(--sc-bronze)",
              fontWeight: 400,
            }}
          >
            {peerLabel}
          </span>
          <div
            style={{
              fontSize: 10,
              color: "var(--fg-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {truncate(peer)} · {headerBadge}
          </div>
        </div>
        <button
          onClick={close}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--fg-3)",
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>

      {/* Disclosure banner */}
      {showDisclosure && (
        <div
          className="px-3 py-2"
          style={{
            background: "var(--sc-panel-2)",
            borderBottom: "1px solid var(--sc-bronze-deep)",
            borderLeft: "3px solid var(--sc-bronze)",
            fontSize: 11,
            color: "var(--fg-2)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{disclosureText}</span>
            <button
              onClick={() => setShowDisclosure(false)}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--sc-bronze)",
                cursor: "pointer",
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] scroll-plate"
      >
        {loading && messages.length === 0 && (
          <p className="text-xs text-zinc-500 text-center py-6">
            {TRANSPORT_MODE === "encrypted" ? "Decrypting…" : "Loading…"}
          </p>
        )}
        {!loading && messages.length === 0 && !channelId && (
          <p className="text-xs text-zinc-500 text-center py-6">
            {TRANSPORT_MODE === "encrypted"
              ? "No messages yet. Send the first to start the channel — this will pop your wallet to sign the create_channel tx."
              : "No messages yet. Say hi."}
          </p>
        )}
        {!loading && messages.length === 0 && channelId && (
          <p className="text-xs text-zinc-500 text-center py-6">
            {TRANSPORT_MODE === "encrypted"
              ? "Channel ready. Say hi."
              : "No messages yet. Say hi."}
          </p>
        )}
        {messages.map((m) => {
          const mine = account
            ? m.sender.toLowerCase() === account.address.toLowerCase()
            : false;
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[80%] px-3 py-2"
                style={{
                  background: mine ? "var(--sc-bronze)" : "var(--sc-panel-2)",
                  color: mine ? "var(--sc-page)" : "var(--sc-parchment)",
                  border: `1.5px solid ${
                    m.failed
                      ? "var(--sc-blood)"
                      : mine
                        ? "var(--sc-bronze-deep)"
                        : "var(--sc-rim-2)"
                  }`,
                  borderRadius: "var(--r-card)",
                  fontSize: 13,
                  opacity: m.pending ? 0.55 : 1,
                  boxShadow: "var(--sh-plate-sm)",
                }}
              >
                <div className="break-words whitespace-pre-wrap">{m.text}</div>
                <div
                  className="flex justify-end items-center gap-1 mt-1"
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--font-mono)",
                    color: mine ? "rgba(10,13,18,.65)" : "var(--fg-3)",
                  }}
                >
                  {m.failed && (
                    <span style={{ color: "var(--sc-blood)" }}>failed</span>
                  )}
                  {m.pending && (
                    <span style={{ color: "var(--sc-bronze)" }}>sending…</span>
                  )}
                  <span>{formatTimestamp(m.createdAtMs)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-3 py-1"
          style={{
            fontSize: 11,
            background: "rgba(181,61,44,.15)",
            color: "var(--sc-blood)",
            borderTop: "1px solid var(--sc-blood-deep)",
            borderLeft: "3px solid var(--sc-blood)",
          }}
        >
          {error}
        </div>
      )}
      {sdkError && !error && (
        <div
          className="px-3 py-1"
          style={{
            fontSize: 11,
            background: "rgba(200,154,63,.10)",
            color: "var(--sc-bronze)",
            borderTop: "1px solid var(--sc-bronze-deep)",
            borderLeft: "3px solid var(--sc-bronze)",
          }}
        >
          SDK note: {sdkError}
        </div>
      )}

      {/* Input */}
      <div
        className="p-2"
        style={{
          borderTop: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
        }}
      >
        <div className="flex gap-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message…"
            rows={1}
            maxLength={2000}
            disabled={sending}
            className="flex-1 px-2 py-1.5 resize-none"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              background: "var(--sc-page)",
              border: "1px solid var(--sc-rim-2)",
              borderRadius: "var(--r-sm)",
              color: "var(--sc-parchment)",
              outline: "none",
              boxShadow: "var(--rim-top), var(--rim-bottom)",
            }}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!draft.trim() || sending}
            size="sm"
          >
            {sendButtonLabel}
          </Button>
          {TRANSPORT_MODE === "encrypted" && showCancel && (
            <Button
              onClick={handleCancelSend}
              variant="danger"
              size="sm"
              title="Force-release the send button. The on-chain tx may still complete in the background."
            >
              Cancel
            </Button>
          )}
        </div>
        {TRANSPORT_MODE === "encrypted" && showCancel && (
          <p className="text-[10px] text-amber-400 mt-1">
            Send is taking longer than usual. Click Cancel to recover, or
            wait — the pipeline will time out and surface an error
            within {Math.round(PIPELINE_BUDGETS.master / 1000)} s.
          </p>
        )}
        <p className="text-[10px] text-zinc-600 mt-1">
          {TRANSPORT_MODE === "encrypted"
            ? "Each message is a signed on-chain transaction. Plain text is end-to-end encrypted via Seal; ciphertext is stored on Walrus."
            : "Messages are server-relayed. Encrypted DMs return when the Sui Stack Messaging SDK reaches beta."}
        </p>
      </div>
    </div>
  );
}
