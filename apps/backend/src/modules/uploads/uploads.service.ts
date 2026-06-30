import path from 'node:path'

import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

import { saveUploadedFile } from '../images/images.storage'
import { StorageService } from '../storage/storage.service'

const MULTIPART_OVERHEAD_BYTES = 512 * 1024
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024

type ParsedMultipartFile = {
  fieldName: string
  fileName: string
  mimeType: string
  buffer: Buffer
}

function sanitizeFilename(rawName: string) {
  const normalized = path.basename(String(rawName || '').trim())
  const safeName = normalized.replace(/[^a-zA-Z0-9._() -]/g, '_')
  return safeName || 'upload.bin'
}

function extractBoundary(contentType: string) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  return (match?.[1] || match?.[2] || '').trim()
}

function extractDispositionValue(source: string, key: string) {
  const match = source.match(new RegExp(`${key}="([^"]*)"`, 'i'))
  return match?.[1] || ''
}

@Injectable()
export class UploadsService {
  constructor(@Inject(StorageService) private readonly storageService: StorageService) {}

  async uploadImage(request: FastifyRequest) {
    const file = this.parseSingleFileRequest(request, {
      fieldName: 'file',
      maxBytes: MAX_IMAGE_UPLOAD_BYTES,
      mimePrefix: 'image/',
    })

    const savedFile = await saveUploadedFile(
      this.storageService,
      file.buffer,
      'uploads',
      file.fileName,
      file.mimeType,
    )
    return {
      url: savedFile.url,
      storage_key: savedFile.key,
    }
  }

  private parseSingleFileRequest(
    request: FastifyRequest,
    options: {
      fieldName: string
      maxBytes: number
      mimePrefix: string
    },
  ): ParsedMultipartFile {
    const body = request.body
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('仅支持 multipart/form-data 上传')
    }

    if (body.byteLength > options.maxBytes + MULTIPART_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException('图片大小不能超过 20MB')
    }

    const boundary = extractBoundary(String(request.headers['content-type'] || ''))
    if (!boundary) {
      throw new BadRequestException('上传数据缺少 boundary')
    }

    const files = this.parseMultipartBody(body, boundary)
    const file = files.find((item) => item.fieldName === options.fieldName)
    if (!file) {
      throw new BadRequestException('file is required')
    }

    if (!file.mimeType.startsWith(options.mimePrefix)) {
      throw new BadRequestException('仅支持图片文件上传')
    }

    if (file.buffer.byteLength > options.maxBytes) {
      throw new PayloadTooLargeException('图片大小不能超过 20MB')
    }

    return file
  }

  private parseMultipartBody(body: Buffer, boundary: string): ParsedMultipartFile[] {
    const bodyText = body.toString('latin1')
    const segments = bodyText.split(`--${boundary}`).slice(1, -1)
    const files: ParsedMultipartFile[] = []

    for (let segment of segments) {
      if (segment.startsWith('\r\n')) {
        segment = segment.slice(2)
      }
      if (segment.endsWith('\r\n')) {
        segment = segment.slice(0, -2)
      }
      if (!segment) continue

      const headerEnd = segment.indexOf('\r\n\r\n')
      if (headerEnd < 0) continue

      const headerText = segment.slice(0, headerEnd)
      const payloadText = segment.slice(headerEnd + 4)
      const headerLines = headerText.split('\r\n')
      const disposition = headerLines.find((line) => line.toLowerCase().startsWith('content-disposition:'))
      if (!disposition) continue

      const fieldName = extractDispositionValue(disposition, 'name')
      const fileName = sanitizeFilename(extractDispositionValue(disposition, 'filename'))
      const contentTypeHeader = headerLines.find((line) => line.toLowerCase().startsWith('content-type:'))
      const mimeType = contentTypeHeader
        ? contentTypeHeader.slice(contentTypeHeader.indexOf(':') + 1).trim()
        : 'application/octet-stream'

      if (!fieldName || !fileName) continue

      files.push({
        fieldName,
        fileName,
        mimeType,
        buffer: Buffer.from(payloadText, 'latin1'),
      })
    }

    return files
  }
}
