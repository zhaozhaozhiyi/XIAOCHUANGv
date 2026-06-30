declare module 'pg' {
  export type QueryResult<Row = unknown> = {
    rows: Row[]
    rowCount: number | null
  }

  export type QueryResultRow = Record<string, unknown>

  export type PoolConfig = {
    connectionString?: string
    max?: number
    idleTimeoutMillis?: number
    connectionTimeoutMillis?: number
  }

  export class Pool {
    constructor(config?: PoolConfig)
    query<Row extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<Row>>
    on(event: 'error', listener: (error: Error) => void): this
    end(): Promise<void>
  }
}

declare module 'ws' {
  import type { ClientRequestArgs } from 'node:http'

  type WebSocketEvent = 'open' | 'message' | 'error' | 'close'

  class WebSocket {
    static readonly OPEN: number
    static readonly CLOSED: number

    constructor(address: string, options?: ClientRequestArgs)
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: WebSocket.RawData) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    on(event: WebSocketEvent, listener: (...args: unknown[]) => void): this
    send(data: string | Buffer | ArrayBuffer | Buffer[]): void
    close(): void
  }

  namespace WebSocket {
    type RawData = Buffer | ArrayBuffer | Buffer[]
  }

  export = WebSocket
}
