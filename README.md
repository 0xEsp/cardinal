# Cardinal

**Cardinal** es un sistema de producto con agentes de IA para varios proyectos. Cada proyecto tiene un board de cards, una documentación de producto viva y unas reglas con las que trabajan sus agentes. Los agentes de Cardinal convierten tu borrador en una definición completa, la diseñan en Moki o Paper y, cuando la funcionalidad está construida, actualizan la documentación. Tus propios agentes (Claude Code, Codex, Cursor…) leen y escriben todo eso por **MCP**.

Corre como un único contenedor (Node + SQLite) pensado para una Raspberry en tu red local, y se usa desde el navegador del ordenador o del móvil.

```
borrador ──▶ Definición IA ──▶ Diseño ──▶ desarrollo ──▶ Documentación
  (tú)       agente + revisión   Moki/Paper   (tu agente,      agente + revisión
                                               por MCP)
```

## Qué hay en un proyecto

| | Qué es | Dónde |
|---|---|---|
| **Board** | Cards en columnas configurables. Cada columna decide qué agente se lanza en sus cards (*definir*, *documentar* o ninguno); una puede ser el **archivo**. | Board |
| **Stacks** | Las piezas del producto (p. ej. `app`, `web`, `backend`). Cada card toca uno o varios, cada uno con su versión. | Ajustes del proyecto |
| **Docs** | Cómo funciona hoy el producto: flujos, comportamientos y casuísticas, en markdown. | Docs |
| **Reglas** | Cómo trabajan sus agentes: definición de cards, criterios de QA por stack, guías de diseño y documentación, plantilla del prompt de implementación. | Reglas |
| **Diseño** | El fichero de Moki o Paper donde se pintan las cards. | Ajustes del proyecto |

Docs y reglas viven en la base de datos y guardan **cada versión** con su autor y origen (tú, un agente de Cardinal, un agente externo por MCP), con historial y restauración desde la interfaz.

### Reglas que leen los agentes

Son opcionales, pero sin ellas los agentes trabajan sin guía. El asistente de nuevo proyecto permite copiarlas de otro proyecto como punto de partida.

| Regla | La usa |
|---|---|
| `agent-define.md`, `card-definition.md`, `tech-definition.md` | Agente de definición |
| `qa-criteria-<stack>.md` | Agente de definición, según los stacks de la card |
| `agent-document.md`, `product-doc-guide.md` | Agente de documentación |
| `agent-design.md`, `design-guide.md` | Agente de diseño |
| `feature-prompt.md` | «Copiar como prompt» y `get_feature_prompt` (`{{title}}`, `{{stacks}}`, `{{definition}}`, `{{designs}}`) |

## Flujo de una card

1. **Borrador.** Creas la card y escribes la idea con tus palabras. Los comentarios son notas privadas: los agentes no los leen.
2. **Definir.** Desde la consola de la card lanzas el agente de definición: busca en los docs del proyecto, aplica sus reglas y escribe la **Definición IA** (producto, técnica y QA). Antes de guardarse pasa una validación estructural y una revisión independiente. Puedes seguir iterando por chat.
3. **Diseñar** (opcional). El agente de diseño pinta cada casuística en Moki o Paper y guarda un manifiesto con qué artboard cubre qué. Si la definición cambia después, el diseño queda marcado como desactualizado.
4. **Implementar.** «Copiar como prompt» (o `get_feature_prompt` por MCP) entrega la definición, con el diseño, al agente que la implementa en el repositorio del proyecto.
5. **Documentar.** En la columna de documentación, el agente actualiza los docs con lo que se ha construido. Después archivas la card.

**Ejecuciones** reúne lo que han hecho los agentes del proyecto: modelo, docs consultados, ficheros escritos y resultado de la revisión.

## Usar Cardinal desde tus agentes (MCP)

Cardinal expone un servidor MCP en `http://<host>:4400/mcp` (Streamable HTTP con `Authorization: Bearer`).

