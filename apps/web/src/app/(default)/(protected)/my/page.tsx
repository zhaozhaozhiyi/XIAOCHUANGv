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

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="page-title">个人中心</h1>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <section className="flex flex-col gap-6">
            {/* User Info Card */}
            <div className="rounded-[28px] border border-border bg-bg-0 p-6 shadow-shadow-sm sm:p-7">
              <div className="flex flex-col gap-3 text-sm text-text-1">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-accent-bg text-accent">
                    <UserRound size={18} />
                  </div>
                  <div>
                    <div className="font-semibold text-text-0">
                      {currentUser?.display_name || '未命名用户'}
                    </div>
                    <div className="text-xs text-text-3">
                      {currentUser?.phone || '未公开'}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-text-3">
                  Admin 用户 ID：{currentUser?.admin_user_id || '--'}
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-[22px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-3">
                  短剧项目
                </div>
                <div className="text-3xl font-semibold text-text-0">
                  {loading ? '--' : dramaTotal}
                </div>
                <p className="mt-2 text-xs text-text-2">已创建的项目总数。</p>
              </div>
              <div className="rounded-[22px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-3">
                  进行中任务
                </div>
                <div className="text-3xl font-semibold text-text-0">
                  {loading ? '--' : runningCount}
                </div>
                <p className="mt-2 text-xs text-text-2">排队中和生成中任务。</p>
              </div>
              <div className="rounded-[22px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-3">
                  累计完成
                </div>
                <div className="text-3xl font-semibold text-text-0">
                  {loading ? '--' : completedCount}
                </div>
                <p className="mt-2 text-xs text-text-2">已完成任务总数。</p>
              </div>
            </div>

          </section>

          <aside>
            <div className="rounded-[18px] border border-border bg-bg-surface p-4 shadow-shadow-xs">
              <div className="mb-2 flex items-center gap-2">
                <UserRound size={16} className="text-accent" aria-hidden />
                <span className="text-sm font-semibold text-text-0">退出账号</span>
              </div>
              <Button asChild variant="ghost" className="w-full justify-start text-text-2 hover:text-text-0">
                <Link href="/logout">
                  <LogOut />
                  退出登录
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
