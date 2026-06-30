import type { Meta, StoryObj } from '@storybook/react'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
  title: 'Shared/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = require('react').useState(false)
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 bg-accent text-white rounded-lg"
        >
          Open Dialog
        </button>
        <ConfirmDialog {...args} open={open} onOpenChange={setOpen} />
      </>
    )
  },
  args: {
    title: '删除项目',
    description: '确定删除「示例项目」？此操作不可恢复。',
    confirmLabel: '删除',
    cancelLabel: '取消',
    onConfirm: () => new Promise((resolve) => setTimeout(resolve, 1000)),
  },
}

export const Loading: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = require('react').useState(false)
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 bg-accent text-white rounded-lg"
        >
          Open Dialog
        </button>
        <ConfirmDialog {...args} open={open} onOpenChange={setOpen} />
      </>
    )
  },
  args: {
    title: '确认操作',
    description: '是否继续执行此操作？',
    confirmLabel: '确认',
    cancelLabel: '取消',
    loading: true,
    onConfirm: () => new Promise((resolve) => setTimeout(resolve, 2000)),
  },
}