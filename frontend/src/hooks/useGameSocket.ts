"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/types/ws-messages";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

type MessageHandler = (msg: ServerMessage) => void;

export function useGameSocket(walletAddress: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // Returns true when the message was handed to an OPEN socket, false when
  // the socket is missing / connecting / closed. Callers that care about
  // delivery (wager creation, wager accept, fight actions) must check the
  // return value and surface failure to the user — silent drops caused the
  // orphaned-wager bug. Routine polling calls can ignore it.
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

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: "auth", walletAddress }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            setAuthenticated(true);
          }
          handlersRef.current.forEach((handler) => handler(msg));
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = (event) => {
        // Stale close — a newer connect() already replaced wsRef with a
        // different socket. Ignore this handler so we don't null out the
        // live ref and silently drop every send() that follows. (Root cause
        // of the 2026-04-19 orphaned-wager incidents.)
        if (wsRef.current !== ws) return;

        setConnected(false);
        setAuthenticated(false);
        wsRef.current = null;
        // 4001 = server deliberately replaced this session with a newer one.
        // Reconnecting would just kick that newer session out → infinite loop.
        if (event.code === 4001) return;
        reconnectTimeout.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setAuthenticated(false);
    };
  }, [walletAddress]);

  return useMemo(
    () => ({ send, addHandler, connected, authenticated }),
    [send, addHandler, connected, authenticated],
  );
}
