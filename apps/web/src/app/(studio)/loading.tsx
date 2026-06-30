function StudioLoadingPanel({ className }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded-2xl bg-bg-2 ${className || ''}`} />
  )
}

export default function StudioRouteLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 gap-4 bg-bg-surface p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <StudioLoadingPanel className="h-14 w-full" />
        <StudioLoadingPanel className="min-h-0 flex-1 w-full" />
      </div>
      <div className="hidden w-[320px] shrink-0 xl:block">
        <StudioLoadingPanel className="h-full w-full" />
      </div>
    </div>
  )
}
