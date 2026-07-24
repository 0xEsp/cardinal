import fs from 'node:fs';
import path from 'node:path';
import { OS_DIR } from './paths.js';
import { listDocs } from './docs.js';

function osFile(name) {
  const file = path.join(OS_DIR, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function modeForColumn(column) {
  if (column === 'done-dev') return 'document';
  if (column === 'done') return null;
  return 'define';
}

export function buildSystemPrompt(mode, card) {
  const sections = [];

  if (mode === 'define') {
    sections.push(osFile('agent-define.md'));
    sections.push('# Referencia: card-definition.md\n\n' + osFile('card-definition.md'));
    sections.push('# Referencia: tech-definition.md\n\n' + osFile('tech-definition.md'));
    const stackNames = card.stacks.length ? card.stacks.map((s) => s.name) : ['app', 'web', 'backend'];
    for (const s of stackNames) {
      const qa = osFile(`qa-criteria-${s}.md`);
      if (qa) sections.push(`# Referencia: qa-criteria-${s}.md\n\n` + qa);
    }
  } else {
    sections.push(osFile('agent-document.md'));
    sections.push('# Referencia: product-doc-guide.md\n\n' + osFile('product-doc-guide.md'));
  }

  const docs = listDocs();
  sections.push(
    '# Documentación de producto existente (workspace/docs/)\n\n' +
      (docs.length ? docs.map((d) => `- ${d.path} — ${d.title}`).join('\n') : '(aún no hay documentos)')
  );

  const props = `stacks: ${formatStacks(card)} · columna: ${card.column}`;
  if (mode === 'define') {
    sections.push(`# Card a definir\n\nTítulo: ${card.title}\nPropiedades: ${props}\n\n## Borrador de Manu\n\n${card.draft || '(borrador vacío)'}`);
  } else {
    sections.push(
      `# Card desarrollada (a documentar)\n\nTítulo: ${card.title}\nPropiedades: ${props}\n\n## Definición\n\n${card.definition || card.draft || '(sin definición)'}`
    );
  }

  return sections.filter(Boolean).join('\n\n---\n\n');
}

export function formatStacks(card) {
  if (!card.stacks.length) return 'sin asignar';
  return card.stacks.map((s) => (s.version ? `${s.name} (v${s.version})` : s.name)).join(', ');
}

// Prompt listo para pegar en el feature-builder del proyecto de destino.
// Plantilla editable en os/feature-prompt.md con {{title}}, {{stacks}}, {{definition}}.
export function buildFeaturePrompt(card) {
  if (!card.definition) throw Object.assign(new Error('La card aún no tiene definición generada'), { status: 400 });
  const template =
    osFile('feature-prompt.md') ||
    '# {{title}}\n\nStacks implicados: {{stacks}}\n\n---\n\n{{definition}}';
  return template
    .replaceAll('{{title}}', card.title)
    .replaceAll('{{stacks}}', formatStacks(card))
    .replaceAll('{{definition}}', card.definition);
}

export function toolsForMode(mode) {
  const listDocsTool = {
    type: 'function',
    function: {
      name: 'list_docs',
      description: 'Lista los documentos de producto existentes en workspace/docs/',
      parameters: { type: 'object', properties: {} },
    },
  };
  const readDocTool = {
    type: 'function',
    function: {
      name: 'read_doc',
      description: 'Lee el contenido completo de un documento de producto existente',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Ruta relativa dentro de workspace/docs/, p. ej. "coleccion.md"' } },
        required: ['path'],
      },
    },
  };
  if (mode === 'define') {
    return [
      listDocsTool,
      readDocTool,
      {
        type: 'function',
        function: {
          name: 'save_definition',
          description:
            'Guarda la definición completa de la card (markdown). Sobreescribe la definición anterior si existía. No toca el borrador.',
          parameters: {
            type: 'object',
            properties: { content: { type: 'string', description: 'Definición completa en markdown' } },
            required: ['content'],
          },
        },
      },
    ];
  }
  return [
    listDocsTool,
    readDocTool,
    {
      type: 'function',
      function: {
        name: 'save_doc',
        description:
          'Guarda (crea o sobreescribe) un documento de producto en workspace/docs/. Para actualizar uno existente, léelo antes con read_doc y guarda el contenido completo integrando los cambios.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta relativa del .md dentro de workspace/docs/' },
            content: { type: 'string', description: 'Contenido completo del documento en markdown' },
          },
          required: ['path', 'content'],
        },
      },
    },
  ];
}
