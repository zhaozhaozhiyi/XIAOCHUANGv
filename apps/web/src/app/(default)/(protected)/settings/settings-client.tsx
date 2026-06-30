'use client'

import { useState } from 'react'
import { Bot, Cpu, FileText, SlidersHorizontal } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { AIServicesTab } from '@/components/settings/ai-services-tab'
import { AgentsTab } from '@/components/settings/agents-tab'
import { SkillsTab } from '@/components/settings/skills-tab'
import { PreferencesTab } from '@/components/settings/preferences-tab'

const SHOW_AI_SERVICES_TAB = true

export function SettingsPageClient() {
  const [tab, setTab] = useState('preferences')
  const { locale } = useI18n()
  const isZh = locale === 'zh'

  const TABS = [
    { id: 'preferences', label: isZh ? '偏好' : 'Preferences', icon: SlidersHorizontal },
    { id: 'agents', label: isZh ? 'Agent 配置' : 'Agent Config', icon: Bot },
    { id: 'skills', label: 'Skills', icon: FileText },
  ]
  if (SHOW_AI_SERVICES_TAB) {
    TABS.splice(1, 0, { id: 'ai', label: isZh ? 'AI 服务' : 'AI Services', icon: Cpu })
  }

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-6">
        <h1 className="page-title">{isZh ? '设置' : 'Settings'}</h1>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-border bg-bg-0 shadow-shadow-sm">
          <aside className="w-[230px] shrink-0 border-r border-border bg-bg-surface p-4 backdrop-blur-sm">
            <nav className="flex flex-col gap-1" aria-label={isZh ? '设置分类' : 'Settings categories'}>
              {TABS.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-sm cursor-pointer transition-colors text-left ${
                      tab === t.id
                        ? 'bg-accent-bg text-accent-text font-semibold'
                        : 'text-text-2 hover:bg-bg-hover hover:text-text-0'
                    }`}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={16} />
                    {t.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            {tab === 'preferences' && <PreferencesTab />}
            {SHOW_AI_SERVICES_TAB && tab === 'ai' && <AIServicesTab />}
            {tab === 'agents' && <AgentsTab />}
            {tab === 'skills' && <SkillsTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
