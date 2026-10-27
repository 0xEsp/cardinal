# Cardinal

Sistema de producto con agentes de IA para **varios proyectos** (Gotty es uno de ellos): un board de cards por proyecto, agentes que definen, diseñan y documentan, la documentación de producto y las reglas con las que trabajan esos agentes. Todo vive en una SQLite y se usa desde el navegador o, desde cualquier agente (Claude Code, Codex, Cursor…), por **MCP**.

Antes se llamaba *Gotty · Product OS*. El diseño de la interfaz vive en Moki, fichero *Product-os · Product Design*, página **D · Cristal × Imprenta**: cualquier cambio de UI se diseña también ahí.

## Cómo funciona

```
server/           ← API Node/Express + agentes (OpenRouter, Codex o Claude Code) + MCP para tus agentes
web/              ← interfaz React (sistema D: papel, tinta, sombras duras; Space Grotesk + JetBrains Mono)
data/             ← SQLite: proyectos, cards, docs, reglas y su historial, sesiones y ejecuciones (volumen en Docker)
scripts/          ← build y despliegue en la Raspberry; puente MCP de Paper para el Mac
```

Un **proyecto** tiene:

- **Board** con columnas configurables. Cada columna decide qué agente se lanza en sus cards: *definir*, *documentar* o ninguno; una de ellas puede ser el **archivo** (no se muestra en el board).
- **Stacks** (Gotty: `app`, `web`, `backend`). Cada card toca uno o varios y cada stack lleva su versión.
- **Docs**: cómo funciona hoy el producto, en markdown.
- **Reglas**: cómo trabajan sus agentes (lo que antes era `os/`): `agent-define.md`, `card-definition.md`, `tech-definition.md`, `qa-criteria-<stack>.md`, `agent-document.md`, `product-doc-guide.md`, `agent-design.md`, `design-guide.md` y la plantilla `feature-prompt.md`.
- **Fichero de diseño** en Paper y/o Moki.

Docs y reglas guardan **cada versión** con su autor y origen (tú desde la UI, un agente de Cardinal, un agente externo por MCP o la importación inicial), con historial y restauración. Ya no hay git de por medio: nada que sincronizar con Pull/Push.

El flujo de una card:

1. La creas en el board y escribes tu **borrador**. Los comentarios son notas privadas: los agentes no los leen.
2. **Definir card** (consola del agente, a la derecha de la card): el agente busca en los docs del proyecto, aplica sus reglas y genera la **Definición IA** (producto + técnica + QA). Una validación estructural y una revisión independiente deben aprobarla antes de guardarla. Puedes seguir iterando por chat.
3. **Diseño** (opcional): el agente de diseño pinta cada casuística en Paper o Moki.
4. **Copiar como prompt** envuelve la definición en la plantilla `feature-prompt.md` del proyecto, lista para el agente que la implemente (o tu agente la pide por MCP con `get_feature_prompt`).
5. En la columna de documentación, **Documentar** lanza el agente que crea o actualiza los docs. Después la archivas.

La card muestra en todo momento su etapa: Borrador → Definición → Diseño → Desarrollo → Documentación. **Ejecuciones** reúne las de todo el proyecto con modelo, docs consultados y resultado de la revisión.

## MCP para tus agentes

Cardinal expone un servidor MCP en `http://<host>:4400/mcp` (Streamable HTTP, `Authorization: Bearer`). En **Conexiones → MCP de agentes** creas un token por agente o máquina, limitado a unos proyectos y de solo lectura o de lectura y escritura; el token se muestra una sola vez y solo se guarda su hash. La pantalla da el comando listo para Claude Code, Codex y Cursor, por ejemplo:

```bash
claude mcp add --transport http cardinal http://192.168.50.108:4400/mcp --header "Authorization: Bearer crd_…"
```

Herramientas: `list_projects` · `list_cards` · `get_card` · `create_card` · `update_card` · `move_card` · `comment_card` · `get_feature_prompt` · `list_docs` · `search_docs` · `read_doc` · `write_doc` · `doc_history` · `list_rules` · `read_rule` · `update_rule`. Un token de solo lectura no ve las que escriben. Todo lo que escribe un agente queda en el historial como `MCP · <nombre del token>`.

