# XIAOCHUANG Admin

管理后台已按 V2.0 方向切换为 **纯前端应用**，业务数据与认证统一走 `apps/backend`。

## 环境变量

```bash
cp .env.example .env.local
```

关键变量：

- `BACKEND_BASE_URL`：统一后端地址，默认 `http://127.0.0.1:3010`

## Getting Started

先启动统一后端：

```bash
npm run dev:backend
```

再启动管理后台：

```bash
npm run dev
```

打开 [http://localhost:3002](http://localhost:3002)。

## 当前边界

- 管理后台页面不再直接读写数据库
- 管理后台不再维护独立业务 schema
- 登录、会话、用户列表、仪表盘等能力通过 `apps/backend` 提供
- 不应继续在 `apps/admin` 新增本地 db/auth/schema 逻辑

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
