import { forwardRef, type ButtonHTMLAttributes } from "react";

const variants = {
  primary:
    "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30",
  secondary:
    "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700",
  danger: "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30",
  ghost: "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100",
  gold: "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...props}
    />
  )
);
Button.displayName = "Button";