Este MCP es distinto del canal interno (`/mcp/<token>`) que usan los agentes de Cardinal: ese solo es accesible desde el propio contenedor y está ligado a una card.

## Proveedores de IA

Cada agente se lanza con un **proveedor + modelo** que eliges en la propia card (el valor por defecto se configura en la pantalla **IA y diseño**):

| Proveedor | Cómo se paga | Cómo se conecta |
|---|---|---|
| **OpenRouter** | API key, pago por uso | Pega la key en IA y diseño (o `OPENROUTER_API_KEY` en `.env`) |
| **Codex** | Tu suscripción de ChatGPT (Plus/Pro) | Pestaña IA → *Instalar* CLI → *Conectar cuenta ChatGPT*: abre la URL en cualquier dispositivo e introduce el código. Alternativa: pegar el `~/.codex/auth.json` de un ordenador donde hayas hecho `codex login` |
| **Claude** | Tu suscripción Pro/Max | Pestaña IA → *Instalar* CLI. En tu ordenador ejecuta `claude setup-token`, inicia sesión y pega el token (`sk-ant-oat…`, dura un año) |

Cómo funciona por dentro:

- Con **OpenRouter** el bucle de herramientas lo ejecuta el propio servidor.
- Con **Codex y Claude** el bucle lo ejecuta el **CLI oficial** (`codex exec` / `claude -p`) y las herramientas del harness (`search_docs`, `read_doc`, `review_*`, `save_*`) se le ofrecen por un **servidor MCP interno** (`/mcp/<token>`, solo accesible desde el propio contenedor y ligado a la card). Las herramientas nativas de los CLIs (shell, edición de ficheros, búsqueda web) quedan desactivadas. La validación y la revisión obligatoria funcionan igual con cualquier proveedor.
- El **revisor independiente** usa por defecto el mismo proveedor y modelo que el agente; en IA y diseño puedes asignarle otro.

**Modelos nuevos sin redesplegar:** el catálogo de OpenRouter se lee en vivo de su API y el de Codex sale del propio CLI, que lo refresca desde OpenAI con tu cuenta. En Claude los alias (`opus`, `sonnet`, `haiku`…) apuntan siempre al último modelo que conoce el CLI. El campo de modelo admite además cualquier id escrito a mano. Los CLIs **no van en la imagen**: se instalan en `data/cli` (volumen persistente) y se actualizan con el botón *Actualizar* o automáticamente una vez al día (`CLI_AUTO_UPDATE=false` lo desactiva).

Todo lo que necesitan los proveedores vive en el volumen de datos y sobrevive a nuevas imágenes:

```text
data/secrets/   ← API key de OpenRouter y token de Claude (ficheros 0600; nunca se devuelven por la API)
data/codex/     ← CODEX_HOME: auth.json (Codex lo refresca solo) y sesiones
data/claude/    ← CLAUDE_CONFIG_DIR: sesiones de Claude Code
data/cli/       ← CLIs instalados (no se incluye en la copia de seguridad del despliegue)
```

> ⚠ **Condiciones de uso.** OpenAI permite usar la suscripción de ChatGPT con el CLI oficial de Codex. Anthropic solo permite usar la suscripción Pro/Max a través de Claude Code y para uso personal; aquí siempre se invoca el binario oficial, pero revisa sus condiciones vigentes antes de depender de ello. Los límites de uso de la suscripción (ventanas de 5 h y cupo semanal) se aplican también a las revisiones.

## Diseño con Paper o Moki

Además de definir, cada card puede tener su **diseño** en el fichero de diseño de su proyecto (Gotty: *Gotty · Product Design*), coexistiendo con la definición. La conexión con Paper y Moki es común; **el fichero se elige en los ajustes de cada proyecto**. Hay dos herramientas **alternativas** con el mismo fichero y la misma organización: **Paper** (app de escritorio, a través de un puente en el Mac) y **Moki** (servidor de diseño propio, siempre encendido en la red local). Ambas se conectan por MCP y se configuran en la pantalla **IA y diseño**, donde eliges también la herramienta **por defecto**. Al lanzar el diseño de una card puedes elegir la otra; una vez la card tiene diseño, queda ligada a su herramienta (comentarios, promoción y enlaces van siempre a la misma).

