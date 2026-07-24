import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..', '..');
export const OS_DIR = path.join(ROOT, 'os');
export const DOCS_DIR = path.join(ROOT, 'workspace', 'docs');
export const DATA_DIR = path.join(ROOT, 'data');
