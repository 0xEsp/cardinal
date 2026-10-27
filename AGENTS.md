# AGENTS.md

Guía para agentes de IA. Cubre dos usos distintos:

1. **Trabajar en este repositorio** (cambiar el código de Cardinal).
2. **Usar Cardinal** desde otro proyecto, por MCP, para leer y escribir cards, docs y reglas.

Qué es Cardinal y cómo se usa como persona: [README.md](README.md). `CLAUDE.md` es un enlace a este fichero.

---

## 1. Trabajar en este repositorio

### Mapa del código

```
server/src/
  index.js          API HTTP (Express): proyectos, cards, docs/reglas, agentes, proveedores, MCP
  db.js             SQLite (node:sqlite), esquema base, sesiones y ejecuciones de agentes
  migrate.js        migraciones versionadas (PRAGMA user_version) con copia previa y verificación
  migrate-cli.js    ensayar (--dry-run) o aplicar migraciones sin arrancar el servidor
  projects.js       proyectos: stacks, columnas (con su agente) y ficheros de diseño
  cards.js          cards, stacks de la card, comentarios, manifiesto de diseño
  docs.js           docs (kind "doc") y reglas (kind "rule") versionados en documents/document_versions
  agent.js          ciclo de los agentes de Cardinal: sesiones por card y slot, validación, revisión, guardado
  prompt.js         prompt de sistema de cada agente a partir de las reglas del proyecto; herramientas por modo
  validation.js     validación estructural de definiciones, docs y manifiestos de diseño
  mcp.js            JSON-RPC MCP compartido + canal interno por card (solo loopback) para los CLIs
  mcp-agents.js     MCP externo en /mcp con tokens por proyecto y permiso
  providers/        OpenRouter, Codex y Claude (CLIs instalados en data/cli)
  paper.js, moki.js, design-tools.js, remote-mcp.js   herramientas de diseño por MCP
web/src/
  App.jsx           shell, carga de proyectos y rutas (router.js, rutas con hash)
  Sidebar.jsx       barra lateral con selector de proyecto
  Board.jsx, CardView.jsx, AgentPanel.jsx, DesignPanel.jsx, DocsView.jsx, RunsView.jsx,
  McpView.jsx, ProvidersView.jsx, ProjectSettings.jsx, NewProject.jsx, ProjectEditors.jsx
  ui.jsx            piezas compartidas del sistema de diseño (pegatinas, estados, etapas, markdown)
  styles.css        sistema de diseño completo (tokens en :root)
scripts/            build y despliegue en la Raspberry; puente MCP de Paper (paper-bridge/)
.agents/skills/     skills del proyecto (deploy-cardinal, moki, paper-bridge), enlazadas en .claude/.codex/.cursor
data/               base de datos y secretos locales: fuera de git, NO se edita a mano
```

### Comandos

```bash
cd server && npm install && npm run dev        # API en :4400 (node --watch)
cd web && npm install && npm run dev           # UI en :5173 con proxy a la API
cd web && npx vite build                       # comprobar que la UI compila
node server/src/migrate-cli.js --dry-run       # ensayar migraciones contra data/
docker build -t cardinal:test .                # imagen local para probar el contenedor
```

No hay suite de tests. Verifica levantando el servidor contra **una copia** de la base:

```bash
mkdir -p /tmp/cardinal-data && sqlite3 data/product-os.db ".backup '/tmp/cardinal-data/product-os.db'"
cd server && PORT=4499 PRODUCT_OS_DATA_DIR_OVERRIDE=/tmp/cardinal-data node src/index.js
```

y comprueba la API con `curl`, el MCP con peticiones JSON-RPC a `/mcp` y la interfaz en el navegador (escritorio y 375 px de ancho).

### Reglas