1. **Definir** (consola del agente de la card): si la herramienta por defecto (o la del diseño de la card) está disponible y el proveedor es Codex o Claude, el agente de definición **consulta** los diseños existentes (solo lectura) para que la definición encaje con la UI real.
2. **Diseñar** (pestaña **Diseño** de la card; la consola pasa al agente de diseño): un agente de diseño pinta cada casuística de la definición en una página propia de la card (`30 · Card · <título>`), siguiendo las reglas `agent-design.md` y `design-guide.md` del proyecto: app en iOS (y Android donde el patrón nativo difiere) y web en parejas desktop + responsive. Una **revisión de diseño obligatoria** (capturas de los artboards contra la definición y el sistema de diseño) debe aprobar el resultado antes de guardarlo. Se guarda un **manifiesto**: qué artboards cubren qué casuística, y en qué herramienta.
3. **Iterar**: por chat con el agente, o comentando directamente en la herramienta de diseño y pulsando **💬 Aplicar comentarios** (el agente lee los hilos abiertos, corrige y los marca como resueltos).
4. **Coherencia**: si la definición cambia después de diseñar, el diseño queda marcado **⚠ desactualizado** (en la card y en el prompt) hasta que se rediseñe. Si el agente de diseño descubre un hueco, actualiza la definición pasando por `review_definition`.
5. **Copiar como prompt** añade la sección *Diseño (Paper)* o *Diseño (Moki)* con el enlace a la página, los ids de los artboards y cómo usarlos por MCP (`{{designs}}` en la regla `feature-prompt.md`).
6. **Promocionar** (al documentar, en Done Dev): el agente mueve los artboards aprobados a la página de su feature (`10–14` app, `20–25` web) y **borra** los artboards que sustituyen: el fichero refleja solo el producto actual. Ni Paper ni Moki permiten borrar páginas por MCP, así que la página de la card queda vacía y renombrada (`· promocionada, borrar`) para que la borres a mano. El agente de documentación enlaza la página en el documento del flujo.

El diseño solo se puede hacer con **Codex o Claude** (OpenRouter no puede usar herramientas MCP externas). Lo que cambia entre herramientas (infraestructura, cómo reutilizar masters, herramientas permitidas) vive en `server/src/paper.js`, `server/src/moki.js` y la sección de herramienta que añade `server/src/prompt.js`; las reglas de diseño son de cada proyecto.

### Moki: sin puente

Moki expone su MCP por HTTP con token (`Authorization: Bearer`), así que Cardinal habla con él directamente: no hay nada que levantar. En la pantalla **IA y diseño** → **Moki (diseño)** pega la URL `http://<ip-del-servidor-de-moki>:7410/mcp` (usa la IP: desde el contenedor los nombres de la red local pueden no resolverse), y el token de Moki (`MOKI_TOKEN`, en el Llavero del Mac que lo despliega). El fichero de diseño se elige en **Ajustes del proyecto → Diseño**; el estado comprueba que el servidor responde, que el token es válido y que el fichero del proyecto sigue existiendo.

Moki permite al agente de diseño, además de lo mismo que Paper, diseñar **siempre con instancias** de los componentes existentes (`create_instance`, overrides). Si falta un componente, lo crea como borrador en la página de la card (`create_component`, `convert_to_instances`) y al promocionar pasa a `02 · Components`. No puede desvincular instancias, crear ficheros, exportar ni tocar tokens.

### ⚠ El puente de Paper debe estar encendido

El MCP de Paper **no es un servicio en la nube**: es un relay (`~/.paper/bin/paper mcp`) que habla con la app de escritorio de Paper en el Mac. Cardinal, en la Raspberry, llega a él a través de un **puente** que corre en ese Mac (`scripts/paper-bridge/`). **Sin el Mac encendido, el puente activo y la app de Paper abierta, no se puede diseñar** (la definición sigue funcionando, sin consultar diseños).

