#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/arm64}"
IMAGE_TAG="${1:-cardinal:raspberry}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está en PATH." >&2
  exit 1
fi

SAFE_TAG="${IMAGE_TAG//\//-}"
SAFE_TAG="${SAFE_TAG//:/-}"
OUTPUT_DIR="$ROOT_DIR/releases"
OUTPUT_FILE="${OUTPUT_FILE:-$OUTPUT_DIR/${SAFE_TAG}-$(date +%Y%m%d-%H%M%S).tar.gz}"

mkdir -p "$OUTPUT_DIR"

echo "Construyendo $IMAGE_TAG para $TARGET_PLATFORM..."
docker buildx build \
  --platform "$TARGET_PLATFORM" \
  --tag "$IMAGE_TAG" \
  --load \
  "$ROOT_DIR"

echo "Exportando imagen a $OUTPUT_FILE..."
docker save "$IMAGE_TAG" | gzip > "$OUTPUT_FILE"

echo
echo "Imagen lista: $IMAGE_TAG"
echo "Archivo listo para transferir: $OUTPUT_FILE"
echo "En la Raspberry: bash scripts/load-raspberry-image.sh <archivo.tar.gz>"
