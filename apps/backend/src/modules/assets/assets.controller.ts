import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { toSnakeCaseWithPublicMedia } from '../../common/transform'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { AssetsService } from './assets.service'

const assetMediaFields = { urlFields: ['url', 'thumbnailUrl'] } as const

function parsePositiveId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

@ApiTags('assets')
@Controller('assets')
@UseGuards(SessionAuthGuard)
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assetsService: AssetsService) {}

  @Get()
  async listAssets(
    @Query('q') q: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('source_type') sourceType: string | undefined,
    @Query('drama_id') dramaIdValue: string | undefined,
    @Query('page') pageValue: string | undefined,
    @Query('page_size') pageSizeValue: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = Number(dramaIdValue || 0)
    const page = Math.max(1, Number(pageValue) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeValue) || 50))
    const rows = await this.assetsService.listOwnedAssets({
      userId: currentUser.id,
      q: String(q || '').trim() || undefined,
      kind: String(kind || '').trim() || undefined,
      sourceType: String(sourceType || '').trim() || undefined,
      dramaId: Number.isInteger(dramaId) && dramaId > 0 ? dramaId : undefined,
    })

    const total = rows.length
    const items = rows
      .slice((page - 1) * pageSize, page * pageSize)
      .map((row) => toSnakeCaseWithPublicMedia(row as unknown as Record<string, unknown>, assetMediaFields))

    return { items, total, page, page_size: pageSize }
  }

  @Get(':id')
  async getAsset(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const assetId = parsePositiveId(id, 'asset id')
    const asset = await this.assetsService.loadOwnedAsset(assetId, currentUser.id)
    if (!asset) {
      throw new NotFoundException('素材不存在')
    }

    return toSnakeCaseWithPublicMedia(asset as unknown as Record<string, unknown>, assetMediaFields)
  }

  @Post('from-task')
  @HttpCode(HttpStatus.CREATED)
  async createFromTask(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const taskId = typeof body.task_id === 'number' ? body.task_id : Number(body.task_id)
    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new BadRequestException('task_id invalid')
    }

    const asset = await this.assetsService.createAssetFromTask(currentUser.id, taskId)
    return toSnakeCaseWithPublicMedia(asset as unknown as Record<string, unknown>, assetMediaFields)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteAsset(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const assetId = parsePositiveId(id, 'asset id')
    await this.assetsService.deleteOwnedAsset(assetId, currentUser.id)
    return { success: true }
  }
}
