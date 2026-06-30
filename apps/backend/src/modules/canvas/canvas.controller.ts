import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CanvasService } from './canvas.service'
import { CanvasSaveService } from './canvas-save.service'

@ApiTags('canvas')
@Controller('canvases')
@UseGuards(SessionAuthGuard)
export class CanvasController {
  constructor(
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(CanvasSaveService) private readonly canvasSaveService: CanvasSaveService,
  ) {}

  // GET /canvases — 列表
  // 前端期望: { code:0, message:"ok", data: { data: CanvasSummary[], total: number } }
  @Get()
  async list(@CurrentUser() user: CurrentUserType) {
    const result = await this.canvasService.listCanvases(user.id)
    return { code: 0, message: 'ok', data: result }
  }

  // POST /canvases/init — 全局灵感板（幂等）
  // 前端期望: { code:0, message:"ok", data: CanvasSummary }
  @Post('init')
  async init(@CurrentUser() user: CurrentUserType) {
    const summary = await this.canvasService.initGlobalInspiration(user.id)
    return { code: 0, message: 'ok', data: summary }
  }

  // POST /canvases — 新建空白画布
  // 前端期望: { code:0, message:"ok", data: CanvasSummary }
  @Post()
  @HttpCode(201)
  async create(
    @Body() body: { title?: string; source?: string },
    @CurrentUser() user: CurrentUserType,
  ) {
    const summary = await this.canvasService.createCanvas(user.id, body?.title)
    return { code: 0, message: 'ok', data: summary }
  }

  // GET /canvases/:id — 详情
  // 前端期望: { code:0, message:"ok", data: CanvasDetail }
  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    const detail = await this.canvasService.getCanvas(id, user.id)
    return { code: 0, message: 'ok', data: detail }
  }

  // PATCH /canvases/:id — 更新标题/缩略图/viewport
  // 前端期望: { code:0, message:"ok", data: CanvasSummary }
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; thumbnail?: string; viewport?: { x?: number; y?: number; zoom?: number } },
    @CurrentUser() user: CurrentUserType,
  ) {
    const detail = await this.canvasService.updateCanvas(id, user.id, body)
    return { code: 0, message: 'ok', data: detail }
  }

  // DELETE /canvases/:id — 软删除
  // 前端期望: { code:0, message:"ok", data: { deleted_at: string } }
  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    const result = await this.canvasService.deleteCanvas(id, user.id)
    return { code: 0, message: 'ok', data: result }
  }

  // POST /canvases/:id/duplicate — 复制
  // 前端期望: { code:0, message:"ok", data: CanvasSummary }
  @Post(':id/duplicate')
  @HttpCode(201)
  async duplicate(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    const summary = await this.canvasService.duplicateCanvas(id, user.id)
    return { code: 0, message: 'ok', data: summary }
  }

  // POST /canvases/:id/save — 全量保存
  // 前端期望: { code:0, message:"ok", data: { saved_at: string, version_id: string } }
  @Post(':id/save')
  async save(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: CurrentUserType,
  ) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasSaveService.save(id, {
      nodes: (body.nodes as any[]) ?? [],
      edges: (body.edges as any[]) ?? [],
      viewport: body.viewport as { x: number; y: number; zoom: number } | undefined,
    })
    return { code: 0, message: 'ok', data: result }
  }
}
