# Multi-stage: compila el frontend y deja una imagen ligera con el server.
# Funciona en arm64 (Raspberry Pi 4/5) y amd64.

FROM node:22-alpine AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-alpine
# libgcc/libstdc++/ripgrep: los necesita el binario musl de Claude Code.
# Los CLIs de Codex y Claude NO se instalan aquí: el Product OS los instala y
# actualiza en el volumen de datos (data/cli) desde la pestaña IA, para tener
# modelos nuevos sin construir otra imagen.
RUN apk add --no-cache git openssh-client libgcc libstdc++ ripgrep
WORKDIR /app
# Sin workspace/ ni os/ (ver .dockerignore): docs y reglas viven en la SQLite.
COPY . .
RUN cd server && npm install --omit=dev
COPY --from=web-build /build/dist ./web/dist

EXPOSE 4400
CMD ["node", "server/src/index.js"]
