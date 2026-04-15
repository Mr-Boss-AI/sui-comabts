"use client";

import { useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";

export function ErrorToast() {
  const { state, dispatch } = useGame();
  const { errorMessage, errorTimestamp } = state;

  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => {
      dispatch({ type: "SET_ERROR", message: null });
    }, 5000);
    return () => clearTimeout(timer);
  }, [errorTimestamp, dispatch]);

  if (!errorMessage) return null;

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
