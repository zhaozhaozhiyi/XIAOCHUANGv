export type StorageWriteResult = {
  key: string
  url: string
  mimeType: string | null
  size: number
}

export type StorageDownloadResult = {
  key: string
  url: string
  mimeType: string | null
  size: number
}

export type StorageSaveBufferParams = {
  buffer: Buffer
  subDir: string
  fileName?: string | null
  extension?: string | null
  mimeType?: string | null
}
