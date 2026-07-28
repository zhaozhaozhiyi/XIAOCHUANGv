import { describe, expect, it } from 'vitest'

import {
  buildHeuristicResult,
  ensureUsefulShots,
  normalizeResult,
} from './storyboard-from-text.handler'

const concept = '雨夜便利店里，女孩发现一张来自未来的照片'

describe('storyboard_from_text quality guard', () => {
  it('expands a one-line concept into three distinct narrative beats', () => {
    const result = buildHeuristicResult(concept)

    expect(result.shots).toHaveLength(3)
    expect(new Set(result.shots.map((shot) => shot.title)).size).toBe(3)
    expect(new Set(result.shots.map((shot) => shot.description)).size).toBe(3)
    expect(result.shots.map((shot) => shot.shotType)).toEqual(['全景', '中景', '特写'])
    expect(result.shots[0].description).toContain('关键线索尚未出现')
    expect(result.shots[1].description).toContain('发现一张来自未来的照片')
    expect(result.shots[2].description).toContain('女孩的即时反应')
    expect(result.characters.map((character) => character.name)).toContain('女孩')
    expect(result.scenes.map((scene) => scene.location)).toContain('便利店')
  })

  it('rewrites duplicated AI shots instead of passing copies to the canvas', () => {
    const shots = ensureUsefulShots([
      { title: '分镜 1', description: concept, duration: 4 },
      { title: '分镜 2', description: concept, duration: 4 },
      { title: '分镜 3', description: concept, duration: 4 },
    ], concept)

    expect(shots.map((shot) => shot.title)).toEqual(['环境建立', '关键动作', '悬念收束'])
    expect(new Set(shots.map((shot) => shot.description)).size).toBe(3)
  })

  it('pads an undersized AI response to the minimum shot count', () => {
    const result = normalizeResult({
      outline: concept,
      characters: [],
      scenes: [],
      shots: [{
        title: '发现照片',
        shotType: '中景',
        cameraMove: '固定',
        description: '女孩在便利店柜台旁发现一张陌生照片，迟疑地伸手拿起。',
        duration: 5,
      }],
    }, concept)

    expect(result.shots).toHaveLength(3)
    expect(result.shots[0].description).toContain('女孩在便利店柜台旁')
    expect(result.shots[1].description).toContain('发现一张来自未来的照片')
    expect(result.shots[2].description).toContain('女孩的即时反应')
  })

  it('preserves already useful and distinct AI descriptions', () => {
    const descriptions = [
      '雨幕中的便利店全景，冷白灯从玻璃门透出，女孩独自推门进入。',
      '女孩在收银台旁抽出一张照片，照片里的日期让她动作突然停住。',
      '照片日期与女孩震惊双眼交替特写，雨声中留下未解悬念。',
    ]
    const shots = ensureUsefulShots(descriptions.map((description, index) => ({
      title: ['雨夜入店', '发现照片', '未来日期'][index],
      description,
      duration: 4,
    })), concept)

    expect(shots.map((shot) => shot.description)).toEqual(descriptions)
  })

  it('recognizes common Chinese script scene headings', () => {
    const result = buildHeuristicResult(`【场景：竹屋院子/屋门口 日 外/内】\n少年推门而出。\n【场景】山间竹屋·土炕边\n老人缓缓睁眼。`)

    expect(result.scenes).toEqual(expect.arrayContaining([
      expect.objectContaining({ location: '竹屋院子/屋门口', time: '白天' }),
      expect.objectContaining({ location: '山间竹屋·土炕边' }),
    ]))
    expect(result.characters.map((character) => character.name)).not.toContain('【场景')
  })
})
