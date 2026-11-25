const input =
  $input.first()?.json ?? {};

const hasProperty = (
  object,
  property,
) =>
  Object.prototype.hasOwnProperty.call(
    object ?? {},
    property,
  );

const toPositiveInteger = value => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isInteger(number) &&
    number > 0
    ? number
    : null;
};

const cleanText = value =>
  String(value ?? '')
    .replace(
      /```json\s*/gi,
      '',
    )
    .replace(
      /```\s*$/g,
      '',
    )
    .replace(
      /[\u200b-\u200d\ufeff]/g,
      '',
    )
    .trim();

const parseJson = value => {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const sanitize = value =>
  String(value ?? '')
    .replace(
      /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      'Bearer [REDACTED]',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

const errorResult = (
  code,
  diagnostic,
  details = [],
) => [
  {
    json: {
      _route: 'error',
      status: 'error',
      validation_ok: false,

      erro: {
        codigo: code,
        categoria: 'validation',
        diagnostico: diagnostic,
        detalhes: details,
      },
    },
  },
];

const isClassificationObject = value =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (
    hasProperty(value, 'autor') ||
    hasProperty(value, 'autor_id') ||
    hasProperty(value, 'user_id') ||
    hasProperty(value, 'autoria') ||
    hasProperty(value, 'categories') ||
    hasProperty(value, 'categoria_id') ||
    hasProperty(value, 'categoria') ||
    hasProperty(value, 'tags') ||
    hasProperty(value, 'tags_ids')
  );

const findClassification = (
  value,
  depth = 0,
) => {
  if (
    depth > 8 ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (isClassificationObject(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result =
        findClassification(
          item,
          depth + 1,
        );

      if (result) {
        return result;
      }
    }

    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  for (const child of Object.values(value)) {
    const result =
      findClassification(
        child,
        depth + 1,
      );

    if (result) {
      return result;
    }
  }

  return null;
};

let classification =
  findClassification(input);

let parseMethod =
  classification
    ? 'structured_object'
    : null;

/*
 * Compatibilidade com resposta antiga:
 * { text: "{\"user_id\":...}" }
 */
if (
  !classification &&
  typeof input.text === 'string'
) {
  classification =
    parseJson(input.text);

  if (classification) {
    parseMethod =
      'legacy_text_json';
  }
}

/*
 * Compatibilidade com resposta encapsulada
 * no body ou choices do HTTP.
 */
if (!classification) {
  const modelContent =
    input?.body?.choices?.[0]?.message?.content ??
    input?.choices?.[0]?.message?.content ??
    input?.content ??
    '';

  classification =
    parseJson(modelContent);

  if (classification) {
    parseMethod =
      'nested_model_json';
  }
}

if (!classification) {
  return errorResult(
    'CLASSIFICATION_NOT_FOUND',
    'Nenhuma classificação foi encontrada na entrada.',
  );
}

/*
 * Propaga erro do fluxo Filho sem criar
 * valores padrão.
 */
if (
  classification.status === 'error' ||
  classification._route === 'error' ||
  classification.erro
) {
  return errorResult(
    classification.erro?.codigo ??
      classification.code ??
      'CLASSIFICATION_FAILED',

    sanitize(
      classification.erro?.diagnostico ??
        classification.diagnostic ??
        'O fluxo Filho retornou erro.',
    ),

    classification.erro?.detalhes ??
      [],
  );
}

const toIdArray = value => {
  const values = Array.isArray(value)
    ? value
    : value === null ||
      value === undefined ||
      value === ''
      ? []
      : [value];

  return values
    .map(toPositiveInteger)
    .filter(value => value !== null);
};

const autorId =
  toPositiveInteger(
    classification.autor_id ??
      classification.user_id ??
      classification.autoria ??
      (
        Array.isArray(
          classification.autor,
        )
          ? classification.autor[0]
          : classification.autor
      ),
  );

const categoriaId =
  toPositiveInteger(
    classification.categoria_id ??
      classification.categoria ??
      (
        Array.isArray(
          classification.categories,
        )
          ? classification.categories[0]
          : classification.categories
      ),
  );

const tagsIds =
  toIdArray(
    classification.tags_ids ??
      classification.tags,
  );

const details = [];

/*
 * O autor é genérico.
 * Nenhum ID é fixado no código.
 */
if (
  autorId === null ||
  autorId <= 0
) {
  details.push({
    field: 'autor_id',
    code: 'INVALID_AUTHOR_ID',
    message:
      'O autor deve ser um ID inteiro positivo.',
    received: autorId,
  });
}

if (
  categoriaId === null ||
  categoriaId <= 0
) {
  details.push({
    field: 'categoria_id',
    code: 'INVALID_CATEGORY_ID',
    message:
      'A categoria deve ser um ID inteiro positivo.',
    received: categoriaId,
  });
}

if (
  tagsIds.length < 1 ||
  tagsIds.length > 3
) {
  details.push({
    field: 'tags_ids',
    code: 'INVALID_TAG_COUNT',
    message:
      'A classificação deve conter de 1 a 3 tags.',
    received: tagsIds,
  });
}

if (
  new Set(tagsIds).size !==
  tagsIds.length
) {
  details.push({
    field: 'tags_ids',
    code: 'DUPLICATE_TAGS',
    message:
      'As tags não podem ser repetidas.',
    received: tagsIds,
  });
}

if (details.length > 0) {
  return errorResult(
    'INVALID_CLASSIFICATION_STRUCTURE',
    'A resposta não possui uma estrutura válida.',
    details,
  );
}

/*
 * Os catálogos são obtidos dinamicamente
 * dos nodes do próprio fluxo PAI.
 */
let categoryItems = [];
let tagItems = [];

try {
  categoryItems =
    $('Busca Categoria PEL')
      .all()
      .map(item => item.json);

  tagItems =
    $('Busca Tags PEL')
      .all()
      .map(item => item.json);
} catch {
  return errorResult(
    'CATALOG_NODES_UNAVAILABLE',
    'Os nodes de catálogo do PAI não estão disponíveis.',
  );
}

const categoryIds =
  new Set(
    categoryItems
      .map(item =>
        toPositiveInteger(
          item.id ??
            item.id_wp_origem ??
            item.categoria_id,
        ),
      )
      .filter(value => value !== null),
  );

const tagCatalogIds =
  new Set(
    tagItems
      .map(item =>
        toPositiveInteger(
          item.id ??
            item.id_wp_origem ??
            item.tag_id,
        ),
      )
      .filter(value => value !== null),
  );

if (
  categoryIds.size === 0
) {
  return errorResult(
    'CATEGORY_CATALOG_EMPTY',
    'O catálogo de categorias do PAI está vazio.',
  );
}

if (
  tagCatalogIds.size === 0
) {
  return errorResult(
    'TAG_CATALOG_EMPTY',
    'O catálogo de tags do PAI está vazio.',
  );
}

if (
  !categoryIds.has(categoriaId)
) {
  details.push({
    field: 'categoria_id',
    code: 'CATEGORY_NOT_IN_CATALOG',
    message:
      'A categoria não pertence ao catálogo do PAI.',
    received: categoriaId,
  });
}

const invalidTags =
  tagsIds.filter(
    tagId =>
      !tagCatalogIds.has(tagId),
  );

if (invalidTags.length > 0) {
  details.push({
    field: 'tags_ids',
    code: 'TAGS_NOT_IN_CATALOG',
    message:
      'Uma ou mais tags não pertencem ao catálogo do PAI.',
    received: invalidTags,
  });
}

if (details.length > 0) {
  return errorResult(
    'CLASSIFICATION_OUTSIDE_CATALOG',
    'A classificação contém IDs ausentes nos catálogos do PAI.',
    details,
  );
}

return [
  {
    json: {
      _route: 'result',
      status: 'success',
      validation_ok: true,

      autor: [autorId],
      categories: [categoriaId],
      tags: tagsIds,

      autor_id: autorId,
      categoria_id: categoriaId,
      tags_ids: tagsIds,

      ai_parse_status: 'ok',
      ai_parse_method: parseMethod,
      catalog_validation: 'parent_catalog',

      category_catalog_size:
        categoryIds.size,

      tag_catalog_size:
        tagCatalogIds.size,
    },
  },
];