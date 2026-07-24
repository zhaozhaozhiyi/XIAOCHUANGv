let quickCreateRouteModulePromise: Promise<unknown> | null = null

export function preloadQuickCreateRouteModule() {
  if (!quickCreateRouteModulePromise) {
    quickCreateRouteModulePromise = import('@/components/create/quick-create-video-page-client').catch((error) => {
      quickCreateRouteModulePromise = null
      throw error
    })
  }

  return quickCreateRouteModulePromise
}
