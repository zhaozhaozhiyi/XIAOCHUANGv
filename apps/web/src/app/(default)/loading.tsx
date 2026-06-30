function LoadingCard({ className }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded-[var(--radius-md)] bg-bg-2 ${className || ''}`} />
  )
}

export default function DefaultRouteLoading() {
  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-3">
          <LoadingCard className="h-8 w-40" />
          <LoadingCard className="h-4 w-72 max-w-full" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <section className="section-card flex min-h-[420px] flex-col gap-4">
            <LoadingCard className="h-11 w-full rounded-[var(--radius-pill)]" />
            <div className="grid gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <LoadingCard key={index} className="h-[92px] w-full" />
              ))}
            </div>
          </section>

          <aside className="section-card flex min-h-[420px] flex-col gap-4">
            <LoadingCard className="h-32 w-full" />
            <LoadingCard className="h-24 w-full" />
            <LoadingCard className="h-24 w-full" />
          </aside>
        </div>
      </div>
    </div>
  )
}
