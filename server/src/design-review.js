// Reparto de un manifiesto de diseño en bloques para revisarlo por partes.
// Un revisor inspecciona cada artboard con capturas, así que el tiempo crece
// con el número de artboards: una card grande no cabía en el límite de una
// llamada (15 min) y, al no poder aprobarse entera, no se podía guardar.
// Funciones puras, sin base de datos ni proveedores, para probarlas aisladas.

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Palabras que distinguen las variantes de un mismo estado (pareja desktop +
// responsive, iOS + Android). Al quitarlas, las variantes comparten clave y
// caen en el mismo bloque: el revisor las compara entre sí.
const VARIANT_WORDS = /\b(ios|android|web|desktop|responsive|native|nativo|app|mobile|movil|escritorio)\b/g;

const familyOf = (artboard) => {
  const platform = String(artboard?.platform || '');
  if (!platform) return 'otros';
  return platform.startsWith('web') ? 'web' : 'apps';
};

export const variantKey = (artboard) =>
  normalize(artboard?.name).replace(VARIANT_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Divide los artboards en bloques de como mucho `size`, primero por familia
 * (apps, web) y sin separar las variantes de un mismo estado. Los bloques de
 * una familia quedan equilibrados en lugar de dejar un resto pequeño.
 */
export function splitDesignBlocks(artboards, size) {
  const list = Array.isArray(artboards) ? artboards : [];
  if (list.length <= size) return [{ label: 'completo', artboards: list }];

  const blocks = [];
  for (const family of ['apps', 'web', 'otros']) {
    const members = list
      .map((artboard, index) => ({ artboard, index, key: variantKey(artboard) }))
      .filter((item) => familyOf(item.artboard) === family)
      .sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);
    if (!members.length) continue;

    const count = Math.ceil(members.length / size);
    const target = Math.ceil(members.length / count);
    const chunks = [[]];
    let position = 0;
    while (position < members.length) {
      let end = position + 1;
      while (end < members.length && members[end].key === members[position].key) end += 1;
      const unit = members.slice(position, end);
      const current = chunks.at(-1);
      // Se abre bloque nuevo si el grupo de variantes no cabe; un grupo mayor
      // que el bloque entero se parte, porque no hay otra forma de acotarlo.
      if (current.length && current.length + unit.length > target && chunks.length < count) chunks.push([]);
      for (const item of unit) {
        if (chunks.at(-1).length >= size) chunks.push([]);
        chunks.at(-1).push(item);
      }
      position = end;
    }
    chunks.filter((chunk) => chunk.length).forEach((chunk, index, all) => {
      blocks.push({ label: all.length > 1 ? `${family} ${index + 1}/${all.length}` : family, artboards: chunk.map((item) => item.artboard) });
    });
  }
  return blocks;
}

/** El manifiesto sin detalles de inspección: lo que necesita quien revisa la cobertura. */
export function manifestOverview(manifest) {
  const artboards = Array.isArray(manifest?.artboards) ? manifest.artboards : [];
  return artboards
    .map((artboard) => `- ${artboard.name} [${artboard.platform || 'sin plataforma'}]${artboard.pageId ? ` (página ${artboard.pageId})` : ''}: ${(artboard.covers || []).join('; ')}`)
    .join('\n');
}

/** Ejecuta como mucho `limit` tareas a la vez; el resto espera en cola. */
export function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}
