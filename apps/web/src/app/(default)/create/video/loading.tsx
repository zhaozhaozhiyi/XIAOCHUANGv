function LoadingCard({ className }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded-[var(--radius-md)] bg-bg-2 ${className || ''}`} />
  )
}

export default function QuickCreateVideoLoading() {
  return (
    <div className="quick-create-chat flex h-full min-h-0 flex-col">
      <header className="shrink-0 bg-bg-surface/80 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between gap-3">
          <LoadingCard className="h-6 w-20" />
          <div className="flex items-center gap-1.5">
            <LoadingCard className="h-8 w-24 rounded-[8px]" />
            <LoadingCard className="h-8 w-24 rounded-[8px]" />
            <LoadingCard className="h-8 w-24 rounded-[8px]" />
            <LoadingCard className="h-8 w-20 rounded-[8px]" />
          </div>
        </div>
      </header>

      <div className="quick-create-scroll-frame mx-auto min-h-0 flex-1 w-full max-w-[1040px] overflow-y-auto">
        <div className="flex w-full flex-col gap-8 px-4 py-6 sm:px-0">
          <section className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <LoadingCard className="h-7 w-14" />
              <LoadingCard className="h-4 w-16" />
            </div>

            {Array.from({ length: 2 }).map((_, index) => (
              <article key={index} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <LoadingCard className="h-4 w-48" />
                  <LoadingCard className="h-4 w-20" />
                  <LoadingCard className="h-6 w-16 rounded-full" />
                </div>
                <LoadingCard className="aspect-video w-full max-w-[640px]" />
                <div className="flex flex-wrap gap-2">
                  <LoadingCard className="h-8 w-24 rounded-[8px]" />
                  <LoadingCard className="h-8 w-24 rounded-[8px]" />
                  <LoadingCard className="h-8 w-24 rounded-[8px]" />
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>

      <div className="shrink-0 bg-bg-surface px-4 pb-2 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[1040px]">
          <LoadingCard className="h-[188px] rounded-[20px]" />
        </div>
      </div>
    </div>
  )
}
