"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"

type DialogLayout = "default" | "panel"
type DialogVariant = "default" | "confirm" | "form" | "workspace" | "media"
type DialogSize = "default" | "compact" | "standard" | "large" | "wide" | "xlarge"
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
  standard: "max-w-[min(100%-2rem,560px)] sm:max-w-[560px]",
  large: "w-[min(720px,calc(100%-2rem))] max-w-[720px] sm:max-w-[720px]",
  wide: "w-[min(920px,calc(100%-2rem))] max-w-[920px] sm:max-w-[920px]",
  xlarge: "w-[min(1100px,calc(100%-2rem))] max-w-[1100px] sm:max-w-[1100px]",
}

const dialogContentVariantClassNames: Record<DialogVariant, string> = {
  default: "",
  confirm:
    "flex max-h-[min(92dvh,calc(100dvh-2rem))] w-full max-w-[min(100%-2rem,420px)] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[420px]",
  form:
    "flex max-h-[min(92dvh,calc(100dvh-2rem))] w-full max-w-[min(100%-2rem,560px)] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[560px]",
  workspace:
    "flex max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(920px,calc(100%-2rem))] max-w-[920px] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[920px]",
  media:
    "flex h-[100dvh] w-[100vw] max-w-none flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none",
}

const dialogHeaderBarDensityClassNames: Record<DialogDensity, string> = {
  default:
    "shrink-0 bg-bg-0/90 px-8 pb-6 pt-10 sm:px-10 sm:pb-8 sm:pt-11",
  compact:
    "shrink-0 bg-bg-0/90 px-6 pb-4 pt-6 sm:px-7 sm:pb-5 sm:pt-7",
}

const dialogHeaderBarVariantClassNames: Record<DialogVariant, string> = {
  default: "",
  confirm:
    "shrink-0 bg-transparent px-6 pb-4 pt-6 sm:px-7 sm:pb-4 sm:pt-7",
  form:
    "shrink-0 border-b border-border/70 bg-bg-0/80 px-6 pb-5 pt-6 sm:px-8 sm:pt-7",
  workspace:
    "shrink-0 border-b border-border/70 bg-bg-0/90 px-6 py-5 sm:px-8",
  media: "shrink-0",
}

const dialogMainDensityClassNames: Record<DialogDensity, string> = {
  default: "flex flex-col gap-6 px-8 py-8 sm:px-10 sm:py-9",
  compact: "flex flex-col gap-4 px-6 py-5 sm:px-7 sm:py-6",
}

const dialogMainVariantClassNames: Record<DialogVariant, string> = {
  default: "",
  confirm: "flex flex-col gap-3 px-6 py-4 sm:px-7",
  form: "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 sm:px-8 sm:py-7",
  workspace: "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 sm:px-8",
  media: "flex min-h-0 flex-1 items-center justify-center p-0",
}

const dialogActionsDensityClassNames: Record<DialogDensity, string> = {
  default:
    "flex shrink-0 flex-col-reverse flex-wrap gap-3 px-8 pt-6 pb-8 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-10 sm:pb-9",
  compact:
    "flex shrink-0 flex-col-reverse flex-wrap gap-2.5 px-6 pt-4 pb-5 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-7 sm:pb-6",
}

const dialogActionsVariantClassNames: Record<DialogVariant, string> = {
  default: "",
  confirm:
    "flex shrink-0 flex-col-reverse gap-2.5 px-6 pb-6 pt-3 sm:flex-row sm:items-center sm:justify-end sm:px-7",
  form:
    "flex shrink-0 flex-col-reverse gap-3 border-t border-border/70 bg-bg-0/70 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8",
  workspace:
    "flex shrink-0 flex-col-reverse gap-3 border-t border-border/70 bg-bg-0/70 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8",
  media: "flex shrink-0",
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
  variant = "default",
  showCloseButton,
  onInteractOutside,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: DialogLayout
  variant?: DialogVariant
  size?: DialogSize
  showCloseButton?: boolean
}) {
  const fallbackDescriptionId = React.useId()
  const describedBy = ariaDescribedBy ?? fallbackDescriptionId
  const usesVariantPreset = variant !== "default"
  const resolvedShowCloseButton =
    showCloseButton ?? (variant !== "confirm" && variant !== "media")

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-dialog-variant={variant}
        className={cn(
          "fixed top-[50%] left-[50%] z-50 translate-x-[-50%] translate-y-[-50%] duration-200 outline-none backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200",
          usesVariantPreset
            ? dialogContentVariantClassNames[variant]
            : dialogContentLayoutClassNames[layout],
          usesVariantPreset && size === "default"
            ? null
            : dialogContentSizeClassNames[size],
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
        {resolvedShowCloseButton && (
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

/** 弹窗顶栏：与 `DialogContent` 的四类预设或旧版 panel 布局配合 */
function DialogHeaderBar({
  className,
  variant = "default",
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: DialogVariant
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-header-bar"
      data-dialog-variant={variant}
      className={cn(
        variant === "default"
          ? dialogHeaderBarDensityClassNames[density]
          : dialogHeaderBarVariantClassNames[variant],
        className
      )}
      {...props}
    />
  )
}

/** 弹窗主体（表单、说明等） */
function DialogMain({
  className,
  variant = "default",
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: DialogVariant
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-main"
      data-dialog-variant={variant}
      className={cn(
        variant === "default"
          ? dialogMainDensityClassNames[density]
          : dialogMainVariantClassNames[variant],
        className
      )}
      {...props}
    />
  )
}

/** 弹窗底栏（主/次操作），默认右对齐 */
function DialogActions({
  className,
  variant = "default",
  density = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: DialogVariant
  density?: DialogDensity
}) {
  return (
    <div
      data-slot="dialog-actions"
      data-dialog-variant={variant}
      className={cn(
        variant === "default"
          ? dialogActionsDensityClassNames[density]
          : dialogActionsVariantClassNames[variant],
        className
      )}
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
