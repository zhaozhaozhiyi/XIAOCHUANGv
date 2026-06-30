export function buildLoginPath(next: string) {
  return `/login?next=${encodeURIComponent(next)}`
}

export function redirectToLogin(next: string) {
  if (typeof window === 'undefined') return
  window.location.assign(buildLoginPath(next))
}

export function redirectToLoginFromCurrentLocation() {
  if (typeof window === 'undefined') return
  redirectToLogin(`${window.location.pathname}${window.location.search}`)
}
