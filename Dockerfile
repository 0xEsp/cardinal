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
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY server/ ./server/
COPY os/ ./os/
COPY --from=web-build /build/dist ./web/dist

EXPOSE 4400
CMD ["node", "server/src/index.js"]
