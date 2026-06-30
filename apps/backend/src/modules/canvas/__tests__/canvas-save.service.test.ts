import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { CanvasSaveService } from '../canvas-save.service'

function mockDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    transaction: vi.fn(),
  }
  chain.select.mockReturnValue(chain)
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.values.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.set.mockReturnValue(chain)
  chain.delete.mockReturnValue(chain)
  return chain
}

describe('CanvasSaveService', () => {
  let service: CanvasSaveService
  let db: ReturnType<typeof mockDb>

  beforeEach(() => {
    db = mockDb()

    // Mock transaction: 执行传入的回调
    db.transaction.mockImplementation(async (fn: any) => {
      const tx = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn(),
      }
      tx.update.mockReturnValue(tx)
      tx.set.mockReturnValue(tx)
      tx.where.mockReturnValue(tx)
      tx.insert.mockReturnValue(tx)
      tx.values.mockReturnValue(tx)
      tx.delete.mockReturnValue(tx)
      return fn(tx)
    })

    service = new CanvasSaveService({ db: db as any } as any)
  })

  // ═══════════════════════════════════════════════
  // 格式校验
  // ═══════════════════════════════════════════════

  it('拒绝非数组 nodes', async () => {
    await expect(service.save('cnv_1', { nodes: null as any, edges: [] }))
      .rejects.toThrow(BadRequestException)
  })

  it('拒绝非数组 edges', async () => {
    await expect(service.save('cnv_1', { nodes: [], edges: null as any }))
      .rejects.toThrow(BadRequestException)
  })

  it('拒绝超过 250 个节点', async () => {
    const nodes = Array.from({ length: 251 }, (_, i) => ({
      id: `node_${i}`, type: 'note', position: { x: i * 10, y: 0 },
    }))
    await expect(service.save('cnv_1', { nodes, edges: [] }))
      .rejects.toThrow(/too many nodes/i)
  })

  it('accepts exactly 250 nodes', async () => {
    const nodes = Array.from({ length: 250 }, (_, i) => ({
      id: `node_${i}`, type: 'note', position: { x: i * 10, y: 0 },
    }))
    // Should not throw (transaction will execute)
    const result = await service.save('cnv_1', { nodes, edges: [] })
    expect(result.saved_at).toBeTruthy()
  })

  it('拒绝缺少 id 的节点', async () => {
    await expect(service.save('cnv_1', {
      nodes: [{ type: 'note', position: { x: 0, y: 0 } }] as any,
      edges: [],
    })).rejects.toThrow(/node.id is required/i)
  })

  it('拒绝未知节点类型', async () => {
    await expect(service.save('cnv_1', {
      nodes: [{ id: 'n1', type: 'unknown_type', position: { x: 0, y: 0 } }],
      edges: [],
    })).rejects.toThrow(/unknown node type/i)
  })

  it('接受所有 10 种已知节点类型', async () => {
    const allTypes = [
      'storyboard', 'image', 'character', 'scene', 'note',
      'text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export',
    ]
    for (const type of allTypes) {
      db.transaction.mockClear()
      const result = await service.save('cnv_1', {
        nodes: [{ id: `n_${type}`, type, position: { x: 0, y: 0 } }],
        edges: [],
      })
      expect(result.saved_at).toBeTruthy()
    }
  })

  // ═══════════════════════════════════════════════
  // 连线校验
  // ═══════════════════════════════════════════════

  it('拒绝缺少 id 的连线', async () => {
    await expect(service.save('cnv_1', {
      nodes: [],
      edges: [{ source: 'a', target: 'b' }] as any,
    })).rejects.toThrow(/edge.id is required/i)
  })

  it('拒绝缺少 source 的连线', async () => {
    await expect(service.save('cnv_1', {
      nodes: [],
      edges: [{ id: 'e1', target: 'b' }] as any,
    })).rejects.toThrow(/edge source and target are required/i)
  })

  // ═══════════════════════════════════════════════
  // React Flow 格式转换
  // ═══════════════════════════════════════════════

  it('正确转换 React Flow 格式 → DB 格式（事务内）', async () => {
    let capturedNodes: any[] = []
    let capturedEdges: any[] = []

    // 捕获 insert 的 values
    db.transaction.mockImplementation(async (fn: any) => {
      const tx = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockImplementation((vals: any) => {
          // 当调用 values 时捕获
          return tx
        }),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn(),
      }
      tx.update.mockReturnValue(tx)
      tx.set.mockReturnValue(tx)
      tx.where.mockReturnValue(tx)
      tx.insert.mockImplementation((table: any) => {
        const origInsert = tx.insert
        return {
          values: (vals: any) => {
            // 根据表名区分 nodes vs edges（简化：第一个 insert 是 nodes，第二个是 edges）
            if (Array.isArray(vals) && vals.length > 0) {
              const first = vals[0]
              if (first.nodeDefId !== undefined) {
                capturedNodes = vals
              } else if (first.edgeKind !== undefined) {
                capturedEdges = vals
              }
            }
            return tx
          },
        }
      })
      tx.delete.mockReturnValue(tx)
      return fn(tx)
    })

    await service.save('cnv_1', {
      nodes: [
        { id: 'node_a', type: 'storyboard', position: { x: 120, y: 80 }, width: 240, height: 180,
          data: { shotIndex: 1, title: '开篇', duration: 5 } },
        { id: 'node_b', type: 'note', position: { x: 400, y: 100 },
          data: { text: 'hello', color: 'yellow' }, hidden: true },
      ],
      edges: [
        { id: 'edge_1', source: 'node_a', target: 'node_b',
          edge_kind: 'narrative', relation_type: 'solid' },
        { id: 'edge_2', source: 'node_b', target: 'node_a',
          edge_kind: 'dataflow', source_port: 'out:text', target_port: 'in:text' },
      ],
    })

    // 验证格式转换
    expect(capturedNodes).toHaveLength(2)
    expect(capturedNodes[0].id).toBe('node_a')
    expect(capturedNodes[0].nodeDefId).toBe('storyboard')
    expect(capturedNodes[0].positionX).toBe(120)
    expect(capturedNodes[0].positionY).toBe(80)
    expect(capturedNodes[0].dataJson).toBe(JSON.stringify({ shotIndex: 1, title: '开篇', duration: 5 }))
    expect(capturedNodes[0].isHidden).toBe(false)

    expect(capturedNodes[1].isHidden).toBe(true)

    expect(capturedEdges).toHaveLength(2)
    expect(capturedEdges[0].sourceNodeId).toBe('node_a') // source → sourceNodeId
    expect(capturedEdges[0].targetNodeId).toBe('node_b') // target → targetNodeId
    expect(capturedEdges[0].edgeKind).toBe('narrative')
    expect(capturedEdges[1].sourcePort).toBe('out:text')
  })

  // ═══════════════════════════════════════════════
  // 响应格式
  // ═══════════════════════════════════════════════

  it('返回 saved_at 和 version_id', async () => {
    const result = await service.save('cnv_1', { nodes: [], edges: [] })
    expect(result.saved_at).toBeTruthy()
    expect(typeof result.saved_at).toBe('string')
    expect('version_id' in result).toBe(true)
  })
})
