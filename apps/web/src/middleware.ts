import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'xiaochuang_session'

const PROTECTED_PREFIXES = [
  '/assets',
  '/canvas',
  '/drama',
  '/my',
  '/settings',
  '/writing',
] as const

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname === '/create') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', `${pathname}${search}`)

  const protectedRoute = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  if (!protectedRoute || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const target = new URL('/login', request.url)
  target.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(target)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
