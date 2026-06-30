'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useI18n } from '@/lib/i18n'
import { Monitor, Moon, Sun, Check } from 'lucide-react'

const THEME_OPTIONS = [
  { value: 'light', labelZh: '浅色', labelEn: 'Light', icon: Sun },
  { value: 'dark', labelZh: '深色', labelEn: 'Dark', icon: Moon },
  { value: 'system', labelZh: '跟随系统', labelEn: 'System', icon: Monitor },
]

const LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export function PreferencesTab() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useI18n()
  const [mounted, setMounted] = useState(false)
  const isZh = locale === 'zh'

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMounted(true)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

  const t = {
    title: isZh ? '偏好设置' : 'Preferences',
    themeLabel: isZh ? '主题' : 'Theme',
    themeDesc: isZh ? '选择界面的显示主题' : 'Choose the display theme for the interface',
    langLabel: isZh ? '语言' : 'Language',
    langDesc: isZh ? '选择界面显示语言，切换后页面自动刷新' : 'Choose the display language. The page will refresh on change.',
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="page-title mb-1">{t.title}</h2>

      <div className="mt-8 flex flex-col gap-8 max-w-[600px]">
        {/* Theme */}
        <section>
          <div className="mb-3">
            <p className="text-sm font-semibold text-text-0">{t.themeLabel}</p>
            <p className="text-xs text-text-3 mt-0.5">{t.themeDesc}</p>
          </div>
          <div className="flex gap-3">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = mounted && theme === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`relative flex flex-col items-center gap-2 rounded-[16px] border px-5 py-4 text-xs font-medium transition-all cursor-pointer
                    ${selected
                      ? 'border-accent bg-accent-bg text-accent-text shadow-[0_0_0_1px_var(--color-accent)]'
                      : 'border-border bg-bg-0 text-text-2 hover:border-accent/40 hover:bg-bg-hover'
                    }`}
                >
                  <Icon size={18} />
                  <span>{isZh ? opt.labelZh : opt.labelEn}</span>
                  {selected && (
                    <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                      <Check size={10} className="text-on-accent" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* Language */}
        <section>
          <div className="mb-3">
            <p className="text-sm font-semibold text-text-0">{t.langLabel}</p>
            <p className="text-xs text-text-3 mt-0.5">{t.langDesc}</p>
          </div>
          <div className="flex gap-3">
            {LANG_OPTIONS.map((opt) => {
              const selected = locale === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setLocale(opt.value as 'zh' | 'en')}
                  className={`relative flex items-center gap-2 rounded-[16px] border px-6 py-3 text-sm font-medium transition-all cursor-pointer
                    ${selected
                      ? 'border-accent bg-accent-bg text-accent-text shadow-[0_0_0_1px_var(--color-accent)]'
                      : 'border-border bg-bg-0 text-text-2 hover:border-accent/40 hover:bg-bg-hover'
                    }`}
                >
                  {opt.label}
                  {selected && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent ml-1">
                      <Check size={10} className="text-on-accent" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
