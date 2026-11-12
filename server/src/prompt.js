import { listDocs, readRule } from './docs.js';
import { getDesignTool } from './design-tools.js';
import { columnOf, getProject } from './projects.js';

/** Agente que toca según la columna de la card (configurable por proyecto). */
export function modeForColumn(card) {
  return columnOf(getProject(card.projectId), card.column)?.mode ?? null;
}

const PLATFORM_LABEL = {
  ios: 'App · iOS',
  android: 'App · Android',
  'web-desktop': 'Web · desktop',
  'web-responsive': 'Web · responsive',
  app: 'App',
  web: 'Web',
};

/**
 * Markdown del diseño de la card (manifiesto). Lo usan los agentes y el
 * prompt final para el feature-builder.
 */
export function formatDesign(card, { forBuilder = false } = {}) {
  const design = card.design;
  if (!design) return '';
  const label = getDesignTool(design.tool).label;
  const lines = [
    `## Diseño (${label})`,
    '',
    `- Fichero: ${design.fileName || `Diseño de ${getProject(card.projectId).name}`} (\`fileId: ${design.fileId}\`)`,
    `- Página: [${design.pageName || design.pageId}](${design.pageUrl}) (\`pageId: ${design.pageId}\`)`,
  ];
  if (card.designStatus === 'stale') {
    lines.push('- ⚠ Este diseño se aprobó con una versión anterior de la definición. Si hay conflicto, manda la definición.');
  }
  if (design.promotedAt) lines.push(`- Promocionado a las páginas canónicas el ${design.promotedAt.slice(0, 10)}.`);
  lines.push('', '| Artboard | id | Plataforma | Cubre |', '|---|---|---|---|');
  for (const artboard of design.artboards) {
    const name = artboard.pageUrl ? `[${artboard.name}](${artboard.pageUrl})` : artboard.name;
    lines.push(`| ${name} | \`${artboard.id}\` | ${PLATFORM_LABEL[artboard.platform] || '—'} | ${artboard.covers.join('; ')} |`);
  }
  if (design.notes) lines.push('', `Notas de diseño: ${design.notes}`);
  if (forBuilder) {
    lines.push(
      '',
      `Conéctate al MCP de ${label} (\`${design.tool}\`) y trabaja sobre estos artboards (\`fileId\` y los \`id\` de la tabla):`,
      '- Obtén estructura y valores exactos con `get_jsx` y `get_computed_styles`; mapea cada valor a los tokens y componentes del proyecto, nunca a valores hardcodeados.',
      '- Usa `get_screenshot` solo para verificar visualmente tu implementación, no como fuente de medidas.',
      '- Si el diseño y la definición discrepan en comportamiento, manda la definición.',
    );
  }
  return lines.join('\n');
}

// Lo que cambia entre herramientas de diseño; las reglas de os/ son comunes.
const DESIGN_TOOL_NOTES = {
  paper: [
    '- Infraestructura: Paper solo es accesible a través del puente que corre en el Mac de Manu con la app de Paper abierta. Si las herramientas `paper` fallan por conexión, detente y explica que hay que levantar el puente (`node scripts/paper-bridge/paper-bridge.mjs`) y abrir Paper.',
    '- Reutilización: clona masters y patrones con `<x-paper-clone node-id="…">` dentro de `write_html`. Paper no vincula los clones como instancias: nunca modifiques un master para adaptar un caso concreto.',
    '- Paper no permite borrar páginas por MCP.',
  ],
  moki: [
    '- Infraestructura: Moki es un servidor siempre encendido en la red local (Mac mini). Si las herramientas `moki` fallan por conexión o por token, detente y explícalo: no hay nada que levantar a mano.',
    '- Lee una vez su guía de uso con `get_guide({ topic: "moki-mcp-instructions" })` antes de pintar, salvo la parte de brief y paleta: el sistema de diseño del proyecto ya está decidido.',
    '- Componentes (obligatorio): todo elemento de UI que exista en `list_components` se coloca como instancia (`create_instance` o `<x-moki-instance component-id="…">`) y se personaliza con overrides (`set_text_content`, `update_styles` sobre `<instanceId>::<capa>`). Nunca lo clones con `<x-moki-clone>`, ni lo rehagas a mano, ni lo desvincules. Elige la variante cuyo nombre y estructura encajan (p. ej. `Button/web/primary · icono + texto`); si ninguna encaja del todo, usa la más cercana y anótalo en `notes`. Nunca edites un componente principal existente.',
    '- Componente nuevo: si la card necesita UI que no existe como componente y se repite o es reutilizable, constrúyelo una vez en un artboard `Components · <card>` de la página de la card, conviértelo con `create_component` (con el mismo esquema de nombres que los componentes existentes del fichero) y úsalo como instancias en los artboards. Si ya pintaste copias a mano, conviértelas con `convert_to_instances` (primero con `dryRun`). Solo puedes crear componentes en la página de la card; al promocionar pasan a la página de componentes que indique la guía de diseño. Anota en `notes` cada componente nuevo y su propósito.',
    '- Moki no permite borrar páginas por MCP.',
  ],
};

