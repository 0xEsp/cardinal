#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="0xEsp@192.168.50.108"
REMOTE_DIR="/home/0xEsp/justgame-product-os"
IMAGE_TAG="gotty-product-os:raspberry"
ARCHIVE="$ROOT_DIR/releases/gotty-product-os-$(date +%Y%m%d-%H%M%S).tar.gz"

OUTPUT_FILE="$ARCHIVE" bash "$ROOT_DIR/scripts/build-raspberry-image.sh" "$IMAGE_TAG"

# SSH/scp solicitan la contraseña o desbloqueo de clave cuando corresponda.
# No se almacenan credenciales ni se transfieren .env o data/.
ssh "$REMOTE" "test -d '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/releases' '$REMOTE_DIR/scripts'"
scp "$ARCHIVE" "$REMOTE:$REMOTE_DIR/releases/$(basename "$ARCHIVE")"
scp "$ROOT_DIR/docker-compose.yml" "$REMOTE:$REMOTE_DIR/docker-compose.yml"
scp "$ROOT_DIR/scripts/load-raspberry-image.sh" "$REMOTE:$REMOTE_DIR/scripts/load-raspberry-image.sh"
ssh "$REMOTE" "cd '$REMOTE_DIR' && bash scripts/load-raspberry-image.sh 'releases/$(basename "$ARCHIVE")'"
