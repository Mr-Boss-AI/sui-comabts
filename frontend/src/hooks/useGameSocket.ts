"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/types/ws-messages";
import { drainPendingMessages, type PendingMessage } from "@/lib/ws-pending-queue";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

/**
 * How long a queued message remains valid. Messages older than this are
 * dropped on drain (session-stale — re-fetching will be done by the
 * mount-time effects anyway). 30s mirrors the testnet RPC rule of thumb
 * that anything older is likely overtaken by newer state.
 */
const PENDING_STALE_THRESHOLD_MS = 30_000;

type MessageHandler = (msg: ServerMessage) => void;

type StoredJwt = { token: string; expiresAt: number };

/** Signature provider — caller injects a wallet-backed signer. The hook
 *  calls this when the server emits `auth_challenge`. Should return the
 *  base64 signature produced by `signPersonalMessage`. */
export type SignChallengeFn = (messageBytes: Uint8Array) => Promise<string>;

function jwtStorageKey(walletAddress: string): string {
  return `sui-combats-jwt-${walletAddress.toLowerCase()}`;
}

function readStoredJwt(walletAddress: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(jwtStorageKey(walletAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredJwt;
    // Require >60s of remaining life so we don't race the server's expiry check.
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt < Date.now() + 60_000) {
      window.localStorage.removeItem(jwtStorageKey(walletAddress));
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function writeStoredJwt(walletAddress: string, token: string, expiresAt: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      jwtStorageKey(walletAddress),
      JSON.stringify({ token, expiresAt }),
    );
  } catch {
    // ignore storage quota / privacy-mode failures
  }
}

function clearStoredJwt(walletAddress: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(jwtStorageKey(walletAddress));
  } catch {
    // ignore
  }
}

/** Cap the pending queue so a runaway polling effect can't grow it
 *  unboundedly across a long disconnect. 200 covers >5 min of typical
 *  polling cadence; older entries are dropped first. */
const PENDING_QUEUE_MAX = 200;

export function useGameSocket(walletAddress: string | null, signChallenge: SignChallengeFn) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const signChallengeRef = useRef(signChallenge);
  signChallengeRef.current = signChallenge;
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  /**
   * Pending messages queued during CONNECTING / CLOSING / CLOSED windows.
   * Drained by the `onopen` handler in FIFO order (Fix 2, 2026-05-04).
   * Capped at PENDING_QUEUE_MAX entries; oldest dropped first if a runaway
   * producer overflows it.
   */
  const pendingRef = useRef<PendingMessage<ClientMessage>[]>([]);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const send = useCallback((msg: ClientMessage): boolean => {
    const payload = JSON.stringify(msg);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload);
      return true;
    }

    // Socket isn't OPEN — queue and drain on reconnect (Fix 2,
    // 2026-05-04). readyState=0 (CONNECTING), 2 (CLOSING), 3
    // (CLOSED), or null (no socket yet) all flow here. Polling
    // effects that fire during the reconnect window land in the
    // queue rather than spraying console errors.
    pendingRef.current.push({
      payload,
      type: msg.type,
      enqueuedAt: Date.now(),
      raw: msg,
    });

    // Cap the queue against a runaway producer (e.g. a polling effect
    // with a broken dependency array). Drops oldest entries first.
    const dropped = (pendingRef.current.length > PENDING_QUEUE_MAX)
      ? (() => {
          const overflow = pendingRef.current.length - PENDING_QUEUE_MAX;
          pendingRef.current.splice(0, overflow);
          return overflow;
        })()
      : 0;
    if (dropped > 0) {
      console.warn(`[WS] pending queue overflow — dropped ${dropped} oldest entries`);
    }

    // Demoted from console.error → console.debug. This is EXPECTED
    // during reconnect, not an error condition.
    console.debug(
      `[WS] queued outbound ${msg.type} until reconnect (readyState=${wsRef.current?.readyState ?? "null"}, queue=${pendingRef.current.length})`,
    );

    // Return value semantically: did the message reach the socket
    // synchronously? No — but it will (probably) on next drain.
    // Callers that already track `connected` / `authenticated` rely
    // on the boolean to decide whether to retry; queued messages are
    // a soft success and shouldn't trigger a retry. Return true.
    return true;
  }, []);

  useEffect(() => {
    if (!walletAddress) return;

    function startHandshake(ws: WebSocket, addr: string) {
      const stored = readStoredJwt(addr);
      if (stored) {
        ws.send(JSON.stringify({ type: "auth_token", walletAddress: addr, token: stored }));
      } else {
        ws.send(JSON.stringify({ type: "auth_request", walletAddress: addr }));
      }
    }

    function connect(addr: string) {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setAuthError(null);
        startHandshake(ws, addr);

        // Drain any messages queued during the disconnect window
        // (Fix 2, 2026-05-04). Stale messages (>30 s old) are
        // discarded — the mount-time effects in GameProvider re-issue
        // polling fetches anyway, so re-sending stale ones is at best
        // wasteful and at worst surfaces stale state. Drain runs
        // BEFORE handlers fan out to avoid out-of-order deliveries
        // racing the queued messages.
        if (pendingRef.current.length > 0) {
          const result = drainPendingMessages(
            pendingRef.current,
            (payload) => {
              if (ws.readyState !== WebSocket.OPEN) return false;
              ws.send(payload);
              return true;
            },
            Date.now(),
            PENDING_STALE_THRESHOLD_MS,
          );
          if (result.sent > 0 || result.discarded > 0) {
            console.debug(
              `[WS] pending drain: ${result.sent} sent, ${result.discarded} discarded`,
            );
          }
        }
      };

      ws.onmessage = async (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        // Handshake messages — handled inline before fanning out to handlers.
        if (msg.type === "auth_challenge") {
          try {
            const messageBytes = new TextEncoder().encode(msg.message);
            const signature = await signChallengeRef.current(messageBytes);
            if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "auth_signature", signature }));
            }
          } catch (err: any) {
            const reason = err?.message || "Wallet rejected the sign-in.";
            setAuthError(reason);
            // Don't auto-retry — the user explicitly cancelled or the wallet
            // is unavailable. Reload the page (or reconnect the wallet) to
            // try again. Storing nothing keeps the next attempt clean.
          }
          return;
        }

        if (msg.type === "auth_required") {
          // The token we just sent was rejected; drop it and request a fresh
          // signed challenge.
          clearStoredJwt(addr);
          if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "auth_request", walletAddress: addr }));
          }
          return;
        }

        if (msg.type === "auth_ok") {
          setAuthenticated(true);
          setAuthError(null);
          if (msg.token && msg.tokenExpiresAt) {
            writeStoredJwt(addr, msg.token, msg.tokenExpiresAt);
          }
        }

        handlersRef.current.forEach((handler) => handler(msg));
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        setAuthenticated(false);
        wsRef.current = null;
        // 4001 = server replaced this session with a newer one; don't reconnect.
        if (event.code === 4001) return;
        reconnectTimeout.current = setTimeout(() => connect(addr), 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect(walletAddress);

    return () => {
      clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setAuthenticated(false);
    };
  }, [walletAddress]);

  return useMemo(
    () => ({ send, addHandler, connected, authenticated, authError }),
    [send, addHandler, connected, authenticated, authError],
  );
}

/** Helper for callers that want to surface a "signed out" UI: clears any
 *  stored JWT and lets the next reconnect re-trigger the signed handshake. */
export function clearWalletAuthToken(walletAddress: string): void {
  clearStoredJwt(walletAddress);
}
