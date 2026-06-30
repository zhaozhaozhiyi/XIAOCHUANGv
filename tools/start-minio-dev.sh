#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MINIO_CONTAINER_NAME="${MINIO_CONTAINER_NAME:-xiaochuang-minio}"
MINIO_API_PORT="${MINIO_API_PORT:-9000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin123}"
MINIO_BUCKET="${MINIO_BUCKET:-xiaochuang-media}"
MINIO_DATA_DIR="${MINIO_DATA_DIR:-$ROOT_DIR/.local/minio-data}"

mkdir -p "$MINIO_DATA_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx "$MINIO_CONTAINER_NAME"; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$MINIO_CONTAINER_NAME"; then
    docker start "$MINIO_CONTAINER_NAME" >/dev/null
  fi
else
  docker run -d \
    --name "$MINIO_CONTAINER_NAME" \
    -p "${MINIO_API_PORT}:9000" \
    -p "${MINIO_CONSOLE_PORT}:9001" \
    -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
    -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
    -v "$MINIO_DATA_DIR:/data" \
    minio/minio server /data --console-address ":9001" >/dev/null
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live" >/dev/null

docker run --rm --entrypoint /bin/sh minio/mc -c "\
  mc alias set local http://host.docker.internal:${MINIO_API_PORT} ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD} >/dev/null && \
  mc mb --ignore-existing local/${MINIO_BUCKET} >/dev/null && \
  mc anonymous set download local/${MINIO_BUCKET} >/dev/null"

cat <<EOF
MinIO dev is ready.

API:      http://127.0.0.1:${MINIO_API_PORT}
Console:  http://127.0.0.1:${MINIO_CONSOLE_PORT}
Bucket:   ${MINIO_BUCKET}

Recommended backend env:
  STORAGE_DRIVER=s3
  STORAGE_PUBLIC_BASE_URL=http://127.0.0.1:${MINIO_API_PORT}/${MINIO_BUCKET}
  S3_ENDPOINT=http://127.0.0.1:${MINIO_API_PORT}
  S3_REGION=us-east-1
  S3_BUCKET=${MINIO_BUCKET}
  S3_ACCESS_KEY_ID=${MINIO_ROOT_USER}
  S3_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
EOF
