"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={`bg-[#0c0c0f] border border-amber-900/25 rounded shadow-2xl shadow-black/70 ${wide ? "max-w-2xl" : "max-w-md"} w-full mx-4 max-h-[85vh] flex flex-col`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-amber-900/20 px-6 py-3 bg-gradient-to-r from-zinc-900/40 via-zinc-900/20 to-zinc-900/40">
            <h2 className="text-base font-bold text-zinc-200">{title}</h2>
            <button
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 text-xl leading-none"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
