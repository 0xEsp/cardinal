# JustGame · Product OS

Sistema operativo de producto para JustGame: un dashboard local (kanban + agentes de IA + documentación) donde las cards y la documentación de producto viven como ficheros markdown versionados en git.

## Cómo funciona

```
os/               ← las "reglas": cómo se define una card, criterios de QA, guía de documentación
workspace/cards/  ← cada card es un .md (frontmatter = propiedades, cuerpo = borrador + definición IA)
workspace/docs/   ← documentación de producto (la fuente de verdad de cómo funciona JustGame)
server/           ← API Node/Express + agente OpenRouter (streaming SSE + tool-use)
web/              ← dashboard React (kanban, modal de card, consola de agente, visor de docs)
```

El flujo:

1. Creas una card en el board y escribes tu **borrador** con tus palabras.
2. Botón **▶ Definir card**: un agente (OpenRouter) coge el borrador + las reglas de `os/` + la documentación existente y genera la **definición completa** (producto + técnica + QA). Tu borrador nunca se toca. Puedes seguir iterando con el agente por chat.
3. Te llevas esa definición al proyecto de turno (app/web/backend) y se la das a tu feature-builder.
4. Cuando el desarrollo termina, mueves la card a **Done Dev** y lanzas el agente de nuevo: ahora en **modo documentación** — crea o actualiza los `.md` de `workspace/docs/`.
5. Push desde el dashboard (o `AUTO_PUSH=true`) para dejar el remoto al día.

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