function designToolSection(design, access, projectName) {
  if (!design) return '';
  const tool = getDesignTool(design.tool);
  const intro = access === 'write'
    ? `Tienes acceso de lectura y escritura a ${tool.label} mediante las herramientas MCP \`${tool.id}\`.`
    : `Tienes acceso de solo lectura a ${tool.label} mediante las herramientas MCP \`${tool.id}\`.`;
  return [
    `# Herramienta de diseño: ${tool.label}`,
    '',
    intro,
    `- Fichero de diseño de ${projectName}: ${design.fileName || '(sin nombre)'} — \`fileId: ${design.fileId}\`. Pasa siempre este fileId a las herramientas que lo acepten.`,
    `- ${tool.label} es la fuente de diseño de esta card y refleja el producto actual. La organización de páginas, componentes y patrones está en la guía de diseño del proyecto.`,
    '- Empieza con `get_basic_info` para ver páginas, artboards y tokens; usa `find_nodes`, `get_tree_summary` y `get_screenshot` para entender los flujos existentes.',
    ...(access === 'write' ? DESIGN_TOOL_NOTES[tool.id] : []),
  ].join('\n');
}

/**
 * design: { tool, fileId, fileName } de la herramienta que usa el agente, o null
 * si no tiene acceso a diseños.
 */
