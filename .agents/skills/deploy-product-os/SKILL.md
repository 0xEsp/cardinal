---
name: deploy-product-os
description: Construye, transfiere y activa una nueva imagen Docker de Gotty Product OS en la Raspberry conservando la base de datos y el contenido persistente.
---

# Desplegar Product OS en la Raspberry

Cuando el usuario pida desplegar cambios de este proyecto, trabaja desde `/Users/manuespeso/Documents/Trabajo/Gotty/gotty-product-os`.

1. Revisa los cambios y ejecuta las comprobaciones pertinentes. No incluyas en el despliegue secretos, `.env`, `data/` ni SQLite.
2. Ejecuta `bash scripts/deploy-raspberry-image.sh`. Usa `scripts/build-raspberry-image.sh` para construir `linux/arm64`; el script de despliegue transfiere la imagen a `0xEsp@192.168.50.108` y llama a `scripts/load-raspberry-image.sh` en `/home/0xEsp/justgame-product-os`.
3. SSH o SCP solicitarán la contraseña o el desbloqueo de la clave cuando corresponda. Si no pueden solicitarla, pide al usuario que configure el acceso; no guardes credenciales en archivos, argumentos ni mensajes.
4. Comprueba mediante SSH `docker compose ps` y los logs recientes del servicio. Si el arranque falla, informa del error y conserva el backup de `releases/` para recuperar los datos.

`load-raspberry-image.sh` comprueba el volumen `/app/data`, detiene el contenedor, hace una copia del directorio de datos (desde un contenedor, porque `secrets/`, `codex/` y `claude/` pertenecen a root; excluye `cli/` y `agent-work/`) y recrea el servicio. No borres ni sustituyas el volumen. La documentación y las reglas se sincronizan por Git mediante Push/Pull, sin nueva imagen.

## Paper (diseño)

El despliegue no incluye nada de Paper: el diseño depende del **puente de Paper que corre en el Mac** (`scripts/paper-bridge/`, skill `paper-bridge`), no de la Raspberry. El puente no es un servicio: el usuario lo levanta a mano cuando quiere diseñar (`node scripts/paper-bridge/paper-bridge.mjs`) y lo cierra con Ctrl+C. Si tras desplegar quiere diseñar, comprueba en el Mac `node scripts/paper-bridge/paper-bridge.mjs status` y que la pestaña IA del Product OS muestre Paper como listo.
