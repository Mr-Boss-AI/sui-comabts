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

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
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
