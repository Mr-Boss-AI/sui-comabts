"use client";

import { useState, useRef, useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1 p-3 min-h-0"
      >
        {chatMessages.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-4">
            No messages yet. Say hello!
          </p>
        )}
        {chatMessages.map((msg) => (
          <div key={msg.id} className="text-sm break-words">
            {msg.type === "system" ? (
              <span className="text-zinc-500 italic">{msg.content}</span>
            ) : msg.type === "whisper" ? (
              <>
                <span className="text-purple-400 font-medium">
                  [whisper] {msg.sender === account?.address ? `To ${msg.target}` : msg.senderName}:
                </span>{" "}
                <span className="text-purple-200">{msg.content}</span>
              </>
            ) : (
              <>
                <span className="text-emerald-400 font-medium">
                  {msg.senderName}:
                </span>{" "}
                <span className="text-zinc-300">{msg.content}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-2 space-y-1">
        {whisperTarget && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-purple-400">
              Whispering to {whisperTarget.slice(0, 8)}...
            </span>
            <button
              onClick={() => setWhisperTarget("")}
              className="text-zinc-500 hover:text-zinc-300"
            >
              &times;
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={whisperTarget ? "Whisper..." : "Type a message..."}
            maxLength={500}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export function setWhisperTargetGlobal(address: string) {
  // Will be connected via context if needed
}
