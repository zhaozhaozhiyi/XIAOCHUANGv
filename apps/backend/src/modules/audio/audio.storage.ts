import { StorageService } from '../storage/storage.service'

export async function saveBufferFile(
  storageService: StorageService,
  buffer: Buffer,
  subDir: string,
  extension: string,
  mimeType?: string | null,
) {
  return storageService.saveBuffer({
    buffer,
    subDir,
    extension,
    mimeType: mimeType || null,
  })
}
