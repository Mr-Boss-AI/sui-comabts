"use client";

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

  // Sticky errors use a more prominent banner — larger padding, stronger
  // border, explicit "Dismiss" button, and a warning icon. Use for events
  // that could cost real money (stranded escrow, lost tx) — the 5s fade
  // is too easy to miss for those.
  if (errorSticky) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 pointer-events-none">
        <div className="pointer-events-auto bg-red-950 border-2 border-red-500 rounded-lg px-6 py-4 shadow-2xl max-w-2xl flex items-start gap-4 animate-slide-in-right">
          <span className="text-red-400 text-2xl leading-none mt-0.5">!</span>
          <div className="flex-1 min-w-0">
            <div className="text-red-200 font-semibold text-sm mb-1">Action required</div>
            <div className="text-red-100 text-sm whitespace-pre-wrap break-words">{errorMessage}</div>
          </div>
          <button
            onClick={() => dispatch({ type: "SET_ERROR", message: null })}
            className="bg-red-800 hover:bg-red-700 text-red-100 text-xs font-medium px-3 py-1.5 rounded border border-red-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-700 rounded-xl px-5 py-3 shadow-2xl max-w-md flex items-center gap-3 animate-slide-in-right">
      <span className="text-red-200 text-sm">{errorMessage}</span>
      <button
        onClick={() => dispatch({ type: "SET_ERROR", message: null })}
        className="text-red-400 hover:text-red-200 text-lg leading-none ml-2"
      >
        x
      </button>
    </div>
  );
}
