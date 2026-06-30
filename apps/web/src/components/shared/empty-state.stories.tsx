import type { Meta, StoryObj } from '@storybook/react'
import { Film, FolderOpen, Search } from 'lucide-react'
import { EmptyState } from './empty-state'

const meta = {
  title: 'Shared/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    icon: Film,
    description: '暂无短剧项目',
  },
}

export const WithAction: Story = {
  args: {
    icon: FolderOpen,
    description: '暂无素材，请先上传素材文件',
    actionLabel: '上传素材',
    onAction: () => alert('上传素材'),
  },
}

export const WithChildren: Story = {
  args: {
    icon: Search,
    description: '未找到匹配的内容',
    children: (
      <p className="text-xs text-text-3 mt-2">
        尝试使用其他关键词搜索
      </p>
    ),
  },
}