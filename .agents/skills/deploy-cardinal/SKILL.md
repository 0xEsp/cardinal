---
name: deploy-cardinal
description: Construye, transfiere y activa una nueva imagen Docker de Cardinal en la Raspberry conservando la base de datos y el contenido persistente.
---

# Desplegar Cardinal en la Raspberry

Cuando el usuario pida desplegar cambios de este proyecto, trabaja desde `/Users/manuespeso/Documents/Personal/cardinal`.

1. Revisa los cambios y ejecuta las comprobaciones pertinentes. No incluyas en el despliegue secretos, `.env`, `data/` ni SQLite.
2. Ejecuta `bash scripts/deploy-raspberry-image.sh`. Usa `scripts/build-raspberry-image.sh` para construir `linux/arm64`; el script de despliegue transfiere la imagen a `0xEsp@192.168.50.108` y llama a `scripts/load-raspberry-image.sh` en `/home/0xEsp/justgame-product-os`.
3. SSH o SCP solicitarán la contraseña o el desbloqueo de la clave cuando corresponda. Si no pueden solicitarla, pide al usuario que configure el acceso; no guardes credenciales en archivos, argumentos ni mensajes.
4. Comprueba mediante SSH `docker compose ps` y los logs recientes del servicio. Si el arranque falla, informa del error y conserva el backup de `releases/` para recuperar los datos.

`load-raspberry-image.sh` comprueba el volumen `/app/data`, detiene el contenedor, hace una copia del directorio de datos (desde un contenedor, porque `secrets/`, `codex/` y `claude/` pertenecen a root; excluye `cli/` y `agent-work/`), **ensaya las migraciones de la base con la imagen nueva sobre una copia** (`node server/src/migrate-cli.js --dry-run`) y solo si el ensayo pasa cambia de imagen y recrea el servicio. Si el ensayo falla, la imagen anterior sigue activa: informa del error del ensayo tal cual. No borres ni sustituyas el volumen.

Docs y reglas viven en la SQLite (tablas `documents` y `document_versions`), versionadas dentro de Cardinal: ya no se sincronizan por Git. La migración v1 los importó una única vez desde `workspace/docs/` y `os/` del checkout de la Raspberry, que se montan en solo lectura para eso; no los borres hasta confirmar que todo está bien. Antes de cada migración el servidor deja una copia `data/backups/product-os-pre-vN-<fecha>.db`.

## Paper (diseño)

El despliegue no incluye nada de Paper: el diseño depende del **puente de Paper que corre en el Mac** (`scripts/paper-bridge/`, skill `paper-bridge`), no de la Raspberry. El puente no es un servicio: el usuario lo levanta a mano cuando quiere diseñar (`node scripts/paper-bridge/paper-bridge.mjs`) y lo cierra con Ctrl+C. Si tras desplegar quiere diseñar, comprueba en el Mac `node scripts/paper-bridge/paper-bridge.mjs status` y que la pestaña IA del Product OS muestre Paper como listo.
