function LoadingCard({ className }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded-[var(--radius-md)] bg-bg-2 ${className || ''}`} />
  )
}

export default function ProtectedRouteLoading() {
  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <LoadingCard className="h-8 w-36" />
            <LoadingCard className="h-4 w-72 max-w-full" />
          </div>
          <LoadingCard className="h-10 w-32 rounded-[var(--radius-md)]" />
        </div>

        <div className="mb-5 flex flex-wrap gap-3">
          <LoadingCard className="h-10 w-56 rounded-[var(--radius-pill)]" />
          <LoadingCard className="h-10 w-36 rounded-[var(--radius-pill)]" />
          <LoadingCard className="h-10 w-32 rounded-[var(--radius-pill)]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <LoadingCard key={index} className="aspect-[16/10] w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