El puente es un proceso de Node sin dependencias que **levantas cuando quieras diseñar y cierras con Ctrl+C** (no queda ningún servicio instalado ni escuchando cuando está cerrado). Desde la raíz del repositorio, en el Mac:

```bash
node scripts/paper-bridge/paper-bridge.mjs
```

Al levantarlo muestra la **URL** (`http://<ip-del-mac>:4410/mcp`), el **token** y si la app de Paper está abierta. La primera vez, pega URL y token en Cardinal → **IA y diseño** → **Paper (diseño)** y elige el fichero en los ajustes del proyecto. El token se guarda en `~/.config/gotty-paper-bridge/token` y se reutiliza en cada arranque, así que no hay que volver a configurarlo. Reserva la IP del Mac en el router para que no cambie. Si macOS pregunta si `node` puede aceptar conexiones entrantes, permítelo.

Otros comandos (desde otra terminal): `node scripts/paper-bridge/paper-bridge.mjs status` (¿está levantado? ¿Paper abierto?), `… token` (URL y token) y `… rotate-token` (token nuevo; hay que actualizarlo en IA y diseño). Puerto alternativo: `PAPER_BRIDGE_PORT=4420 node scripts/paper-bridge/paper-bridge.mjs`. La IA y diseño muestra en todo momento si el puente responde y si Paper está abierto.

Seguridad: el puente exige el token en cada petición (`Authorization: Bearer`) y solo expone las herramientas de Paper; Cardinal además limita qué herramientas recibe cada agente (lectura para definir y revisar; escritura sin crear ficheros, exportar ni tocar tokens para diseñar).

## Arranque en local

```bash
cp .env.example .env   # opcional: OPENROUTER_API_KEY (también se puede poner desde IA y diseño)

cd server && npm install && npm run dev   # API en :4400
cd web && npm install && npm run dev      # UI en :5173 (proxy a la API)
```

Para producción: `cd web && npm run build` y el server sirve el build en `http://localhost:4400`. Sin proyectos, la app abre el asistente de **nuevo proyecto** (nombre, stacks y columnas, reglas de partida copiadas de otro proyecto o vacías, e importación opcional de `.md`).

## Base de datos y migraciones

La SQLite se versiona con `PRAGMA user_version` (`server/src/migrate.js`). Al arrancar, el servidor aplica las migraciones pendientes así:

1. Copia consistente previa con `VACUUM INTO` en `data/backups/product-os-pre-vN-<fecha>.db`.
2. Cada migración corre en **una transacción** (SQLite también revierte el DDL).
3. Antes de confirmar comprueba que no se ha perdido nada: mismo número de filas en cada tabla y misma huella del contenido de cards y comentarios; en la v1, además, que cada doc y regla importados coinciden byte a byte con su fichero. Si algo no cuadra, revierte y el servidor no arranca.

| Versión | Cambio |
|---|---|
| v1 | Proyectos; `cards.project_id`; docs y reglas en `documents` + `document_versions`. Crea el proyecto **Gotty** con todas las cards existentes e importa `workspace/docs/` y `os/` (si hay cards y faltan esos directorios, se niega a migrar). Los ficheros de diseño elegidos en la antigua pestaña IA pasan a Gotty. |
| v2 | Tokens del MCP de agentes. |

Nada se borra ni se renombra: si vuelves a una imagen anterior, sigue funcionando con la misma base (ignora las tablas nuevas).

Ensayo sin tocar la base (el despliegue lo hace solo, sobre una copia):

```bash
node server/src/migrate-cli.js --dry-run
```

## Despliegue en la Raspberry (Docker)

La Raspberry ejecuta una imagen ya construida. No reconstruye el proyecto ni necesita tener el código fuente actualizado para ejecutar una nueva versión.

La carpeta de despliegue se mantiene en:

```text
/home/0xEsp/justgame-product-os
```

En la Raspberry, configura `.env` una sola vez:

```env
PRODUCT_OS_IMAGE=cardinal:raspberry
PRODUCT_OS_DATA_DIR=/home/0xEsp/justgame-product-os/data
```

