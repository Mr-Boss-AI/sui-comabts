"use client";

/**
 * Phase 2 v2 — Tavern Chat panel.
 *
 * Gunmetal background, parchment chat text, weathered-bronze sender
 * names (bronze for global chat, blood for whispers, weathered for
 * system). Bronze-rim input with bronze "Send" button.
 */

import { useState, useRef, useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { BronzeButton, V2Input } from "@/components/v2";

export function ChatPanel() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { chatMessages } = state;
  const [input, setInput] = useState("");
  const [whisperTarget, setWhisperTarget] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  function handleSend() {
    if (!input.trim()) return;
    state.socket.send({
      type: "chat_message",
      content: input.trim(),
      target: whisperTarget || undefined,
    });
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--sc-panel)",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
      }}
    >
      {/* Messages */}
      <div
        ref={scrollRef}
        className="scroll-plate"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {chatMessages.length === 0 && (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              textAlign: "center",
              padding: "16px 0",
              fontStyle: "italic",
            }}
          >
            No messages yet. Say hello!
          </p>
        )}
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            style={{ fontSize: 13, wordBreak: "break-word", lineHeight: 1.45 }}
          >
            {msg.type === "system" ? (
              <span style={{ color: "var(--fg-3)", fontStyle: "italic" }}>
                {msg.content}
              </span>
            ) : msg.type === "whisper" ? (
              <>
                <span
                  style={{ color: "var(--sc-blood)", fontWeight: 700 }}
                >
                  [whisper]{" "}
                  {msg.sender === account?.address
                    ? `To ${msg.target}`
                    : msg.senderName}
                  :
                </span>{" "}
                <span style={{ color: "var(--sc-parchment)" }}>{msg.content}</span>
              </>
            ) : (
              <>
                <span style={{ color: "var(--sc-bronze)", fontWeight: 700 }}>
                  {msg.senderName}:
                </span>{" "}
                <span style={{ color: "var(--sc-parchment)" }}>{msg.content}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: "1px solid var(--sc-rim)",
          padding: 8,
          background: "var(--sc-panel-2)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {whisperTarget && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--sc-blood)", fontWeight: 700, letterSpacing: ".06em" }}>
              [WHISPER → {whisperTarget.slice(0, 8)}…]
            </span>
            <button
              onClick={() => setWhisperTarget("")}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--fg-3)",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
              }}
            >
              ×
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <V2Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={whisperTarget ? "Whisper…" : "Type a message…"}
            maxLength={500}
            style={{ flex: 1 }}
          />
          <BronzeButton
            onClick={handleSend}
            disabled={!input.trim()}
            size="sm"
          >
            Send
          </BronzeButton>
        </div>
      </div>
    </div>
  );
}

export function setWhisperTargetGlobal(_address: string) {
  // Will be connected via context if needed
}
