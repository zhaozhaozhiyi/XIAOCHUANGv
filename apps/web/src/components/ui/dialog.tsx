"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"

type DialogLayout = "default" | "panel"
type DialogSize = "default" | "compact" | "standard" | "large"
type DialogDensity = "default" | "compact"

const dialogContentLayoutClassNames: Record<DialogLayout, string> = {
  default:
    "flex max-h-[min(100vh-2rem,calc(100dvh-2rem))] w-full max-w-[calc(100%-2rem)] flex-col gap-6 overflow-y-auto rounded-[var(--radius-xl)] border border-border bg-bg-surface p-8 shadow-shadow-elevated sm:max-w-lg sm:p-9",
  panel:
    "flex max-h-[min(92dvh,calc(100dvh-2rem))] w-full flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-surface p-0 shadow-shadow-elevated",
}

const dialogContentSizeClassNames: Record<DialogSize, string> = {
  default: "",
  compact: "max-w-[min(100%-2rem,420px)] sm:max-w-[420px]",
  standard: "max-w-[min(100%-2rem,480px)] sm:max-w-[480px]",
  large: "w-[min(720px,calc(100%-2rem))] max-w-[720px] sm:max-w-[720px]",
}

const dialogHeaderBarDensityClassNames: Record<DialogDensity, string> = {
  default:
    "shrink-0 border-b border-border bg-bg-0/90 px-8 pb-6 pt-10 sm:px-10 sm:pb-8 sm:pt-11",
  compact:
    "shrink-0 border-b border-border bg-bg-0/90 px-6 pb-4 pt-6 sm:px-7 sm:pb-5 sm:pt-7",
}

const dialogMainDensityClassNames: Record<DialogDensity, string> = {
  default: "flex flex-col gap-6 px-8 py-8 sm:px-10 sm:py-9",
  compact: "flex flex-col gap-4 px-6 py-5 sm:px-7 sm:py-6",
}

const dialogActionsDensityClassNames: Record<DialogDensity, string> = {
  default:
    "flex shrink-0 flex-col-reverse flex-wrap gap-3 border-t border-border px-8 pt-6 pb-8 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-10 sm:pb-9",
  compact:
    "flex shrink-0 flex-col-reverse flex-wrap gap-2.5 border-t border-border px-6 pt-4 pb-5 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-7 sm:pb-6",
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay backdrop-blur-[6px] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  layout = "default",
  size = "default",
  showCloseButton = true,
  onInteractOutside,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: DialogLayout
  size?: DialogSize
  showCloseButton?: boolean
}) {
  const fallbackDescriptionId = React.useId()
  const describedBy = ariaDescribedBy ?? fallbackDescriptionId

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 translate-x-[-50%] translate-y-[-50%] duration-200 outline-none backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200",
          dialogContentLayoutClassNames[layout],
          dialogContentSizeClassNames[size],
          className
        )}
        onInteractOutside={(event) => {
          const target = event.target
          if (
            target instanceof HTMLElement &&
            target.closest("[data-dialog-allow-outside-interaction]")
          ) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        aria-describedby={describedBy}
        {...props}
      >
        {ariaDescribedBy ? null : (
          <DialogPrimitive.Description
            id={fallbackDescriptionId}
            className="sr-only"
          >
            对话框内容
          </DialogPrimitive.Description>
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="关闭对话框"
            className="absolute top-5 right-5 flex size-9 items-center justify-center rounded-full text-text-2 opacity-70 transition-all hover:opacity-100 hover:bg-bg-hover hover:text-text-0 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon aria-hidden />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-3 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-display text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-text-2", className)}
      {...props}
    />
  )
}

/** 弹窗顶栏：与 `DialogContent layout="panel"` 配合，统一全站留白与密度档位 */
function DialogHeaderBar({
  className,
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-header-bar"
      className={cn(dialogHeaderBarDensityClassNames[density], className)}
      {...props}
    />
  )
}

/** 弹窗主体（表单、说明等） */
function DialogMain({
  className,
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-main"
      className={cn(dialogMainDensityClassNames[density], className)}
      {...props}
    />
  )
}

/** 弹窗底栏（主/次操作），默认右对齐 */
function DialogActions({
  className,
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-actions"
      className={cn(dialogActionsDensityClassNames[density], className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderBar,
  DialogMain,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
