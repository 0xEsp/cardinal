#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"

if [[ -z "$ARCHIVE" ]]; then
  echo "Uso: bash scripts/load-raspberry-image.sh <imagen.tar.gz>" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Error: no existe el archivo $ARCHIVE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está en PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Cargando imagen desde $ARCHIVE..."
docker load --input "$ARCHIVE"

echo "Arrancando Product OS sin reconstruir la imagen..."
docker compose up -d --no-build

echo
docker compose ps
