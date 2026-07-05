FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci \
  && npm run build --workspace apps/backend

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010

EXPOSE 3010

CMD ["npm", "run", "start", "--workspace", "apps/backend"]
