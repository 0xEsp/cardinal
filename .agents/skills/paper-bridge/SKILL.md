---
name: paper-bridge
description: Comprueba, levanta o reconfigura el puente MCP de Paper que permite al Product OS de la Raspberry consultar y pintar diseños en Paper. Úsala cuando el agente de diseño o la pestaña IA digan que Paper no está disponible, o cuando el usuario quiera diseñar cards.
---

# Puente de Paper para Gotty Product OS

El MCP de Paper **solo existe en el Mac donde está abierta la app de Paper**: `~/.paper/bin/paper mcp` es un relay stdio hacia la app (`127.0.0.1:29979`). El Product OS corre en la Raspberry (`192.168.50.108:4400`), así que necesita el **puente** de `scripts/paper-bridge/paper-bridge.mjs` en el Mac, que expone ese MCP por HTTP en la red local (puerto 4410, token obligatorio).

El puente **no es un servicio**: es un proceso de Node en primer plano que el usuario levanta cuando quiere diseñar y cierra con Ctrl+C. Mientras está cerrado (o el Mac apagado, o Paper cerrado):
- El agente de **diseño** no puede lanzarse (error "Paper no está disponible").
- El agente de **definición** sigue funcionando, pero sin consultar diseños.

Repositorio: `/Users/manuespeso/Documents/Trabajo/Gotty/gotty-product-os`. Ejecuta los comandos desde ahí y en el Mac (no en la Raspberry).

## Comandos

- `node scripts/paper-bridge/paper-bridge.mjs` → levanta el puente en primer plano y muestra URL, token y si Paper está abierto. Ciérralo con Ctrl+C. Si el usuario te pide levantarlo, hazlo en una terminal visible para él (no en segundo plano oculto) para que pueda cerrarlo cuando quiera.
- `node scripts/paper-bridge/paper-bridge.mjs status` → ¿está levantado? ¿Paper está abierto?
- `node scripts/paper-bridge/paper-bridge.mjs token` → URL y token para la pestaña IA.
- `node scripts/paper-bridge/paper-bridge.mjs rotate-token` → token nuevo (hay que pegarlo otra vez en la pestaña IA y reiniciar el puente).
- `PAPER_BRIDGE_PORT=<puerto>` cambia el puerto (por defecto 4410).

## Diagnóstico

1. `… status`. Si no está levantado, ofrece levantarlo (no lo dejes corriendo sin que el usuario lo sepa).
2. Si Paper aparece cerrado: pide al usuario que abra la app de Paper (no la abras sin preguntar).
3. Si dice que el puerto está en uso al levantarlo, ya hay un puente corriendo en otra terminal.
4. En el Product OS → pestaña **IA** → **Paper (diseño)**: la URL debe ser `http://<ip-del-mac>:4410/mcp`, el token el de `… token` y debe haber un fichero elegido (*Gotty · Product Design*). "↻ Comprobar" refresca el estado.

## Reglas

- No muestres el token en mensajes salvo que el usuario lo pida para pegarlo; vive en `~/.config/gotty-paper-bridge/token` (0600) y se reutiliza en cada arranque.
- Si la IP del Mac cambia, hay que actualizar la URL en la pestaña IA (recomienda reservar la IP en el router).
- El puente no da acceso a nada más que a Paper. Los permisos por agente los decide el Product OS (`server/src/paper.js`: lectura para definir/revisar; escritura sin crear ficheros, exportar ni tocar tokens para diseñar).
- Las reglas de diseño están en `os/agent-design.md` y `os/design-guide.md`.
