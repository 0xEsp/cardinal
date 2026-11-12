// Operaciones de texto sobre documentos markdown: índice de secciones, lectura
// de una sección, ediciones parciales y diff por líneas. Existen para que un
// agente no tenga que leer ni reescribir un documento entero para cambiar un
// párrafo: el coste de escribir pasa a depender del cambio, no del documento.
// Son funciones puras (sin base de datos) para poder probarlas aisladas.

const fail = (status, message) => Object.assign(new Error(message), { status });

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePath = (value) => String(value || '').split('>').map(normalize).filter(Boolean).join(' > ');

/**
 * Secciones del documento según sus encabezados (ignora los que están dentro
 * de bloques de código). Cada sección llega hasta el siguiente encabezado de
 * su nivel o superior, así que incluye sus subsecciones.
 */
export function outline(content) {
  const text = String(content || '');
  const sections = [];
  let fence = null;
  let offset = 0;
  text.split('\n').forEach((line, index) => {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker === fence) fence = null;
    } else if (!fence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        sections.push({ level: heading[1].length, title: heading[2].replace(/[*_`]/g, '').trim(), line: index + 1, start: offset });
      }
    }
    offset += line.length + 1;
  });

  const stack = [];
  sections.forEach((section, index) => {
    const next = sections.slice(index + 1).find((other) => other.level <= section.level);
    section.end = next ? next.start : text.length;
    section.chars = section.end - section.start;
    while (stack.length && stack.at(-1).level >= section.level) stack.pop();
    section.path = [...stack.map((parent) => parent.title), section.title].join(' > ');
    stack.push(section);
  });
  return sections;
}

/**
 * Localiza una sección por su título o por su ruta ("Padre > Hija"). Si el
 * nombre es ambiguo falla enumerando las rutas posibles en vez de elegir una.
 */
export function findSection(content, name) {
  const sections = outline(content);
  const wanted = normalizePath(name);
  if (!wanted) throw fail(400, 'Indica el título de la sección');
  const paths = sections.map((section) => normalizePath(section.path));
  let matches = sections.filter((section, i) => normalize(section.title) === wanted || paths[i] === wanted);
  if (!matches.length) matches = sections.filter((section, i) => paths[i].endsWith(` > ${wanted}`) || normalize(section.title).includes(wanted));
  if (!matches.length) {
    const available = sections.filter((section) => section.level <= 2).slice(0, 30).map((section) => section.title).join(' | ');
    throw fail(404, `No existe la sección "${name}". Secciones principales: ${available || '(el documento no tiene encabezados)'}. Consulta doc_outline para verlas todas.`);
  }
  if (matches.length > 1) {
    throw fail(400, `"${name}" coincide con varias secciones; usa la ruta completa: ${matches.map((section) => section.path).join(' | ')}`);
  }
  return matches[0];
}

export function readSection(content, name) {
  const section = findSection(content, name);
  return String(content).slice(section.start, section.end);
}

function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * Aplica ediciones en orden sobre el contenido. Tres formas:
 *   { old_string, new_string, replace_all? }  sustituye un fragmento exacto
 *   { section, content }                      sustituye una sección entera (encabezado incluido)
 *   { append }                                añade texto al final del documento
 * Es todo o nada: si una edición no encaja, falla y no se aplica ninguna.
 */
export function applyEdits(content, edits) {
  if (!Array.isArray(edits) || !edits.length) throw fail(400, 'edits debe ser una lista con al menos una edición');
  let text = String(content ?? '');
  edits.forEach((edit, index) => {
    const where = `Edición ${index + 1}`;
    if (!edit || typeof edit !== 'object') throw fail(400, `${where}: formato inválido`);

    if (typeof edit.old_string === 'string') {
      const next = String(edit.new_string ?? '');
      if (!edit.old_string) throw fail(400, `${where}: old_string está vacío; para añadir texto usa append o una sección`);
      if (edit.old_string === next) throw fail(400, `${where}: old_string y new_string son iguales`);
      const count = countOccurrences(text, edit.old_string);
      if (!count) {
        throw fail(400, `${where}: old_string no aparece en el documento. Debe coincidir carácter a carácter (espacios y saltos de línea incluidos); vuelve a leer esa sección y cópialo tal cual.`);
      }
      if (count > 1 && !edit.replace_all) {
        throw fail(400, `${where}: old_string aparece ${count} veces. Añade contexto para que sea único o usa replace_all.`);
      }
      text = edit.replace_all ? text.split(edit.old_string).join(next) : text.replace(edit.old_string, () => next);
    } else if (typeof edit.section === 'string') {
      if (typeof edit.content !== 'string') throw fail(400, `${where}: falta content con el nuevo texto de la sección`);
      const section = findSection(text, edit.section);
      const body = edit.content.trim();
      // Se conserva una línea en blanco de separación con la sección siguiente.
      const replacement = body ? `${body}\n${section.end < text.length ? '\n' : ''}` : '';
      text = text.slice(0, section.start) + replacement + text.slice(section.end);
    } else if (typeof edit.append === 'string') {
      if (!edit.append.trim()) throw fail(400, `${where}: append está vacío`);
      text = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${edit.append.trim()}\n`;
    } else {
      throw fail(400, `${where}: usa old_string + new_string, section + content o append`);
    }
  });
  return text;
}

// Por encima de este tamaño de la zona distinta no se calcula el diff fino
// (la tabla de programación dinámica crecería demasiado): se da por sustituida entera.
const MAX_DIFF_CELLS = 4_000_000;

function diffOps(a, b) {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const ops = a.slice(0, prefix).map((line) => [' ', line]);

  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_DIFF_CELLS) {
    midA.forEach((line) => ops.push(['-', line]));
    midB.forEach((line) => ops.push(['+', line]));
  } else if (n || m) {
    // Subsecuencia común más larga; solo sobre la zona que difiere.
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push([' ', midA[i]]); i += 1; j += 1; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push(['-', midA[i]]); i += 1; }
      else { ops.push(['+', midB[j]]); j += 1; }
    }
    while (i < n) { ops.push(['-', midA[i]]); i += 1; }
    while (j < m) { ops.push(['+', midB[j]]); j += 1; }
  }
  a.slice(a.length - suffix).forEach((line) => ops.push([' ', line]));
  return ops;
}

