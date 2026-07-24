import fs from 'node:fs'
import path from 'node:path'

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

const SKILL_ID_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

function resolveSkillsDir() {
  const candidates = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(process.cwd(), '../skills'),
    path.resolve(process.cwd(), '../../skills'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return candidates[candidates.length - 1]
}

function normalizeSkillId(raw: string | string[]) {
  const segments = Array.isArray(raw) ? raw : String(raw || '').split('/')
  const normalizedSegments = segments
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (!normalizedSegments.length || normalizedSegments.some((segment) => !SKILL_ID_SEGMENT_PATTERN.test(segment))) {
    throw new BadRequestException('Invalid skill id')
  }

  return normalizedSegments.join('/')
}

@Injectable()
export class SkillsService {
  listSkills() {
    const skills: { id: string; name: string; description: string }[] = []
    const skillsDir = resolveSkillsDir()

    if (!fs.existsSync(skillsDir)) {
      return skills
    }

    const scanDir = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(dir, entry.name)
        const skillPath = path.join(fullPath, 'SKILL.md')
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, 'utf-8')
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          const descMatch = content.match(/^description:\s*(.+)$/m)
          const id = prefix ? `${prefix}/${entry.name}` : entry.name
          skills.push({
            id,
            name: nameMatch ? nameMatch[1].trim() : entry.name,
            description: descMatch ? descMatch[1].trim() : '',
          })
        }
        scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
      }
    }

    scanDir(skillsDir)
    return skills
  }

  createSkill(body: Record<string, unknown>) {
    const id = normalizeSkillId(String(body.id || ''))
    const skillDir = path.join(resolveSkillsDir(), id)
    if (fs.existsSync(skillDir)) {
      throw new BadRequestException('Skill already exists')
    }

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : id
    const description = typeof body.description === 'string' ? body.description : ''

    fs.mkdirSync(skillDir, { recursive: true })
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nWrite your skill content here.\n`
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
    return { id, name, description }
  }

  getSkillContent(rawId: string[]) {
    const skillId = normalizeSkillId(rawId)
    const skillPath = path.join(resolveSkillsDir(), skillId, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      throw new NotFoundException('Skill not found')
    }
    return fs.readFileSync(skillPath, 'utf-8')
  }

  updateSkillContent(rawId: string[], content: string) {
    const skillId = normalizeSkillId(rawId)
    const skillDir = path.join(resolveSkillsDir(), skillId)
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true })
    }
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
  }

  deleteSkill(rawId: string[]) {
    const skillId = normalizeSkillId(rawId)
    const skillDir = path.join(resolveSkillsDir(), skillId)
    if (!fs.existsSync(skillDir)) {
      throw new NotFoundException('Skill not found')
    }
    fs.rmSync(skillDir, { recursive: true, force: true })
  }
}
