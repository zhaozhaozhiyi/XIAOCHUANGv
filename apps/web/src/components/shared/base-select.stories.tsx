import type { Meta, StoryObj } from '@storybook/react'
import { BaseSelect, type SelectOption } from './base-select'

const meta = {
  title: 'Shared/BaseSelect',
  component: BaseSelect,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof BaseSelect>

export default meta
type Story = StoryObj<typeof meta>

const styleOptions: SelectOption[] = [
  { label: '古风仙侠', value: 'xianxia', group: '风格' },
  { label: '都市情感', value: 'urban', group: '风格' },
  { label: '悬疑惊悚', value: 'thriller', group: '风格' },
  { label: '青春校园', value: 'campus', group: '风格' },
  { label: '科幻未来', value: 'scifi', group: '风格' },
  { label: '玄幻奇幻', value: 'fantasy', group: '风格' },
]

export const Default: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = require('react').useState('')
    return (
      <div className="w-64">
        <BaseSelect {...args} value={value} onValueChange={setValue} />
      </div>
    )
  },
  args: {
    options: styleOptions,
    placeholder: '选择视觉风格',
    searchable: true,
  },
}

export const WithGroups: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = require('react').useState('')
    return (
      <div className="w-64">
        <BaseSelect {...args} value={value} onValueChange={setValue} />
      </div>
    )
  },
  args: {
    options: [
      { label: '古风仙侠', value: 'xianxia' },
      { label: '都市情感', value: 'urban' },
      { label: '悬疑惊悚', value: 'thriller' },
      { label: '青春校园', value: 'campus' },
      { label: '科幻未来', value: 'scifi' },
      { label: '玄幻奇幻', value: 'fantasy' },
      { label: '甜宠爱情', value: 'romance' },
      { label: '热血逆袭', value: 'rebirth' },
    ],
    placeholder: '选择风格',
    searchable: true,
  },
}

export const NonSearchable: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = require('react').useState('')
    return (
      <div className="w-64">
        <BaseSelect {...args} value={value} onValueChange={setValue} />
      </div>
    )
  },
  args: {
    options: [
      { label: '古风仙侠', value: 'xianxia' },
      { label: '都市情感', value: 'urban' },
      { label: '悬疑惊悚', value: 'thriller' },
    ],
    placeholder: '选择风格（不可搜索）',
    searchable: false,
  },
}