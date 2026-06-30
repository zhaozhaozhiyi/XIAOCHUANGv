FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci

WORKDIR /app/apps/web

ENV NODE_ENV=production
ENV PORT=3013

RUN npm run build

EXPOSE 3013

CMD ["npm", "run", "start", "--", "-p", "3013", "-H", "0.0.0.0"]