1. En **Conexiones → MCP de agentes**, crea un token: nombre (p. ej. «MacBook · Claude Code»), proyectos a los que accede y permiso (*solo lectura* o *lectura y escritura*). Se muestra una sola vez; Cardinal solo guarda su hash.
2. Añádelo a tu agente. La misma pantalla da el comando listo para copiar:

```bash
claude mcp add --transport http cardinal http://<host>:4400/mcp --header "Authorization: Bearer crd_…"
```

```toml
# Codex · ~/.codex/config.toml
[mcp_servers.cardinal]
url = "http://<host>:4400/mcp"
http_headers = { Authorization = "Bearer crd_…" }
```

```json
// Cursor · .cursor/mcp.json
{ "mcpServers": { "cardinal": { "url": "http://<host>:4400/mcp", "headers": { "Authorization": "Bearer crd_…" } } } }
```

| Herramienta | Qué hace | Escribe |
|---|---|---|
| `list_projects` | Proyectos accesibles con sus stacks y columnas | |
| `list_cards` | Cards de un proyecto, filtrables por columna o título | |
| `get_card` | Card completa: borrador, definición, diseño y comentarios | |
| `get_feature_prompt` | La definición envuelta en la plantilla del proyecto, lista para implementar | |
| `create_card` · `update_card` · `move_card` · `comment_card` | Gestionar cards | ✓ |
| `list_docs` · `search_docs` · `read_doc` · `doc_history` | Consultar la documentación y su historial | |
| `write_doc` | Crear o sustituir un doc (queda versionado con tu token como autor) | ✓ |
| `list_rules` · `read_rule` | Consultar las reglas del proyecto | |
| `update_rule` | Cambiar una regla (afecta a todos los agentes del proyecto) | ✓ |

Un token de solo lectura no ve las herramientas que escriben. Más detalle para agentes en [AGENTS.md](AGENTS.md).

## Proveedores de IA

Cada agente se lanza con un **proveedor y modelo** que eliges en la propia card; el valor por defecto se configura en **IA y diseño**.

| Proveedor | Cómo se paga | Cómo se conecta |
|---|---|---|
| **OpenRouter** | API key, pago por uso | Pega la key en IA y diseño (o `OPENROUTER_API_KEY`) |
| **Codex** | Suscripción de ChatGPT | IA y diseño → *Instalar* CLI → *Conectar cuenta ChatGPT* (código de dispositivo) |
| **Claude** | Suscripción Pro/Max | IA y diseño → *Instalar* CLI y pegar el token de `claude setup-token` |

- Con **OpenRouter** el bucle de herramientas lo ejecuta el servidor. Con **Codex y Claude** lo ejecuta su **CLI oficial**, al que Cardinal ofrece solo sus herramientas por un MCP interno ligado a la card (sin shell, edición de ficheros ni web).
- El **revisor independiente** usa por defecto el mismo modelo; puedes asignarle otro.
- Los CLIs se instalan en el volumen de datos (`data/cli`) y se actualizan solos una vez al día (`CLI_AUTO_UPDATE=false` lo desactiva): modelos nuevos sin construir otra imagen.
- Credenciales en `data/secrets/` (ficheros 0600, nunca se devuelven por la API), `data/codex/` y `data/claude/`.

> ⚠ Anthropic solo permite usar la suscripción Pro/Max a través de Claude Code y para uso personal; Cardinal siempre invoca el binario oficial, pero revisa sus condiciones vigentes.

## Diseño con Moki o Paper

Moki y Paper son alternativas: la conexión se configura una vez en **IA y diseño** y cada proyecto elige su fichero en **Ajustes del proyecto → Diseño**. El diseño necesita Codex o Claude (OpenRouter no usa MCP externos).

- **Moki** es un servidor de diseño siempre encendido en la red local con MCP por HTTP y token: no hay nada que levantar. El agente diseña siempre con instancias de los componentes del fichero.
- **Paper** solo expone su MCP en el Mac con la app abierta, así que Cardinal llega a él por un puente que levantas al diseñar y cierras con Ctrl+C:

