'use client'

import { useState } from 'react'
import { Bot, Cpu, FileText, SlidersHorizontal } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { AIServicesTab } from '@/components/settings/ai-services-tab'
import { AgentsTab } from '@/components/settings/agents-tab'
import { SkillsTab } from '@/components/settings/skills-tab'
import { PreferencesTab } from '@/components/settings/preferences-tab'
import { ContentPageHeader } from '@/components/shared/content-kit'

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

  const introLabel = isZh ? '控制中心' : 'Control Center'
  const introText = isZh
    ? '统一管理界面偏好、AI 服务与 Agent 能力，常用配置会在这里长期沉淀。'
    : 'Manage interface preferences, AI services, and Agent capabilities from one shared control surface.'

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-6">
        <ContentPageHeader
          title={isZh ? '设置' : 'Settings'}
          description={introText}
          className="mb-1"
        />

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <p className="settings-kicker">{introLabel}</p>

            <nav className="settings-nav" aria-label={isZh ? '设置分类' : 'Settings categories'}>
              {TABS.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="settings-nav-button"
                    data-active={tab === t.id ? 'true' : 'false'}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={16} />
                    {t.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="settings-content">
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
