# JustGame · Product OS

Sistema operativo de producto para JustGame: un dashboard local (kanban + agentes de IA + documentación) con las cards en SQLite y la documentación de producto como markdown versionado en git.

## Cómo funciona

```
os/               ← las "reglas": cómo se define una card, criterios de QA, guía de documentación,
                    plantilla del prompt para el feature-builder (feature-prompt.md)
workspace/docs/   ← documentación de producto en .md (la fuente de verdad, versionada en git)
data/             ← SQLite (cards + sesiones de agente; fuera de git, volumen en Docker)
server/           ← API Node/Express + agente OpenRouter (streaming SSE + tool-use)
web/              ← dashboard React (kanban, modal de card, consola de agente, visor de docs)
```

Las **cards viven en SQLite** (propiedades, borrador, definición, sesiones de agente) usando el `node:sqlite` nativo de Node 22 — sin dependencias compiladas. La **documentación de producto sigue siendo markdown en git**, que es lo que consumen los agentes y lo que migras desde Notion.

El flujo:

1. Creas una card en el board y escribes tu **borrador** con tus palabras.
2. Botón **▶ Definir card**: un agente (OpenRouter) coge el borrador + las reglas de `os/` + la documentación existente y genera la **definición completa** (producto + técnica + QA). Tu borrador nunca se toca. Puedes seguir iterando con el agente por chat.
3. Botón **⧉ Copiar como prompt** en la pestaña Definición: copia la definición envuelta en la plantilla `os/feature-prompt.md`, lista para pegar en el feature-builder del proyecto de turno.
4. Cuando el desarrollo termina, mueves la card a **Done Dev** y lanzas el agente de nuevo: ahora en **modo documentación** — crea o actualiza los `.md` de `workspace/docs/`.
5. Mueves la card a **Done** para archivarla: la columna Done siempre se muestra vacía (es un sumidero); con "ver done (N)" del filtro puedes consultar las archivadas, también filtradas por stack/versión.
6. Push desde el dashboard (o `AUTO_PUSH=true`) commitea `workspace/` + `os/` y sube al remoto.

Cada card puede tocar varios **stacks (app/web/backend) y cada stack lleva su propia versión**; el board se filtra por ambos.

El **modo del agente lo decide la columna**: `backlog/todo/in-progress` → definir · `done-dev` → documentar · `done` → nada.

## Arranque en local

```bash
cp .env.example .env   # y pon tu OPENROUTER_API_KEY

cd server && npm install && npm run dev   # API en :4400
cd web && npm install && npm run dev      # UI en :5173 (proxy a la API)
```

Para producción: `cd web && npm run build` y el server sirve el build en `http://localhost:4400`.

## En la Raspberry (Docker)

```bash
cp .env.example .env   # con tu API key
docker compose up -d --build
```

Dashboard en `http://<ip-de-la-raspberry>:4400`, accesible desde móvil u ordenador en la misma red. El `workspace/`, el `os/` y el `.git` se montan como volúmenes: los datos sobreviven a rebuilds y el push funciona con las credenciales del host.

## Migrar la documentación de Notion

Exporta tus páginas de Notion como markdown y déjalas en `workspace/docs/` (kebab-case, un fichero por flujo). Aparecerán en la pestaña Docs y los agentes las tendrán en cuenta al definir y documentar.

## Configuración (.env)

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter (obligatoria para los agentes) |
| `OPENROUTER_MODEL` | Modelo por defecto |
| `MODELS` | Modelos del selector, separados por coma |
| `PORT` | Puerto del servidor (4400) |
| `AUTO_PUSH` | `true` → commit+push automático del workspace al terminar un agente |
| `GIT_USERNAME` / `GIT_TOKEN` | Credenciales HTTPS para pull/push (fine-grained token con Contents:write) |
