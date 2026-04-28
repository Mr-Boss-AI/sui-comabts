"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/types/ws-messages";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

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

export function useGameSocket(walletAddress: string | null, signChallenge: SignChallengeFn) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const signChallengeRef = useRef(signChallenge);
  signChallengeRef.current = signChallenge;
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const send = useCallback((msg: ClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    console.error(
      `[WS] DROPPED outbound ${msg.type} — readyState=${wsRef.current?.readyState ?? "null"}`,
      msg,
    );
    return false;
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
