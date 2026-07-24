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
    subtitle: isZh ? '调整主题与界面语言，工作台会即时响应这些变化。' : 'Adjust theme and interface language. Changes apply to the workspace immediately.',
    themeLabel: isZh ? '主题' : 'Theme',
    themeDesc: isZh ? '选择界面的显示主题' : 'Choose the display theme for the interface',
    langLabel: isZh ? '语言' : 'Language',
    langDesc: isZh ? '选择界面显示语言，切换后页面自动刷新' : 'Choose the display language. The page will refresh on change.',
  }

  return (
    <div className="settings-pane">
      <div className="settings-pane-head">
        <h2 className="page-title mb-1">{t.title}</h2>
        <p className="page-subtitle">{t.subtitle}</p>
      </div>

      <div className="settings-pane-body settings-pane-body--narrow">
        <div className="settings-stack">
          <section className="settings-section">
            <div className="settings-section-head">
              <p>{t.themeLabel}</p>
              <p>{t.themeDesc}</p>
            </div>
            <div className="settings-choice-grid">
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const selected = mounted && theme === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className="settings-choice-card"
                    data-active={selected ? 'true' : 'false'}
                  >
                    <Icon size={18} />
                    <span>{isZh ? opt.labelZh : opt.labelEn}</span>
                    {selected && (
                      <span className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                        <Check size={10} className="text-on-accent" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <p>{t.langLabel}</p>
              <p>{t.langDesc}</p>
            </div>
            <div className="settings-choice-grid">
              {LANG_OPTIONS.map((opt) => {
                const selected = locale === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLocale(opt.value as 'zh' | 'en')}
                    className="settings-choice-card"
                    data-active={selected ? 'true' : 'false'}
                  >
                    <span>{opt.label}</span>
                    {selected && (
                      <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-accent">
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
    </div>
  )
}
