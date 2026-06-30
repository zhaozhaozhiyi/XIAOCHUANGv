const HOME_CREATE_DRAFT_STORAGE_KEY = 'home-create-draft'

export interface HomeCreateDraft {
  title?: string
  style?: string
  source_task_id?: string | null
}

export function writeHomeCreateDraft(draft: HomeCreateDraft) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(HOME_CREATE_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {}
}

export function readHomeCreateDraft(): HomeCreateDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(HOME_CREATE_DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HomeCreateDraft
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function clearHomeCreateDraft() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(HOME_CREATE_DRAFT_STORAGE_KEY)
  } catch {}
}
