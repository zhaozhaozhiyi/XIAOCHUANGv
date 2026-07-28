import { describe, expect, it } from 'vitest'

import { buildStoryboardMoviePipeline } from '../canvas-run.service'

describe('buildStoryboardMoviePipeline', () => {
  it('builds an ordered image-to-video, concat and export chain from storyboard images', () => {
    const pipeline = buildStoryboardMoviePipeline('cnv_1', [
      {
        id: 'shot_3', label: '悬念收束', shotIndex: 3, positionX: 0, positionY: 0,
        dataJson: JSON.stringify({ images: ['https://example.com/3.jpg'], duration: 4 }),
      },
      {
        id: 'shot_1', label: '环境建立', shotIndex: 1, positionX: 0, positionY: 800,
        dataJson: JSON.stringify({ images: ['https://example.com/1.jpg'], duration: 5 }),
      },
      {
        id: 'shot_2', label: '关键动作', shotIndex: 2, positionX: 0, positionY: 400,
        dataJson: JSON.stringify({ images: ['https://example.com/2.jpg'], duration: 6 }),
      },
    ])

    expect(pipeline).not.toBeNull()
    expect(pipeline?.shotNodeIds).toEqual(['shot_1', 'shot_2', 'shot_3'])
    expect(pipeline?.executeNodes.map((node) => node.nodeDefId)).toEqual([
      'image-to-video', 'image-to-video', 'image-to-video', 'concat', 'export',
    ])
    expect(pipeline?.nodes.some((node) => node.nodeDefId === 'video-asset' && !node.isHidden)).toBe(true)
    expect(pipeline?.edges).toHaveLength(8)
  })

  it('requires at least one storyboard image', () => {
    expect(buildStoryboardMoviePipeline('cnv_1', [{
      id: 'shot_1', label: '空镜头', shotIndex: 1, positionX: 0, positionY: 0, dataJson: '{}',
    }])).toBeNull()
  })

  it('reuses completed storyboard videos and only schedules concat and export', () => {
    const pipeline = buildStoryboardMoviePipeline('cnv_1', [
      {
        id: 'shot_2', label: '收束', shotIndex: 2, positionX: 0, positionY: 300,
        dataJson: JSON.stringify({ images: ['https://example.com/2.jpg'], videoUrl: 'https://example.com/2.mp4' }),
      },
      {
        id: 'shot_1', label: '开场', shotIndex: 1, positionX: 0, positionY: 0,
        dataJson: JSON.stringify({ images: ['https://example.com/1.jpg'], videoUrl: 'https://example.com/1.mp4' }),
      },
    ])

    expect(pipeline?.executeNodes.map((node) => node.nodeDefId)).toEqual(['concat', 'export'])
    expect(JSON.parse(pipeline?.executeNodes[0].dataJson ?? '{}').videoUrls).toEqual([
      'https://example.com/1.mp4',
      'https://example.com/2.mp4',
    ])
    expect(pipeline?.edges).toHaveLength(2)
  })

  it('regenerates only missing videos and preserves mixed source order for concat', () => {
    const pipeline = buildStoryboardMoviePipeline('cnv_1', [
      {
        id: 'shot_1', label: '开场', shotIndex: 1, positionX: 0, positionY: 0,
        dataJson: JSON.stringify({ images: ['https://example.com/1.jpg'], videoUrl: 'https://example.com/1.mp4' }),
      },
      {
        id: 'shot_2', label: '动作', shotIndex: 2, positionX: 0, positionY: 300,
        dataJson: JSON.stringify({ images: ['https://example.com/2.jpg'], shotDescription: '角色挥剑攻击' }),
      },
      {
        id: 'shot_3', label: '收束', shotIndex: 3, positionX: 0, positionY: 600,
        dataJson: JSON.stringify({ images: ['https://example.com/3.jpg'], videoUrl: 'https://example.com/3.mp4' }),
      },
    ])

    expect(pipeline?.executeNodes.map((node) => node.nodeDefId)).toEqual([
      'image-to-video', 'concat', 'export',
    ])
    const videoNode = pipeline?.executeNodes[0]
    const concatParams = JSON.parse(pipeline?.executeNodes[1].dataJson ?? '{}')
    expect(JSON.parse(videoNode?.dataJson ?? '{}')).toMatchObject({ sequence: 2, sourceStoryboardId: 'shot_2' })
    expect(JSON.parse(videoNode?.dataJson ?? '{}').prompt).toContain('动作缓慢克制')
    expect(JSON.parse(videoNode?.dataJson ?? '{}').prompt).not.toContain('挥剑攻击')
    expect(concatParams).toEqual({
      videoSources: [
        { url: 'https://example.com/1.mp4' },
        { nodeId: videoNode?.id },
        { url: 'https://example.com/3.mp4' },
      ],
      expectedVideoCount: 3,
    })
    expect(pipeline?.edges).toHaveLength(4)
  })
})
