'use client'

import dynamic from 'next/dynamic'

import QuickCreateVideoLoading from './loading'

const QuickCreateVideoPageClient = dynamic(
  () => import('@/components/create/quick-create-video-page-client'),
  {
    ssr: false,
    loading: () => <QuickCreateVideoLoading />,
  },
)

export default function CreateVideoPage() {
  return <QuickCreateVideoPageClient />
}