/**
 * Diff por líneas en formato unificado. changedLines son las líneas del texto
 * nuevo afectadas (para un borrado, la línea donde estaba lo que se quitó).
 */
export function diffLines(before, after, context = 3) {
  const ops = diffOps(String(before ?? '').split('\n'), String(after ?? '').split('\n'));
  let added = 0;
  let removed = 0;
  const changedLines = new Set();
  const rows = [];
  let oldLine = 1;
  let newLine = 1;
  for (const [type, line] of ops) {
    rows.push({ type, line, oldLine, newLine });
    if (type === '+') { added += 1; changedLines.add(newLine); newLine += 1; }
    else if (type === '-') { removed += 1; changedLines.add(newLine); oldLine += 1; }
    else { oldLine += 1; newLine += 1; }
  }

  const hunks = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type === ' ') { index += 1; continue; }
    const start = Math.max(0, index - context);
    let end = index;
    let lastChange = index;
    while (end < rows.length && end - lastChange <= context * 2) {
      if (rows[end].type !== ' ') lastChange = end;
      end += 1;
    }
    end = Math.min(rows.length, lastChange + context + 1);
    const slice = rows.slice(start, end);
    const oldCount = slice.filter((row) => row.type !== '+').length;
    const newCount = slice.filter((row) => row.type !== '-').length;
    hunks.push([`@@ -${slice[0].oldLine},${oldCount} +${slice[0].newLine},${newCount} @@`, ...slice.map((row) => `${row.type}${row.line}`)].join('\n'));
    index = end;
  }
  return { text: hunks.join('\n'), added, removed, changedLines: [...changedLines].sort((x, y) => x - y) };
}

/** Secciones más profundas del texto nuevo que contienen alguna línea cambiada. */
export function changedSections(after, changedLines) {
  const sections = outline(after);
  const picked = new Set();
  for (const line of changedLines) {
    let deepest = null;
    for (const section of sections) {
      if (section.line > line) break;
      const lastLine = section.line + String(after).slice(section.start, section.end).split('\n').length - 1;
      if (line <= lastLine) deepest = section;
    }
    if (deepest) picked.add(deepest);
  }
  return sections.filter((section) => picked.has(section)).map((section) => ({ ...section, text: String(after).slice(section.start, section.end) }));
}
