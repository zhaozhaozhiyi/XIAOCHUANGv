import type { Preview } from '@storybook/react'
import '../src/app/globals.css'
import { initialize, mswDecorator } from 'msw-storybook-addon'

initialize()

const preview: Preview = {
  decorators: [mswDecorator],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview