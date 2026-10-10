# Gotty · Product OS

Sistema operativo de producto para Gotty: un dashboard local (kanban + agentes de IA + documentación) con las cards en SQLite y la documentación de producto como markdown versionado en git.

## Cómo funciona

```
os/               ← las "reglas": cómo se define una card, criterios de QA, guía de documentación,
                    plantilla del prompt para el feature-builder (feature-prompt.md)
workspace/docs/   ← documentación de producto en .md (la fuente de verdad, versionada en git)
data/             ← SQLite (cards + sesiones + historial de agentes; fuera de git, volumen en Docker)
server/           ← API Node/Express + agentes (OpenRouter, Codex o Claude Code) con streaming SSE + tool-use
web/              ← dashboard React (kanban, modal de card, consola de agente, editor de docs)
```

Las **cards viven en SQLite** (propiedades, borrador, definición, sesiones de agente) usando el `node:sqlite` nativo de Node 22 — sin dependencias compiladas. La **documentación de producto sigue siendo markdown en git**, que es lo que consumen los agentes y lo que migras desde Notion.

El flujo:

1. Creas una card en el board, escribes tu **borrador** con tus palabras y puedes añadir comentarios como notas privadas. Las cards se pueden priorizar arrastrándolas verticalmente dentro de cada columna.
2. Botón **▶ Definir card**: un agente (con el proveedor y modelo que elijas) busca en `workspace/docs/`, lee los documentos relevantes, aplica las reglas de `os/` y genera la **definición completa** (producto + técnica + QA). Una validación estructural y una revisión independiente deben aprobarla antes de guardarla. Tu borrador nunca se toca. Puedes seguir iterando con el agente por chat.
3. Botón **⧉ Copiar como prompt** en la pestaña Definición: copia la definición envuelta en la plantilla `os/feature-prompt.md`, lista para pegar en el feature-builder del proyecto de turno.
4. Cuando el desarrollo termina, mueves la card a **Done Dev**. Un icono muestra si está pendiente de documentar o documentada. Al abrirla aparece el botón **Documentar**, que lanza un agente específico para buscar contexto, analizar la Definición IA +, revisar el resultado y crear o actualizar los `.md` de `workspace/docs/`.
5. Mueves la card a **Done** para archivarla: la columna Done siempre se muestra vacía (es un sumidero); con "ver done (N)" del filtro puedes consultar las archivadas, también filtradas por stack/versión.
6. La pestaña **Docs** permite editar y guardar manualmente cualquier `.md` de `workspace/docs/`. El botón **Push** desde el dashboard (o `AUTO_PUSH=true` después de una ejecución correcta del agente) commitea `workspace/` + `os/` y sube al remoto.

Cada card puede tocar varios **stacks (app/web/backend) y cada stack lleva su propia versión**; el board se filtra por ambos.

El **modo del agente lo decide la columna**: `backlog/todo/in-progress` → definir · `done-dev` → vista exclusiva de documentación · `done` → nada. El markdown de **Definición IA +** también se puede editar manualmente desde la card. El agente continúa hasta guardar el resultado y después queda disponible para nuevas instrucciones; **Detener agente** cierra la sesión activa.

La pestaña **Ejecuciones** de cada card conserva el modelo utilizado, la revisión de contexto, las búsquedas y lecturas de documentación, los archivos escritos y el resultado de validación/revisión.

## Proveedores de IA

Cada agente se lanza con un **proveedor + modelo** que eliges en la propia card (el valor por defecto se configura en la pestaña **IA**):

| Proveedor | Cómo se paga | Cómo se conecta |
|---|---|---|
| **OpenRouter** | API key, pago por uso | Pega la key en la pestaña IA (o `OPENROUTER_API_KEY` en `.env`) |
| **Codex** | Tu suscripción de ChatGPT (Plus/Pro) | Pestaña IA → *Instalar* CLI → *Conectar cuenta ChatGPT*: abre la URL en cualquier dispositivo e introduce el código. Alternativa: pegar el `~/.codex/auth.json` de un ordenador donde hayas hecho `codex login` |
| **Claude** | Tu suscripción Pro/Max | Pestaña IA → *Instalar* CLI. En tu ordenador ejecuta `claude setup-token`, inicia sesión y pega el token (`sk-ant-oat…`, dura un año) |

Cómo funciona por dentro:

- Con **OpenRouter** el bucle de herramientas lo ejecuta el propio servidor.
- Con **Codex y Claude** el bucle lo ejecuta el **CLI oficial** (`codex exec` / `claude -p`) y las herramientas del harness (`search_docs`, `read_doc`, `review_*`, `save_*`) se le ofrecen por un **servidor MCP interno** (`/mcp/<token>`, solo accesible desde el propio contenedor y ligado a la card). Las herramientas nativas de los CLIs (shell, edición de ficheros, búsqueda web) quedan desactivadas. La validación y la revisión obligatoria funcionan igual con cualquier proveedor.
- El **revisor independiente** usa por defecto el mismo proveedor y modelo que el agente; en la pestaña IA puedes asignarle otro.

**Modelos nuevos sin redesplegar:** el catálogo de OpenRouter se lee en vivo de su API y el de Codex sale del propio CLI, que lo refresca desde OpenAI con tu cuenta. En Claude los alias (`opus`, `sonnet`, `haiku`…) apuntan siempre al último modelo que conoce el CLI. El campo de modelo admite además cualquier id escrito a mano. Los CLIs **no van en la imagen**: se instalan en `data/cli` (volumen persistente) y se actualizan con el botón *Actualizar* o automáticamente una vez al día (`CLI_AUTO_UPDATE=false` lo desactiva).

