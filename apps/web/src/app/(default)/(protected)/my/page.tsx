'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  LogOut,
  UserRound,
} from 'lucide-react'

import { dramaAPI, taskAPI } from '@/lib/api'
import { useAppSession } from '@/components/shared/app-session-provider'
import { ContentPageHeader, ContentSurface } from '@/components/shared/content-kit'
import { Button } from '@/components/ui/button'
import type { TaskRecord } from '@/types/api'

export default function MyPage() {
  const { authenticated, currentUser, refreshSession } = useAppSession()
  const [loading, setLoading] = useState(true)
  const [dramaTotal, setDramaTotal] = useState(0)
  const [tasks, setTasks] = useState<TaskRecord[]>([])

  useEffect(() => {
    if (authenticated && !currentUser) {
      void refreshSession()
    }
  }, [authenticated, currentUser, refreshSession])

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const [dramaStats, taskPayload] = await Promise.all([
          dramaAPI.stats(),
          taskAPI.list({ page_size: 20, sort: 'updated_at' }),
        ])
        setDramaTotal(dramaStats.total || 0)
        setTasks(taskPayload.items || [])
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const runningCount = tasks.filter((task) => task.status === 'queued' || task.status === 'running').length
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const isAdmin = currentUser?.role === 'admin' || currentUser?.account_type === 'admin'

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full max-w-5xl">
        <ContentPageHeader
          title="个人中心"
          description="查看账户身份、创作统计与登录状态。"
        />

        <ContentSurface className="gap-5">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="settings-record-card flex min-w-0 flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-bg)_58%,var(--color-bg-0))] text-accent-text">
                <UserRound size={20} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="min-w-0 max-w-full truncate font-display text-base font-semibold leading-tight text-text-0 sm:text-lg">
                    {currentUser?.display_name || '未命名用户'}
                  </h2>
                  <span className="rounded-full bg-bg-0/78 px-2.5 py-1 text-[11px] font-medium leading-none text-text-2">
                    {currentUser?.phone || '未公开'}
                  </span>
                  {isAdmin ? (
                    <span className="rounded-full bg-accent-bg px-2.5 py-1 text-[11px] font-medium leading-none text-accent-text">
                      Admin
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 break-all text-xs leading-5 text-text-3 [overflow-wrap:anywhere]">
                  用户 ID：{currentUser?.admin_user_id || '--'}
                </p>
              </div>
            </div>

            <div className="settings-record-card flex items-center justify-between gap-3 px-5 py-5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-0">退出账号</p>
                <p className="mt-1 text-xs leading-5 text-text-3">结束当前登录会话。</p>
              </div>
              <Button asChild variant="ghost" className="h-10 shrink-0 rounded-full bg-bg-0/78 px-3 text-text-2 shadow-none hover:bg-bg-0 hover:text-text-0">
                <Link href="/logout">
                  <LogOut />
                  退出
                </Link>
              </Button>
            </div>
          </section>

          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy={loading}
            aria-label="账户创作统计"
          >
            {[
              {
                label: '短剧项目',
                value: loading ? '--' : dramaTotal,
                description: '已创建的项目总数',
              },
              {
                label: '进行中任务',
                value: loading ? '--' : runningCount,
                description: '排队中和生成中任务',
              },
              {
                label: '累计完成',
                value: loading ? '--' : completedCount,
                description: '已完成任务总数',
              },
            ].map((item) => (
              <div key={item.label} className="settings-section min-h-[118px]">
                <div className="text-xs font-medium leading-none text-text-3">
                  {item.label}
                </div>
                <div className="mt-4 font-display text-[34px] font-semibold leading-none tracking-tight text-text-0">
                  {item.value}
                </div>
                <p className="mt-3 text-xs leading-5 text-text-3">{item.description}</p>
              </div>
            ))}
          </section>
        </ContentSurface>
      </div>
    </div>
  )
}
