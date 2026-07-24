FROM node:22-slim AS base

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3010

FROM base AS manifests

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/canvas-shared/package.json packages/canvas-shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json

FROM manifests AS build-deps

RUN REDISMS_DISABLE_POSTINSTALL=true npm ci

FROM build-deps AS build

COPY apps/backend apps/backend
COPY packages/contracts packages/contracts

RUN npm run build --workspace packages/contracts \
  && npm run build --workspace apps/backend

FROM manifests AS prod-deps

ENV NODE_ENV=production

RUN REDISMS_DISABLE_POSTINSTALL=true npm ci --omit=dev --workspace apps/backend --include-workspace-root

FROM base AS runtime

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=prod-deps /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY skills ./skills

EXPOSE 3010

CMD ["npm", "run", "start", "--workspace", "apps/backend"]