```bash
node scripts/paper-bridge/paper-bridge.mjs
```

Muestra la URL y el token para pegar en IA y diseño (el token se guarda en `~/.config/cardinal-paper-bridge/` y se reutiliza). También: `… status`, `… token` y `… rotate-token`.

Tareas del agente de diseño: **diseñar**, **aplicar comentarios** (lee los hilos abiertos en la herramienta, corrige y los resuelve) y **promocionar** al documentar (mueve los artboards aprobados a la página de su feature). Ni Moki ni Paper permiten borrar páginas por MCP: la página vacía de la card se borra a mano.

## Arranque en local

Requiere Node 22.

```bash
cd server && npm install && npm run dev   # API en :4400
cd web && npm install && npm run dev      # UI en :5173 (proxy a la API)
```

Configuración opcional en `.env` (ver `.env.example`). Para producción, `cd web && npm run build` y el servidor sirve la interfaz en `:4400`. Sin proyectos, la app abre el asistente de nuevo proyecto.

## Despliegue en la Raspberry

La Raspberry ejecuta una imagen construida en el ordenador; no necesita el código fuente.

```bash
bash scripts/deploy-raspberry-image.sh
```

Construye la imagen `linux/arm64`, la copia por SSH y ejecuta en la Raspberry `scripts/load-raspberry-image.sh`, que:

1. Comprueba que existe la base de datos y detiene el servicio.
2. Guarda una copia de `data/` en `releases/`.
3. Carga la imagen y **ensaya las migraciones con ella sobre una copia de la base**. Si el ensayo falla, sigue la versión anterior y la base no se toca.
4. Recrea el servicio con la imagen nueva.

En la Raspberry, el `.env` fija `PRODUCT_OS_DATA_DIR` (ruta de la base en el host) y `PRODUCT_OS_IMAGE`. Nunca se copian `.env` ni `data/`.

## Base de datos y migraciones

Todo vive en `data/product-os.db` (SQLite nativa de Node, sin dependencias compiladas). El esquema se versiona con `PRAGMA user_version` en `server/src/migrate.js` y el servidor aplica las migraciones pendientes al arrancar:

1. Copia previa consistente con `VACUUM INTO` en `data/backups/`.
2. Cada migración en **una transacción** (SQLite también revierte el DDL).
3. Antes de confirmar comprueba que no se ha perdido nada (filas por tabla y huella del contenido de cards y comentarios). Si algo no cuadra, revierte y el servidor no arranca.

| Versión | Cambio |
|---|---|
| v1 | Proyectos, docs y reglas en la base. En una instalación anterior a Cardinal crea el proyecto con las cards existentes e importa los docs y reglas que estaban en ficheros (`workspace/docs/` y `os/`, montados en solo lectura); se niega a migrar si faltan. |
| v2 | Tokens del MCP de agentes. |

Ensayo sin modificar la base: `node server/src/migrate-cli.js --dry-run`.

## Configuración

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (4400) |
| `OPENROUTER_API_KEY` · `OPENROUTER_MODEL` · `MODELS` | OpenRouter (opcional; lo normal es configurarlo en IA y diseño) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token de `claude setup-token` (opcional) |
| `CLI_AUTO_UPDATE` | `false` desactiva la actualización diaria de los CLIs |
| `PAPER_BRIDGE_URL` · `PAPER_BRIDGE_TOKEN` | Puente de Paper (opcional) |
| `MOKI_URL` · `MOKI_TOKEN` | Servidor de Moki (opcional) |
| `PRODUCT_OS_IMAGE` · `PRODUCT_OS_DATA_DIR` | Imagen y ruta de datos que usa Docker Compose |
| `CARDINAL_LEGACY_DOCS_DIR` · `CARDINAL_LEGACY_RULES_DIR` | Origen de la importación de la migración v1 |

## Diseño de la interfaz

La interfaz se diseña en Moki, fichero **Cardinal · Design**: una página por pantalla, con los componentes en `00 · Componentes`. Todo cambio de UI se refleja también ahí.
