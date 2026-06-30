import type { Meta, StoryObj } from '@storybook/react'
import { Button, buttonVariants } from './button'
import { Plus, Trash2, ArrowRight } from 'lucide-react'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    children: 'Button',
    variant: 'default',
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="default">Default</Button>
      <Button variant="premium">Premium</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra Small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="default">
        <Plus size={15} />
        Create Project
      </Button>
      <Button variant="outline">
        <ArrowRight size={15} />
        Continue
      </Button>
      <Button variant="destructive">
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  ),
}

export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon">
        <Plus size={18} />
      </Button>
      <Button variant="ghost" size="icon-sm">
        <Trash2 size={15} />
      </Button>
      <Button variant="ghost" size="icon-xs">
        <ArrowRight size={12} />
      </Button>
    </div>
  ),
}

export const Loading: Story = {
  args: {
    children: 'Loading...',
    variant: 'default',
    disabled: true,
  },
  render: (args) => (
    <Button {...args} className="opacity-50 cursor-not-allowed">
      {args.children}
    </Button>
  ),
}