Todo lo que necesitan los proveedores vive en el volumen de datos y sobrevive a nuevas imágenes:

```text
data/secrets/   ← API key de OpenRouter y token de Claude (ficheros 0600; nunca se devuelven por la API)
data/codex/     ← CODEX_HOME: auth.json (Codex lo refresca solo) y sesiones
data/claude/    ← CLAUDE_CONFIG_DIR: sesiones de Claude Code
data/cli/       ← CLIs instalados (no se incluye en la copia de seguridad del despliegue)
```

> ⚠ **Condiciones de uso.** OpenAI permite usar la suscripción de ChatGPT con el CLI oficial de Codex. Anthropic solo permite usar la suscripción Pro/Max a través de Claude Code y para uso personal; aquí siempre se invoca el binario oficial, pero revisa sus condiciones vigentes antes de depender de ello. Los límites de uso de la suscripción (ventanas de 5 h y cupo semanal) se aplican también a las revisiones.

## Arranque en local

```bash
cp .env.example .env   # opcional: OPENROUTER_API_KEY (también se puede poner desde la pestaña IA)

cd server && npm install && npm run dev   # API en :4400
cd web && npm install && npm run dev      # UI en :5173 (proxy a la API)
```

Para producción: `cd web && npm run build` y el server sirve el build en `http://localhost:4400`.

## Despliegue en la Raspberry (Docker)

La Raspberry ejecuta una imagen ya construida. No reconstruye el proyecto ni necesita tener el código fuente actualizado para ejecutar una nueva versión.

La carpeta de despliegue se mantiene en:

```text
/home/0xEsp/justgame-product-os
```

En la Raspberry, configura `.env` una sola vez:

```env
PRODUCT_OS_IMAGE=gotty-product-os:raspberry
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
releases/gotty-product-os-raspberry-20260811-153000.tar.gz
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
scp releases/gotty-product-os-raspberry-*.tar.gz \
  0xEsp@192.168.50.108:/home/0xEsp/justgame-product-os/releases/
```

### Cargar y arrancar en la Raspberry

Desde `/home/0xEsp/justgame-product-os`:

```bash
bash scripts/load-raspberry-image.sh releases/gotty-product-os-raspberry-<fecha>.tar.gz
```

El script exige la SQLite existente en el volumen de datos, detiene el servicio para cerrar el WAL, guarda una copia de `data/` en `releases/`, carga la imagen y ejecuta `docker compose up -d --no-build --force-recreate`. La base de datos permanece en su ruta del host.

Antes de una actualización importante, puede hacerse una copia manual:

```bash
cd /home/0xEsp/justgame-product-os
docker compose stop
tar -czf /home/0xEsp/product-os-backup-$(date +%F).tar.gz data
docker compose start
```

El dashboard queda disponible en `http://<ip-de-la-raspberry>:4400`.

### Sincronización de `os/` y `workspace/`

`workspace/` y `os/` siguen siendo directorios montados desde la Raspberry. Esto permite que la documentación generada por los agentes sobreviva a las actualizaciones de imagen. El checkout completo del host también se monta en `/repo` para que Git opere sobre los archivos reales de la Raspberry; el servidor continúa ejecutando el código de la imagen.

Si modificas `os/` o `workspace/docs/` desde el ordenador, haz commit y push. En la Raspberry pulsa **Pull** en el dashboard: los cambios se verán sin reconstruir ni reiniciar la imagen. Si hay cambios locales incompatibles, resuélvelos antes del pull. No copies `data/`.

El botón `Push` continúa versionando únicamente `workspace/` y `os/`; el código de la aplicación se actualiza mediante la imagen Docker.

La skill global `product-os-docs` vive en `~/.agents/skills/` y tiene enlaces simbólicos en `~/.codex/skills/`, `~/.claude/skills/` y `~/.cursor/skills/`. Permite leer y actualizar docs y reglas desde cualquier carpeta del ordenador. La skill de despliegue `deploy-product-os` está en `.agents/skills/` del proyecto, también con enlaces para Codex, Claude y Cursor.

## Migrar la documentación de Notion

Exporta tus páginas de Notion como markdown y déjalas en `workspace/docs/` (kebab-case, un fichero por flujo). Aparecerán en la pestaña Docs y los agentes las tendrán en cuenta al definir y documentar.

## Configuración (.env)

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; la que se guarda desde la pestaña IA tiene prioridad) |
| `OPENROUTER_MODEL` | Modelo por defecto de OpenRouter |
| `MODELS` | Modelos de reserva si el catálogo de OpenRouter no responde, separados por coma |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token de `claude setup-token` (opcional; alternativa a pegarlo en la pestaña IA) |
| `CLI_AUTO_UPDATE` | `false` desactiva la actualización diaria automática de los CLIs de Codex y Claude |
| `PORT` | Puerto del servidor (4400) |
| `PRODUCT_OS_IMAGE` | Etiqueta de la imagen Docker que ejecutará Compose |
| `PRODUCT_OS_DATA_DIR` | Ruta del host donde persiste la SQLite; en la Raspberry: `/home/0xEsp/justgame-product-os/data` |
| `AUTO_PUSH` | `true` → commit+push automático del workspace al terminar un agente |
| `GIT_USERNAME` / `GIT_TOKEN` | Credenciales HTTPS para pull/push (fine-grained token con Contents:write) |
