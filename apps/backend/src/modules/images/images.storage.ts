import sharp from 'sharp'

import { StorageService } from '../storage/storage.service'

export async function downloadFile(
  storageService: StorageService,
  url: string,
  subDir: string,
  options?: { headers?: Record<string, string> },
) {
  return storageService.downloadToStorage(url, subDir, options)
}

export function getAbsolutePath(storageService: StorageService, relativePath: string) {
  return storageService.getAbsolutePath(relativePath)
}

export async function saveUploadedFile(
  storageService: StorageService,
  buffer: Buffer,
  subDir: string,
  originalName: string,
  mimeType?: string | null,
) {
  return storageService.saveBuffer({
    buffer,
    subDir,
    fileName: originalName,
    mimeType: mimeType || null,
  })
}

export async function saveBase64Image(
  storageService: StorageService,
  base64Data: string,
  mimeType: string,
  subDir: string,
) {
  return storageService.saveBuffer({
    buffer: Buffer.from(base64Data, 'base64'),
    subDir,
    extension: mimeTypeToExt(mimeType),
    mimeType,
  })
}

export async function readImageAsCompressedDataUrl(
  storageService: StorageService,
  relativePath: string,
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
) {
  const filePath = await storageService.ensureLocalFile(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(filePath).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  return `data:image/jpeg;base64,${output.toString('base64')}`
}

export async function normalizeImageReferenceForAdapter(
  storageService: StorageService,
  value: string | null | undefined,
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
) {
  const raw = String(value || '').trim()
  if (!raw || raw.startsWith('data:image/')) return raw || null
  const shouldInline = storageService.isLocalStoragePath(raw)
    || raw.startsWith('http://')
    || raw.startsWith('https://')
  if (!shouldInline) return raw

  try {
    return await readImageAsCompressedDataUrl(storageService, raw, options)
  } catch {
    return storageService.isLocalStoragePath(raw) ? null : raw
  }
}

async function loadReferenceImageBuffer(storageService: StorageService, input: string) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('Missing reference image')
  }

  const parsed = parseDataUrl(raw)
  if (parsed) {
    return Buffer.from(parsed.data, 'base64')
  }

  const absolutePath = await storageService.ensureLocalFile(raw)
  return sharp(absolutePath).rotate().toBuffer()
}

export async function composeReferenceImagesDataUrl(
  storageService: StorageService,
  inputs: string[],
  options: { cellSize?: number; quality?: number } = {},
) {
  const refs = Array.from(new Set(inputs.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 4)
  if (refs.length === 0) return null
  if (refs.length === 1) {
    return normalizeImageReferenceForAdapter(storageService, refs[0], {
      maxWidth: options.cellSize ?? 768,
      maxHeight: options.cellSize ?? 768,
      quality: options.quality ?? 82,
    })
  }

  const cellSize = Math.max(256, options.cellSize ?? 768)
  const quality = options.quality ?? 82
  const cols = refs.length <= 2 ? refs.length : 2
  const rows = Math.ceil(refs.length / cols)
  const width = cols * cellSize
  const height = rows * cellSize

  const composites = await Promise.all(refs.map(async (ref, index) => {
    const buffer = await loadReferenceImageBuffer(storageService, ref)
    const left = (index % cols) * cellSize
    const top = Math.floor(index / cols) * cellSize
    const resized = await sharp(buffer)
      .resize({
        width: cellSize,
        height: cellSize,
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()

    return {
      input: resized,
      left,
      top,
    }
  }))

  const merged = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()

  return `data:image/jpeg;base64,${merged.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], data: match[2] }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}