export function buildSystemPrompt(mode, card, { design = null, task = 'design' } = {}) {
  const project = getProject(card.projectId);
  const osFile = (name) => readRule(project.id, name);
  const sections = [
    `# Proyecto: ${project.name}\n\nTrabajas dentro de Cardinal sobre el proyecto "${project.name}" (id \`${project.id}\`). Sus stacks son: ${project.stacks.join(', ')}. Todo lo que leas o guardes (docs, definición, diseño) pertenece a este proyecto.`,
  ];

  if (mode === 'design') {
    sections.push(osFile('agent-design.md'));
    sections.push('# Referencia: design-guide.md\n\n' + osFile('design-guide.md'));
    sections.push(designToolSection(design, 'write', project.name));
    sections.push(`# Tarea de este agente: ${task}`);
  } else if (mode === 'define') {
    sections.push(osFile('agent-define.md'));
    sections.push('# Referencia: card-definition.md\n\n' + osFile('card-definition.md'));
    sections.push('# Referencia: tech-definition.md\n\n' + osFile('tech-definition.md'));
    const stackNames = card.stacks.length ? card.stacks.map((s) => s.name) : project.stacks;
    for (const s of stackNames) {
      const qa = osFile(`qa-criteria-${s}.md`);
      if (qa) sections.push(`# Referencia: qa-criteria-${s}.md\n\n` + qa);
    }
    if (design) {
      sections.push(`${designToolSection(design, 'read', project.name)}\n- Consulta los diseños de los flujos que toca la card para que la definición sea coherente con la UI real (pantallas, estados y componentes existentes). No puedes modificar ${getDesignTool(design.tool).label} desde este agente.`);
    }
  } else {
    sections.push(osFile('agent-document.md'));
    sections.push('# Referencia: product-doc-guide.md\n\n' + osFile('product-doc-guide.md'));
  }

  const docs = listDocs(project.id);
  sections.push(
    `# Documentación de producto existente de ${project.name}\n\n` +
      (docs.length ? docs.map((d) => `- ${d.path} — ${d.title} (${d.chars} car.)`).join('\n') : '(aún no hay documentos)')
  );
  sections.push(
    '# Investigación obligatoria\n\n' +
      'La lista anterior solo sirve como índice. Antes de definir o documentar, usa `search_docs` con conceptos del borrador o de la Definición IA + y después `read_doc` sobre cada documento relevante. No uses comentarios de la card como contexto de trabajo.\n\n' +
      'Lee solo lo que necesitas: en documentos de más de unos 15.000 caracteres consulta `doc_outline` y lee con `read_doc` + `section` las secciones que te afectan (search_docs indica en qué sección aparece cada resultado), en lugar del documento entero.'
  );
  if (mode === 'document') {
    sections.push(
      '# Cómo se escribe un documento\n\n' +
        '- **Documento existente:** modifícalo con `edit_doc`, enviando solo los fragmentos o secciones que cambian. Nunca lo reescribas entero ni reenvíes su contenido: Cardinal conserva el borrador con tus ediciones.\n' +
        '- **Documento nuevo:** pasa su contenido completo a `review_doc` (una sola vez).\n' +
        '- **Revisar y guardar:** `review_doc` con la ruta revisa el borrador; si pide cambios, corrígelos con `edit_doc` y vuelve a revisar. Cuando esté aprobado, `save_doc` con la ruta lo guarda tal cual.'
    );
  }

  const props = `stacks: ${formatStacks(card)} · columna: ${card.column}`;
  if (mode === 'define') {
    sections.push(`# Card a definir\n\nTítulo: ${card.title}\nPropiedades: ${props}\n\n## Borrador\n\n${card.draft || '(borrador vacío)'}`);
  } else if (mode === 'design') {
    sections.push(
      `# Card a diseñar\n\nTítulo: ${card.title}\nId de la card: ${card.id}\nPropiedades: ${props}\n\n## Definición IA + (fuente de verdad del comportamiento)\n\n${card.definition || '(sin definición)'}\n\n` +
        (card.design ? `# Diseño actual de la card (manifiesto guardado)\n\n${formatDesign(card)}` : '# Diseño actual de la card\n\n(La card todavía no tiene diseño.)')
    );
  } else {
    sections.push(
      `# Card desarrollada (a documentar)\n\nTítulo: ${card.title}\nPropiedades: ${props}\nFecha de documentación: ${new Date().toISOString().slice(0, 10)}\n\n## Definición IA +\n\n${card.definition || '(sin definición)'}` +
        (card.design ? `\n\n${formatDesign(card)}\n\nEnlaza la página de ${getDesignTool(card.design.tool).label} en la documentación del flujo afectado.` : '')
    );
  }

  return sections.filter(Boolean).join('\n\n---\n\n');
}

export function formatStacks(card) {
  if (!card.stacks.length) return 'sin asignar';
  return card.stacks.map((s) => (s.version ? `${s.name} (v${s.version})` : s.name)).join(', ');
}

// Prompt listo para pegar en el feature-builder del proyecto de destino.
// Plantilla editable en la regla feature-prompt.md del proyecto con {{title}}, {{stacks}},
// {{definition}} y {{designs}} (enlaces e ids de Paper o Moki; vacío si no hay diseño).
export function buildFeaturePrompt(card) {
  if (!card.definition) throw Object.assign(new Error('La card aún no tiene definición generada'), { status: 400 });
  const template =
    readRule(card.projectId, 'feature-prompt.md') ||
    '# {{title}}\n\nStacks implicados: {{stacks}}\n\n---\n\n{{definition}}\n\n{{designs}}';
  const designs = formatDesign(card, { forBuilder: true });
  const prompt = template
    .replaceAll('{{title}}', card.title)
    .replaceAll('{{stacks}}', formatStacks(card))
    .replaceAll('{{definition}}', card.definition)
    .replaceAll('{{designs}}', designs);
  // Una plantilla antigua sin {{designs}} no debe perder los enlaces.
  return template.includes('{{designs}}') || !designs ? prompt.trimEnd() + '\n' : `${prompt.trimEnd()}\n\n${designs}\n`;
}