`PRODUCT_OS_DATA_DIR` es la fuente de verdad de las cards y las sesiones de agente. No copies la carpeta `data/` desde el ordenador ni la incluyas en una imagen.

### Construir y exportar desde el ordenador

Para una Raspberry de 64 bits (`uname -m` devuelve `aarch64`):

```bash
bash scripts/build-raspberry-image.sh
```

El script construye la imagen para `linux/arm64` y genera un archivo comprimido en `releases/`, por ejemplo:

```text
releases/cardinal-raspberry-20260811-153000.tar.gz
```

Para construir, transferir y arrancar en un solo paso desde este ordenador:

```bash
bash scripts/deploy-raspberry-image.sh
```

SSH/SCP solicitarán las credenciales cuando correspondan. El script copia la imagen, `docker-compose.yml` y `load-raspberry-image.sh`; nunca copia `.env` ni `data/`.

Para hacerlo manualmente, crea una carpeta de releases en la Raspberry una sola vez:

```bash
mkdir -p /home/0xEsp/justgame-product-os/releases
```

Transfiere ese archivo a esa carpeta. Por ejemplo:

```bash
scp releases/cardinal-raspberry-*.tar.gz \
  0xEsp@192.168.50.108:/home/0xEsp/justgame-product-os/releases/
```

### Cargar y arrancar en la Raspberry

Desde `/home/0xEsp/justgame-product-os`:

```bash
bash scripts/load-raspberry-image.sh releases/cardinal-raspberry-<fecha>.tar.gz
```

El script exige la SQLite existente en el volumen de datos, detiene el servicio para cerrar el WAL, guarda una copia de `data/` en `releases/`, carga la imagen, **ensaya las migraciones de la base con la imagen nueva sobre una copia** y solo si el ensayo pasa ejecuta `docker compose up -d --no-build --force-recreate`. Si el ensayo falla, vuelve a arrancar la versión anterior y la base no se toca. La base de datos permanece en su ruta del host.

Antes de una actualización importante, puede hacerse una copia manual:

```bash
cd /home/0xEsp/justgame-product-os
docker compose stop
tar -czf /home/0xEsp/product-os-backup-$(date +%F).tar.gz data
docker compose start
```

El dashboard queda disponible en `http://<ip-de-la-raspberry>:4400`.

### `workspace/` y `os/` en la Raspberry

Ya no se usan en el día a día: se montan **en solo lectura** únicamente para que la migración v1 importe a la SQLite los docs y reglas que estaban en git. No van dentro de la imagen (`.dockerignore`), para que nunca se importe una copia antigua. Cuando hayas comprobado que todo está bien en Cardinal puedes quitar esos montajes de `docker-compose.yml`.

## Configuración (.env)

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; la que se guarda desde IA y diseño tiene prioridad) |
| `OPENROUTER_MODEL` | Modelo por defecto de OpenRouter |
| `MODELS` | Modelos de reserva si el catálogo de OpenRouter no responde, separados por coma |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token de `claude setup-token` (opcional; alternativa a pegarlo en IA y diseño) |
| `CLI_AUTO_UPDATE` | `false` desactiva la actualización diaria automática de los CLIs de Codex y Claude |
| `PAPER_BRIDGE_URL` / `PAPER_BRIDGE_TOKEN` | Puente de Paper (opcional; lo normal es configurarlo en IA y diseño) |
| `MOKI_URL` / `MOKI_TOKEN` | Servidor de Moki (opcional; lo normal es configurarlo en IA y diseño) |
| `PORT` | Puerto del servidor (4400) |
| `PRODUCT_OS_IMAGE` | Etiqueta de la imagen Docker que ejecutará Compose |
| `PRODUCT_OS_DATA_DIR` | Ruta del host donde persiste la SQLite; en la Raspberry: `/home/0xEsp/justgame-product-os/data` |
| `CARDINAL_LEGACY_DOCS_DIR` / `CARDINAL_LEGACY_RULES_DIR` | Origen de la importación de la migración v1 (por defecto `workspace/docs` y `os`) |
