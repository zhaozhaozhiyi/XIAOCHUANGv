'use client'

import { createContext, useContext, useCallback } from 'react'
import { useRouter } from 'next/navigation'

export type Locale = 'zh' | 'en'

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
})

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter()

  const setLocale = useCallback((next: Locale) => {
    document.cookie = `locale=${next}; path=/; max-age=31536000; SameSite=Lax`
    router.refresh()
  }, [router])

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
