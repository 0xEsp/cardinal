# Gotty · Product OS

Sistema operativo de producto para Gotty: un dashboard local (kanban + agentes de IA + documentación) con las cards en SQLite y la documentación de producto como markdown versionado en git.

## Cómo funciona

```
os/               ← las "reglas": cómo se define una card, criterios de QA, guía de documentación,
                    plantilla del prompt para el feature-builder (feature-prompt.md)
workspace/docs/   ← documentación de producto en .md (la fuente de verdad, versionada en git)
data/             ← SQLite (cards + sesiones + historial de agentes; fuera de git, volumen en Docker)
server/           ← API Node/Express + agente OpenRouter (streaming SSE + tool-use)
web/              ← dashboard React (kanban, modal de card, consola de agente, editor de docs)
```

Las **cards viven en SQLite** (propiedades, borrador, definición, sesiones de agente) usando el `node:sqlite` nativo de Node 22 — sin dependencias compiladas. La **documentación de producto sigue siendo markdown en git**, que es lo que consumen los agentes y lo que migras desde Notion.

El flujo:

1. Creas una card en el board, escribes tu **borrador** con tus palabras y puedes añadir comentarios como notas privadas. Las cards se pueden priorizar arrastrándolas verticalmente dentro de cada columna.
2. Botón **▶ Definir card**: un agente (OpenRouter) busca en `workspace/docs/`, lee los documentos relevantes, aplica las reglas de `os/` y genera la **definición completa** (producto + técnica + QA). Una validación estructural y una revisión independiente deben aprobarla antes de guardarla. Tu borrador nunca se toca. Puedes seguir iterando con el agente por chat.
3. Botón **⧉ Copiar como prompt** en la pestaña Definición: copia la definición envuelta en la plantilla `os/feature-prompt.md`, lista para pegar en el feature-builder del proyecto de turno.
4. Cuando el desarrollo termina, mueves la card a **Done Dev**. Un icono muestra si está pendiente de documentar o documentada. Al abrirla aparece el botón **Documentar**, que lanza un agente específico para buscar contexto, analizar la Definición IA +, revisar el resultado y crear o actualizar los `.md` de `workspace/docs/`.
5. Mueves la card a **Done** para archivarla: la columna Done siempre se muestra vacía (es un sumidero); con "ver done (N)" del filtro puedes consultar las archivadas, también filtradas por stack/versión.
6. La pestaña **Docs** permite editar y guardar manualmente cualquier `.md` de `workspace/docs/`. El botón **Push** desde el dashboard (o `AUTO_PUSH=true` después de una ejecución correcta del agente) commitea `workspace/` + `os/` y sube al remoto.

Cada card puede tocar varios **stacks (app/web/backend) y cada stack lleva su propia versión**; el board se filtra por ambos.

El **modo del agente lo decide la columna**: `backlog/todo/in-progress` → definir · `done-dev` → vista exclusiva de documentación · `done` → nada. El markdown de **Definición IA +** también se puede editar manualmente desde la card.

La pestaña **Ejecuciones** de cada card conserva el modelo utilizado, la revisión de contexto, las búsquedas y lecturas de documentación, los archivos escritos y el resultado de validación/revisión.

## Arranque en local

```bash
cp .env.example .env   # y pon tu OPENROUTER_API_KEY

cd server && npm install && npm run dev   # API en :4400
cd web && npm install && npm run dev      # UI en :5173 (proxy a la API)
```

Para producción: `cd web && npm run build` y el server sirve el build en `http://localhost:4400`.

## Despliegue en la Raspberry (Docker)

La Raspberry ejecuta una imagen ya construida. No reconstruye el proyecto ni necesita tener el código fuente actualizado para ejecutar una nueva versión.

La carpeta de despliegue se mantiene en:

```text
/home/0xEsp/gotty-product-os
```

En la Raspberry, configura `.env` una sola vez:

```env
PRODUCT_OS_IMAGE=gotty-product-os:raspberry
PRODUCT_OS_DATA_DIR=/home/0xEsp/gotty-product-os/data
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

En la Raspberry, crea una carpeta de releases una sola vez:

```bash
mkdir -p /home/0xEsp/gotty-product-os/releases
```

Transfiere ese archivo a esa carpeta. Por ejemplo:

```bash
scp releases/gotty-product-os-raspberry-*.tar.gz \
  0xEsp@<ip-de-la-raspberry>:/home/0xEsp/gotty-product-os/releases/
```

### Cargar y arrancar en la Raspberry

Desde `/home/0xEsp/gotty-product-os`:

```bash
bash scripts/load-raspberry-image.sh releases/gotty-product-os-raspberry-<fecha>.tar.gz
```

El script carga la imagen y ejecuta `docker compose up -d --no-build --force-recreate`. La base de datos permanece en `data/` y no se modifica al reemplazar el contenedor.

Antes de una actualización importante, puede hacerse una copia manual:

```bash
cd /home/0xEsp/gotty-product-os
docker compose stop
tar -czf /home/0xEsp/product-os-backup-$(date +%F).tar.gz data
docker compose start
```

El dashboard queda disponible en `http://<ip-de-la-raspberry>:4400`.

### Sincronización de `os/` y `workspace/`

`workspace/` y `os/` siguen siendo directorios montados desde la Raspberry. Esto permite que la documentación generada por los agentes sobreviva a las actualizaciones de imagen.

Si modificas `os/` o `workspace/` desde el ordenador, actualiza primero esas carpetas en la Raspberry mediante el botón `Pull` existente o mediante una transferencia de archivos. Después carga la nueva imagen. No copies `data/`.

El botón `Push` continúa versionando únicamente `workspace/` y `os/`; el código de la aplicación se actualiza mediante la imagen Docker.

## Migrar la documentación de Notion

Exporta tus páginas de Notion como markdown y déjalas en `workspace/docs/` (kebab-case, un fichero por flujo). Aparecerán en la pestaña Docs y los agentes las tendrán en cuenta al definir y documentar.

## Configuración (.env)

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter (obligatoria para los agentes) |
| `OPENROUTER_MODEL` | Modelo por defecto |
| `MODELS` | Modelos del selector, separados por coma |
| `PORT` | Puerto del servidor (4400) |
| `PRODUCT_OS_IMAGE` | Etiqueta de la imagen Docker que ejecutará Compose |
| `PRODUCT_OS_DATA_DIR` | Ruta del host donde persiste la SQLite; en la Raspberry: `/home/0xEsp/gotty-product-os/data` |
| `AUTO_PUSH` | `true` → commit+push automático del workspace al terminar un agente |
| `GIT_USERNAME` / `GIT_TOKEN` | Credenciales HTTPS para pull/push (fine-grained token con Contents:write) |
