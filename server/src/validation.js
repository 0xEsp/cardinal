function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function headings(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1])
    .filter(Boolean)
    .map(normalize);
}

function hasHeading(allHeadings, alternatives) {
  return alternatives.some((alternative) => allHeadings.some((heading) => heading.includes(normalize(alternative))));
}

function result(errors = [], warnings = []) {
  return { ok: errors.length === 0, errors, warnings };
}

export function validateDefinition(content) {
  const value = String(content || '').trim();
  const allHeadings = headings(value);
  const errors = [];
  const warnings = [];
  const required = [
    ['Contexto', ['contexto']],
    ['Comportamiento esperado', ['comportamiento esperado']],
    ['Casuísticas', ['casuisticas']],
    ['Definición técnica', ['definicion tecnica']],
    ['Cómo probarlo', ['como probarlo']],
    ['Fuera de alcance', ['fuera de alcance']],
  ];

  if (!value) errors.push('La definición está vacía.');
  for (const [label, alternatives] of required) {
    if (!hasHeading(allHeadings, alternatives)) errors.push(`Falta la sección "${label}".`);
  }
  if (value.length < 500) warnings.push('La definición parece demasiado breve para cubrir el contrato completo de una card.');
  if (!/\b(app|web|backend)\b/i.test(value)) warnings.push('No se identifica claramente el stack afectado.');

  return result(errors, warnings);
}

export function validateDocument(content) {
  const value = String(content || '').trim();
  const allHeadings = headings(value);
  const errors = [];
  const warnings = [];

  if (!/^#\s+.+/m.test(value)) errors.push('El documento necesita un título principal de Markdown (# Título).');
  if (!hasHeading(allHeadings, ['comportamiento'])) errors.push('Falta la sección "Comportamiento".');
  if (!hasHeading(allHeadings, ['casuisticas'])) errors.push('Falta la sección "Casuísticas".');
  if (!hasHeading(allHeadings, ['historial'])) errors.push('Falta la sección "Historial".');
  if (!/(^|\n)\s*-\s*\d{4}-\d{2}-\d{2}\s*:/m.test(value)) {
    errors.push('El historial debe contener al menos una entrada fechada con formato YYYY-MM-DD.');
  }
  if (value.length < 300) warnings.push('El documento parece demasiado breve para explicar un flujo de producto completo.');

  return result(errors, warnings);
}

export function formatValidation(validation) {
  const lines = [];
  if (validation.ok) lines.push('Validación estructural correcta.');
  if (validation.errors.length) lines.push(`Errores: ${validation.errors.join(' ')}`);
  if (validation.warnings.length) lines.push(`Avisos: ${validation.warnings.join(' ')}`);
  return lines.join('\n');
}
