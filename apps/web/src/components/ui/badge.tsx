import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 font-semibold whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-accent-glow bg-accent-bg text-accent-text text-[11px] [a&]:hover:opacity-90",
        secondary:
          "border-border bg-bg-2 text-text-1 text-xs [a&]:hover:bg-bg-hover",
        destructive:
          "border-transparent bg-error-bg text-error text-xs focus-visible:ring-destructive/20 [a&]:hover:opacity-90",
        outline:
          "border-border text-text-1 text-xs [a&]:hover:bg-accent-bg [a&]:hover:text-accent-text",
        ghost:
          "border-transparent text-text-2 text-xs [a&]:hover:bg-accent-bg [a&]:hover:text-accent-text",
        link: "border-transparent text-accent text-xs underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
