---
name: moki
description: Comprueba o reconfigura la conexión de Cardinal con Moki, la herramienta de diseño alternativa a Paper. Úsala cuando el agente de diseño o la pantalla IA y diseño digan que Moki no está disponible, o cuando el usuario quiera diseñar cards en Moki.
---

# Moki para Cardinal

Moki es una herramienta de diseño propia, **alternativa a Paper** (no la sustituye): cada card se diseña en una de las dos y queda ligada a ella. Corre como contenedor Docker (OrbStack) en el **Mac mini** `0xesp@manus-mac-mini.local` (`192.168.50.116`, reservada en el router ASUS por la MAC wifi `82:d8:41:29:f9:50`), siempre encendido, y expone su MCP por HTTP en `http://192.168.50.116:7410/mcp` con token (`Authorization: Bearer`). Cardinal, en la Raspberry (`192.168.50.108:4400`), habla con él **directamente**: no hay puente que levantar.

Repositorio de Moki: `~/Documents/Personal/Moki` (despliegue en su `AGENTS.md` §9: `bash scripts/deploy/deploy.sh`). Repositorio de Cardinal: `/Users/manuespeso/Documents/Personal/cardinal`.

## Diagnóstico

1. ¿Responde el servidor? `curl -s -o /dev/null -w "%{http_code}" http://192.168.50.116:7410/api/health` debe dar `200` (no exige token). Si no responde: `ssh 0xesp@manus-mac-mini.local 'docker ps --filter name=moki'` y `docker logs moki --tail 30`.
2. En Cardinal → **IA y diseño** → **Moki (diseño)**: URL `http://192.168.50.116:7410/mcp` (la IP, no `manus-mac-mini.local`: desde el contenedor los nombres `.local` no se resuelven) y token. "↻ Comprobar" valida servidor y token (con una llamada MCP real). El **fichero de diseño es de cada proyecto**: se elige en **Ajustes del proyecto → Diseño**.
3. "Moki rechaza el token": el token de Moki cambió (p. ej. `setup-secrets.sh --rotate` en el repo de Moki). El valor vigente está en el Llavero del Mac: `security find-generic-password -s moki -a 0xesp@manus-mac-mini -w | pbcopy`, y se pega en IA y diseño.
4. "El fichero elegido ya no existe" o "Elige el fichero de diseño del proyecto": elige fichero en Ajustes del proyecto → Diseño.
5. Si Moki va lento o el agente falla con timeouts en ficheros muy grandes, revisa memoria: `ssh 0xesp@manus-mac-mini.local 'docker stats moki --no-stream'`. El límite está en `MOKI_MEM_LIMIT` del `deploy.local.env` de Moki.

## Reglas

- No muestres el token en mensajes salvo que el usuario lo pida para pegarlo.
- Los permisos por agente los decide Cardinal (`server/src/moki.js`): lectura para definir y revisar; escritura para diseñar siempre con instancias de componentes (y crear componentes nuevos solo como borrador en la página de la card), sin desvincular instancias, crear ficheros, exportar ni tocar tokens.
- Lo que diferencia a Moki en los prompts (guía `moki-mcp-instructions`, instancias obligatorias, componentes nuevos en la página de la card) está en `server/src/prompt.js` (`DESIGN_TOOL_NOTES`); las reglas comunes de diseño, en `os/agent-design.md` y `os/design-guide.md`.
- Una card con diseño en Paper no se puede pasar a Moki (ni al revés): habría que borrar su diseño y rediseñarla.