// Compartido con el MCP externo: las dos puertas editan documentos igual.
export const EDITS_SCHEMA = {
  type: 'array',
  minItems: 1,
  description:
    'Ediciones que se aplican en orden; si una no encaja no se aplica ninguna. Cada una es UNA de estas formas: ' +
    '{old_string, new_string} sustituye un fragmento exacto (debe ser único; añade contexto o usa replace_all); ' +
    '{section, content} sustituye una sección entera, encabezado incluido (content vacío la elimina); ' +
    '{append} añade texto al final del documento.',
  items: {
    type: 'object',
    properties: {
      old_string: { type: 'string', description: 'Texto actual a sustituir, copiado carácter a carácter' },
      new_string: { type: 'string', description: 'Texto que lo reemplaza' },
      replace_all: { type: 'boolean', description: 'Sustituir todas las apariciones de old_string' },
      section: { type: 'string', description: 'Título de la sección a sustituir, o su ruta "Padre > Hija" si el título se repite' },
      content: { type: 'string', description: 'Nuevo texto completo de la sección, empezando por su encabezado' },
      append: { type: 'string', description: 'Texto a añadir al final del documento' },
    },
  },
};

export function toolsForMode(mode) {
  const listDocsTool = {
    type: 'function',
    function: {
      name: 'list_docs',
      description: 'Lista los documentos de producto existentes del proyecto',
      parameters: { type: 'object', properties: {} },
    },
  };
  const readDocTool = {
    type: 'function',
    function: {
      name: 'read_doc',
      description:
        'Lee un documento de producto. Con section devuelve solo esa sección (y sus subsecciones): úsalo en documentos grandes, tras consultar doc_outline o search_docs, en vez de leerlos enteros.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta del documento dentro del proyecto, p. ej. "coleccion.md"' },
          section: { type: 'string', description: 'Título de la sección a leer, o su ruta "Padre > Hija" (opcional)' },
        },
        required: ['path'],
      },
    },
  };
  const docOutlineTool = {
    type: 'function',
    function: {
      name: 'doc_outline',
      description: 'Índice de un documento: sus secciones con el tamaño de cada una. Sirve para decidir qué secciones leer o editar sin traer el documento entero.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Ruta del documento dentro del proyecto' } },
        required: ['path'],
      },
    },
  };
  const searchDocsTool = {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        'Busca términos o conceptos en el contenido completo de los docs del proyecto. Devuelve los documentos relevantes, la sección donde aparecen y un fragmento, para decidir qué leer con read_doc.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Términos de producto que quieres localizar, por ejemplo "colección plataformas"' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de resultados (por defecto 8)' },
        },
        required: ['query'],
      },
    },
  };
  const reviewDefinitionTool = {
    type: 'function',
    function: {
      name: 'review_definition',
      description:
        'Ejecuta una revisión estructural y semántica independiente de una definición candidata. Es obligatorio usarla antes de save_definition; no guarda nada.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Definición completa candidata en markdown' } },
        required: ['content'],
      },
    },
  };
  const saveDefinitionTool = {
    type: 'function',
    function: {
      name: 'save_definition',
      description:
        'Guarda la definición completa de la card (markdown). Solo funciona después de que review_definition haya aprobado exactamente este contenido. Sobreescribe la definición anterior si existía y no toca el borrador.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Definición completa en markdown' } },
        required: ['content'],
      },
    },
  };

  if (mode === 'design') {
    const manifestSchema = {
      type: 'object',
      description: 'Manifiesto del diseño: qué artboards de la herramienta de diseño cubren qué casuísticas de la definición.',
      properties: {
        fileId: { type: 'string', description: 'Id del fichero de diseño' },
        fileName: { type: 'string' },
        pageId: { type: 'string', description: 'Id de la página de la card en la herramienta de diseño (o la canónica tras promocionar)' },
        pageName: { type: 'string' },
        artboards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Id del artboard en la herramienta de diseño' },
              name: { type: 'string', description: 'Nombre del artboard según design-guide.md (Native <feature> / <estado> / <iOS|Android> o Web desktop|Web responsive / <flujo> / <estado>)' },
              platform: { type: 'string', enum: ['ios', 'android', 'web-desktop', 'web-responsive'] },
              covers: { type: 'array', items: { type: 'string' }, description: 'Casuísticas o comportamientos de la definición que representa' },
              pageId: { type: 'string', description: 'Página de la feature donde vive el artboard tras promocionar' },
            },
            required: ['id', 'name', 'covers'],
          },
        },
        notes: { type: 'string', description: 'Decisiones de diseño relevantes para el desarrollo' },
      },
      required: ['fileId', 'pageId', 'artboards'],
    };
    return [
      listDocsTool,
      searchDocsTool,
      docOutlineTool,
      readDocTool,
      reviewDefinitionTool,
      saveDefinitionTool,
      {
        type: 'function',
        function: {
          name: 'review_design',
          description:
            'Revisión independiente del diseño: valida el manifiesto y un revisor inspecciona los artboards en la herramienta de diseño (capturas) contra la definición y la guía de diseño. Obligatoria antes de save_design; no guarda nada.',
          parameters: { type: 'object', properties: { manifest: manifestSchema }, required: ['manifest'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'save_design',
          description:
            'Guarda el manifiesto del diseño en la card. Solo funciona si review_design aprobó exactamente este manifiesto con la definición actual. Usa promoted=true únicamente al terminar una promoción a las páginas canónicas.',
          parameters: {
            type: 'object',
            properties: { manifest: manifestSchema, promoted: { type: 'boolean' } },
            required: ['manifest'],
          },
        },
      },
    ];
  }

  if (mode === 'define') {
    return [
      listDocsTool,
      searchDocsTool,
      docOutlineTool,
      readDocTool,
      {
        type: 'function',
        function: {
          name: 'review_definition',
          description:
            'Ejecuta una revisión estructural y semántica independiente de una definición candidata. Es obligatorio usarla antes de save_definition; no guarda nada.',
          parameters: {
            type: 'object',
            properties: { content: { type: 'string', description: 'Definición completa candidata en markdown' } },
            required: ['content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'save_definition',
          description:
            'Guarda la definición completa de la card (markdown). Solo funciona después de que review_definition haya aprobado exactamente este contenido. Sobreescribe la definición anterior si existía y no toca el borrador.',
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
    searchDocsTool,
    docOutlineTool,
    readDocTool,
    {
      type: 'function',
      function: {
        name: 'edit_doc',
        description:
          'Modifica un documento existente enviando solo lo que cambia. Las ediciones se acumulan en un borrador (no se guarda nada todavía); puedes llamarla varias veces. Es la forma de actualizar un documento: no lo reescribas entero.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta del .md que se edita' },
            edits: EDITS_SCHEMA,
          },
          required: ['path', 'edits'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'review_doc',
        description:
          'Revisión estructural y semántica independiente del borrador de un documento. Obligatoria antes de save_doc; no guarda nada. Tras edit_doc, llámala solo con path. Pasa content únicamente para crear un documento nuevo (ese contenido pasa a ser el borrador).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta relativa del .md que se quiere revisar' },
            content: { type: 'string', description: 'Solo para documentos nuevos: contenido completo en markdown' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_doc',
          description:
            'Guarda el borrador de un documento, tal como lo aprobó review_doc. Indica solo path: no reenvíes el contenido. Si editas el borrador después de la revisión, hay que revisarlo de nuevo.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta del .md dentro de los docs del proyecto' },
          },
          required: ['path'],
        },
      },
    },
  ];
}
