# packages/contracts

V2.0 的前后端共享契约包。

目标职责：

- 存放 OpenAPI 生成类型
- 存放共享 DTO / 枚举 / 轻量类型工具
- 作为 `web` / `admin` 对 `backend` 的唯一契约引用入口

当前约定：

- `apps/backend` 通过 `openapi:export` 导出 `openapi.json`
- `packages/contracts` 通过 `openapi-typescript` 生成 `src/generated.ts`
- 根脚本 `npm run build:contracts` 会串起导出、生成、构建三步

明确不放：

- 数据库连接
- 业务逻辑
- 鉴权逻辑
- 任何运行时真相源
