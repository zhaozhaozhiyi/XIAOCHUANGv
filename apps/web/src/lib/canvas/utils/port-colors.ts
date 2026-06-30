import type { PortType } from '@xiaochuang/canvas-shared'

/** Port / edge colors as CSS variables — follow light/dark via canvas-theme.css */
export const PORT_COLOR_VARS: Record<PortType, string> = {
  text: 'var(--canvas-port-text)',
  image: 'var(--canvas-port-image)',
  video: 'var(--canvas-port-video)',
  audio: 'var(--canvas-port-audio)',
  character: 'var(--canvas-port-character)',
  scene: 'var(--canvas-port-scene)',
  storyboard: 'var(--canvas-port-storyboard)',
}

export function getPortColor(type: PortType): string {
  return PORT_COLOR_VARS[type]
}
