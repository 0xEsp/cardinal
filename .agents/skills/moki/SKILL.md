---
name: moki
description: Comprueba o reconfigura la conexión del Product OS con Moki, la herramienta de diseño alternativa a Paper. Úsala cuando el agente de diseño o la pestaña IA digan que Moki no está disponible, o cuando el usuario quiera diseñar cards en Moki.
---

# Moki para Gotty Product OS

Moki es una herramienta de diseño propia, **alternativa a Paper** (no la sustituye): cada card se diseña en una de las dos y queda ligada a ella. Corre como contenedor Docker (OrbStack) en el **Mac mini** `0xesp@manus-mac-mini` (`192.168.50.70`), siempre encendido, y expone su MCP por HTTP en `http://192.168.50.70:7410/mcp` con token (`Authorization: Bearer`). El Product OS de la Raspberry (`192.168.50.108:4400`) habla con él **directamente**: no hay puente que levantar.

Repositorio de Moki: `~/Documents/Personal/Moki` (despliegue en su `AGENTS.md` §9: `bash scripts/deploy/deploy.sh`). Repositorio del Product OS: `/Users/manuespeso/Documents/Trabajo/Gotty/gotty-product-os`.

## Diagnóstico

1. ¿Responde el servidor? `curl -s -o /dev/null -w "%{http_code}" http://192.168.50.70:7410/api/health` debe dar `200` (no exige token). Si no responde: `ssh 0xesp@manus-mac-mini 'docker ps --filter name=moki'` y `docker logs moki --tail 30`.
2. En el Product OS → pestaña **IA** → **Moki (diseño)**: URL `http://192.168.50.70:7410/mcp` (la IP, no `manus-mac-mini`: desde el contenedor los nombres de la red local pueden no resolverse), token y fichero *Gotty · Product Design* elegido. "↻ Comprobar" valida servidor, token (con una llamada MCP real) y que el fichero existe.
3. "Moki rechaza el token": el token de Moki cambió (p. ej. `setup-secrets.sh --rotate` en el repo de Moki). El valor vigente está en el Llavero del Mac: `security find-generic-password -s moki -a 0xesp@manus-mac-mini -w | pbcopy`, y se pega en la pestaña IA.
4. "El fichero elegido ya no existe": vuelve a elegir fichero en la pestaña IA.
5. Si Moki va lento o el agente falla con timeouts en ficheros muy grandes, revisa memoria: `ssh 0xesp@manus-mac-mini 'docker stats moki --no-stream'`. El límite está en `MOKI_MEM_LIMIT` del `deploy.local.env` de Moki.

## Reglas

- No muestres el token en mensajes salvo que el usuario lo pida para pegarlo.
- Los permisos por agente los decide el Product OS (`server/src/moki.js`): lectura para definir y revisar; escritura para diseñar con instancias de componentes existentes, pero sin crear componentes, ficheros, exportar ni tocar tokens.
- Lo que diferencia a Moki en los prompts (guía `moki-mcp-instructions`, `<x-moki-clone>`, instancias) está en `server/src/prompt.js` (`DESIGN_TOOL_NOTES`); las reglas comunes de diseño, en `os/agent-design.md` y `os/design-guide.md`.
- Una card con diseño en Paper no se puede pasar a Moki (ni al revés): habría que borrar su diseño y rediseñarla.
