# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- This is a **Next.js App Router** application for **drama / script generation** with a pluggable **media pipeline** (image/video/TTS) and **Mastra agents**.
- `apps/web` is the user-facing frontend only. Business APIs, schema, auth, queue execution, and storage orchestration must stay in `apps/backend`.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Backend contract**: all business APIs are proxied to `apps/backend`
- **AI Agents**: Mastra (`@mastra/core`) with OpenAI-compatible providers
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **E2E Tests**: Playwright

## Development Commands

```bash
npm run dev          # Start dev server on port 3001
npm run dev:clean    # Clear dev cache then start
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test:e2e     # Run Playwright e2e tests
npm run test:e2e:ui  # Run Playwright with UI
npm run test:e2e:headed # Run Playwright headed
```

**Node 22 required** — scripts automatically enforce this via `scripts/run-with-node22.sh`.

**Dev vs Prod isolation**: `next dev` uses `.next-dev/`, production uses `.next-prod/`. Never share these directories between modes (causes CSS chunk/manifest conflicts).

## Environment & Local Data

- `BACKEND_BASE_URL` points to the unified backend service. Default: `http://127.0.0.1:3010`.
- Public media URLs should resolve directly to backend/object-storage origins via `NEXT_PUBLIC_MEDIA_BASE_URL` (or `NEXT_PUBLIC_BACKEND_BASE_URL/static` as local fallback); creation and upload requests should be handled by `apps/backend`.

## Architecture

### App Structure (`src/app/`)

- `(default)/` — User-facing pages (home, drama, create, settings, writing)
- `(studio)/` — Production studio pages (episode editing). Requires session auth via `requirePageSession`.
- `api/v1/` — Single catch-all proxy route for same-origin browser access to `apps/backend`
- `login/`, `register/` — Auth forms

### Server Layer (`src/server/`)

- `backend.ts` — minimal backend bridge for proxy fetch, session read, JSON wrapping, and cookie passthrough

### Auth Flow

User sessions are read from `apps/backend` via helpers in `backend.ts`. The `(studio)` route group enforces session via `requirePageSession()`.

### API Response Pattern

The `api/v1` catch-all uses helpers in `backend.ts` for request passthrough, JSON wrapping, and `set-cookie` forwarding.

## Common Workflows

### Add a new API endpoint

- Default to implementing business endpoints in `apps/backend`
- Add a thin proxy route in `src/app/api/v1/...` only when the browser needs a same-origin entry

## Code Conventions

- Path alias: `@/` maps to `src/`
- shadcn/ui components live in `@/components/ui`
- Global CSS in `src/app/globals.css` (not `src/styles/`)
- Use `lib/cn.ts` for `clsx` + `tailwind-merge` utility via `cn()` helper
- Keep `apps/web` free of direct database, schema, provider, and task-runner logic

## Testing & Debugging

- Prefer validating changes with the closest script:
  - `npm run lint`
  - `npm run test:e2e` (Playwright)
- If you see weird asset/CSS/runtime mismatches, re-check **Dev vs Prod isolation** and clear `.next-dev/` only for dev.
