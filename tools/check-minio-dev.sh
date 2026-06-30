#!/usr/bin/env bash
set -euo pipefail

MINIO_API_PORT="${MINIO_API_PORT:-9000}"
MINIO_BUCKET="${MINIO_BUCKET:-xiaochuang-media}"

curl -fsS "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live" >/dev/null

cat <<EOF
MinIO health check passed.

Use these env vars for object-storage verification:
  STORAGE_DRIVER=s3
  STORAGE_PUBLIC_BASE_URL=http://127.0.0.1:${MINIO_API_PORT}/${MINIO_BUCKET}
  S3_ENDPOINT=http://127.0.0.1:${MINIO_API_PORT}
  S3_REGION=us-east-1
  S3_BUCKET=${MINIO_BUCKET}
  S3_ACCESS_KEY_ID=minioadmin
  S3_SECRET_ACCESS_KEY=minioadmin123

Then run:
  npm run storage:smoke:object-storage --workspace apps/backend
  npm run audit:object-storage
EOF
