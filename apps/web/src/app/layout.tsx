import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { ThemeProvider } from 'next-themes'
import { I18nProvider } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MSWProvider } from '@/components/canvas/msw-provider'
import './globals.css'

export const metadata: Metadata = {
  title: '小窗 XIAOCHUANG',
  description: '小窗 XIAOCHUANG — 面向创作者的 AI 内容创作平台，聚焦灵感发现与视频生成。',
  icons: { icon: '/window.svg' },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const rawLocale = cookieStore.get('locale')?.value ?? 'zh'
  const locale: Locale = rawLocale === 'en' ? 'en' : 'zh'

  return (
    <html lang={locale === 'en' ? 'en' : 'zh-CN'} style={{ height: '100%' }} suppressHydrationWarning>
      <body className="bg-bg-page text-text-0" style={{ height: '100%', margin: 0 }} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider locale={locale}>
            <TooltipProvider>
              <MSWProvider>
                <div className="flex h-full min-h-0 flex-col">
                  {children}
                </div>
              </MSWProvider>
              <Toaster />
            </TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
