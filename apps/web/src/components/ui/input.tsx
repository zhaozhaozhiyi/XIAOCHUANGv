import * as React from "react"

import { cn } from "@/lib/cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--radius-sm)] border border-border bg-bg-input px-3 py-1 text-sm shadow-shadow-xs transition-[color,box-shadow] outline-none placeholder:text-text-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-border-focus focus-visible:ring-[3px] focus-visible:ring-accent/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