- **Los datos del usuario son lo primero.** Nunca edites `data/` ni borres bases o copias. Un cambio de esquema es **siempre una migración nueva** en `migrate.js`; nunca modifiques una ya publicada. Cada migración debe conservar todas las filas y el contenido (lo comprueba `verifyPreserved`): si transforma datos, añade su propia verificación antes del COMMIT. Ensáyala con `--dry-run` sobre una copia antes de darla por buena.
- **El diseño vive en Moki.** La interfaz se diseña en el fichero *Cardinal · Design* (una página por pantalla, componentes en `00 · Componentes`). Si cambias o añades una pantalla, actualiza también su diseño en Moki, reutilizando los componentes. Sigue el sistema de `styles.css`: papel `#F3EEE4`, tinta `#111`, bordes de 2 px, sombras duras, Space Grotesk y JetBrains Mono, y un solo momento de color por pantalla (bermellón para la acción principal, amarillo para el agente activo).
- **Pocas dependencias.** El servidor solo usa Express y `node:sqlite`; la web, React, `marked` y las fuentes locales. No añadas librerías para algo que se resuelve en unas líneas.
- **Nada específico de un proyecto en el código.** Lo propio de un producto (cómo se define una card, QA, guía de diseño, organización del fichero de diseño) va en las **reglas** de ese proyecto, no en `prompt.js` ni en la interfaz.
- **Secretos fuera de la base y de la API.** Van en `data/secrets/` (ficheros 0600) o en `.env`, y la API nunca los devuelve. Los tokens del MCP se guardan solo como hash.
- **Idioma.** Interfaz, mensajes de error, comentarios y commits en español. Los comentarios explican el porqué, no el qué.
- **Procesos manuales.** Nada de servicios del sistema (launchd y similares): el puente de Paper y los servidores de desarrollo se levantan a mano y se cierran con Ctrl+C.
- **Commits** con el formato `tipo(ámbito): resumen` (`feat`, `fix`, `docs`, `chore`…), en español.

### Despliegue

Usa la skill `deploy-cardinal` (`bash scripts/deploy-raspberry-image.sh`). El script ensaya las migraciones con la imagen nueva antes de activarla; si el ensayo falla, informa del error tal cual y no fuerces nada.

---

## 2. Usar Cardinal desde otro proyecto (MCP)

Si tienes conectado el servidor MCP `cardinal` (ver README), tienes acceso a las cards, docs y reglas de los proyectos que permita tu token.

### Modelo

- Un **proyecto** tiene un board de **cards**, **docs** (cómo funciona hoy el producto) y **reglas** (cómo se define, implementa, prueba y documenta).
- Una **card** tiene un **borrador** (la idea del usuario), una **Definición IA** (producto + técnica + QA, la fuente de verdad del comportamiento) y, opcionalmente, un **diseño** en Moki o Paper.
- La **columna** de la card indica su etapa. Las columnas y lo que significa cada una están en `list_projects`.

### Cómo trabajar

- **Empieza por `list_projects`** para conocer ids, stacks y columnas.
- **Para implementar una card**, pide `get_feature_prompt`: es la definición dentro de la plantilla del proyecto, con el diseño y cómo leerlo. Si el diseño y la definición discrepan en comportamiento, manda la definición. Lee también `read_rule` de los criterios de QA del stack (`qa-criteria-<stack>.md`).
- **Al terminar de implementar**, mueve la card a la columna de documentación con `move_card` si el usuario te lo pide, y deja constancia con `comment_card` (rama, PR, decisiones).
- **Antes de escribir un doc**, léelo con `read_doc` y envía el contenido completo con `write_doc`, conservando lo que no cambias. Explica el cambio en `note`. Sigue la regla `product-doc-guide.md` del proyecto.
- **Las reglas afectan a todos los agentes del proyecto.** Cambia una con `update_rule` solo si el usuario lo pide, y explica el cambio en `note`.
- **No inventes contexto.** Si un doc o una regla no cubre algo, dilo; no lo presentes como existente. Busca primero con `search_docs`.
- **Comentarios con autor.** Todo lo que escribes queda firmado con el nombre de tu token: escribe como lo haría un compañero del equipo.
