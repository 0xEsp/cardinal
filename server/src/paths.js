import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..', '..');
// El override permite arrancar una instancia de pruebas sin tocar data/.
export const DATA_DIR = process.env.PRODUCT_OS_DATA_DIR_OVERRIDE || path.join(ROOT, 'data');

// Docs y reglas viven en la SQLite. Estos directorios solo se leen una vez, en
// la migración v1, para importar lo que antes estaba versionado en git.
export const LEGACY_DOCS_DIR = process.env.CARDINAL_LEGACY_DOCS_DIR || path.join(ROOT, 'workspace', 'docs');
export const LEGACY_RULES_DIR = process.env.CARDINAL_LEGACY_RULES_DIR || path.join(ROOT, 'os');

// Todo lo que deben conservar los proveedores vive en el volumen de datos:
// así sobrevive a nuevas imágenes y no hay que redesplegar para actualizarlo.
export const CLI_DIR = path.join(DATA_DIR, 'cli');
export const SECRETS_DIR = path.join(DATA_DIR, 'secrets');
export const CODEX_HOME = path.join(DATA_DIR, 'codex');
export const CLAUDE_CONFIG_DIR = path.join(DATA_DIR, 'claude');
export const AGENT_WORK_DIR = path.join(DATA_DIR, 'agent-work');
