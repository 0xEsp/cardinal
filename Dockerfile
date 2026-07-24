# Multi-stage: compila el frontend y deja una imagen ligera con el server.
# Funciona en arm64 (Raspberry Pi 4/5) y amd64.

FROM node:22-alpine AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache git openssh-client
WORKDIR /app
# Copia el árbol completo del repo (ver .dockerignore): así el .git montado en
# runtime ve un working tree coherente y pull/push/status funcionan.
COPY . .
RUN cd server && npm install --omit=dev
COPY --from=web-build /build/dist ./web/dist
# El .git montado pertenece al usuario del host; sin esto git lo rechaza
RUN git config --global --add safe.directory /app

EXPOSE 4400
CMD ["node", "server/src/index.js"]
