/**
 * Canonical tool -> Gemini `FunctionDeclaration`.
 *
 * The output is shaped for `FunctionDeclaration.parameters`, the OpenAPI 3.0
 * subset. SchemaPort does not emit `parametersJsonSchema`; see the README.
 *
 * Every change is recorded as a `Transformation`. A transformation is
 * `lossy: true` only when the compiled schema accepts values the canonical
 * schema rejects.
 */

import type { FunctionDeclaration, Schema, Type } from '@google/genai';
import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  JsonSchema,
  Transformation,
} from '@schemaport/core';
import {
  asSchema,
  finalizeCompile,
  isPlainObject,
  joinPath,
  schemaTypes,
  transformation,
} from '@schemaport/core';

import { checkGeminiTool, omitsParameters } from './check.js';
import { resolveReferences } from './resolve.js';
import { isNullOnlySchema } from './schema-shape.js';
import {
  ANNOTATION_KEYWORDS,
  DROPPED_KEYWORD_RULES,
  GEMINI_SCHEMA_FIELDS,
  GEMINI_TYPE_NAMES,
  HANDLED_KEYWORDS,
  INT64_KEYWORDS,
  PROVIDER_ID,
} from './rules.js';

const ROOT_PATH = 'inputSchema';

interface CompileContext {
  transformations: Transformation[];
  /** How many `type` values were rewritten to the Gemini `Type` enum name. */
  typeCaseCount: number;
  /** Which int64 keywords were re-encoded as strings, and where. */
  int64Keywords: Set<string>;
  int64Paths: number;
}

/** Compile a canonical tool into a ready-to-send Gemini `FunctionDeclaration`. */
export function compileGeminiTool(tool: CanonicalTool, options?: CompileOptions): CompileResult {
  const resolved = resolveReferences(tool.inputSchema, ROOT_PATH);
  const context: CompileContext = {
    transformations: [...resolved.transformations],
    typeCaseCount: 0,
    int64Keywords: new Set(),
    int64Paths: 0,
  };

  const output: FunctionDeclaration = { name: tool.name };
  if (tool.description !== undefined && tool.description.length > 0) {
    output.description = tool.description;
  }

  if (omitsParameters(resolved.schema)) {
    context.transformations.push(
      transformation(
        'omitted-empty-parameters',
        ROOT_PATH,
        'Omitted `parameters`; the Gemini reference says it can be left unset for a function with no parameters.',
        false,
      ),
    );
  } else {
    output.parameters = convertSchema(resolved.schema, ROOT_PATH, context);
    context.transformations.push(
      transformation(
        'renamed-input-schema-to-parameters',
        ROOT_PATH,
        'Emitted `inputSchema` as `FunctionDeclaration.parameters`.',
        false,
      ),
    );
  }

  if (context.typeCaseCount > 0) {
    context.transformations.push(
      transformation(
        'normalized-type-case',
        ROOT_PATH,
        `Emitted ${context.typeCaseCount} \`type\` value${context.typeCaseCount === 1 ? '' : 's'} as Gemini \`Type\` enum names (\`string\` -> \`STRING\`).`,
        false,
      ),
    );
  }

  if (context.int64Keywords.size > 0) {
    const listed = INT64_KEYWORDS.filter((keyword) => context.int64Keywords.has(keyword));
    context.transformations.push(
      transformation(
        'int64-constraint-as-string',
        ROOT_PATH,
        `Encoded ${listed.map((keyword) => `\`${keyword}\``).join(', ')} as JSON strings at ${context.int64Paths} subschema${context.int64Paths === 1 ? '' : 's'}; Gemini declares these fields as int64, which proto3 JSON writes as a string.`,
        false,
      ),
    );
  }

  return finalizeCompile({
    providerId: PROVIDER_ID,
    tool,
    output,
    transformations: context.transformations,
    diagnostics: checkGeminiTool(tool),
    options,
  });
}

function geminiType(name: string): Type {
  return GEMINI_TYPE_NAMES[name] as Type;
}

/**
 * Convert one child slot, which JSON Schema allows to be a boolean.
 *
 * Gemini has no boolean subschema, so `true` becomes an unconstrained object
 * (identical meaning) and `false` becomes an unconstrained object too — which
 * accepts everything where the canonical schema accepted nothing, and is
 * therefore lossy.
 */
function convertChild(value: unknown, path: string, context: CompileContext): Schema | undefined {
  const child = asSchema(value);
  if (child) return convertSchema(child, path, context);
  if (typeof value !== 'boolean') return undefined;

  context.transformations.push(
    transformation(
      value ? 'converted-true-subschema' : 'widened-false-subschema',
      path,
      value
        ? 'Emitted the `true` subschema as an unconstrained Gemini schema; `true` already accepted every value.'
        : 'Emitted the `false` subschema as an unconstrained Gemini schema; Gemini cannot express a subschema that accepts nothing.',
      !value,
    ),
  );
  return {};
}

function convertSchema(input: JsonSchema, path: string, context: CompileContext): Schema {
  let source = input;
  let nullable = source.nullable === true;

  // `anyOf: [X, {type: 'null'}]` is how JSON Schema spells "nullable X". Gemini
  // has a `nullable` field, and the SDK performs the same collapse before
  // sending, so doing it here keeps the emitted schema stable end to end.
  const incomingAnyOf = source.anyOf;
  if (Array.isArray(incomingAnyOf) && incomingAnyOf.length === 2) {
    const nullIndex = incomingAnyOf.findIndex(isNullOnlySchema);
    const other = nullIndex === -1 ? undefined : asSchema(incomingAnyOf[1 - nullIndex]);
    if (other !== undefined) {
      const { anyOf: _removed, ...rest } = source;
      source = { ...(rest as JsonSchema), ...other };
      nullable = true;
      context.transformations.push(
        transformation(
          'collapsed-nullable-any-of',
          joinPath(path, 'anyOf'),
          'Collapsed `anyOf` with a `null` branch into `nullable: true`.',
          false,
        ),
      );
    }
  }

  const declaredTypes = schemaTypes(source);
  const known = declaredTypes.filter((name) => GEMINI_TYPE_NAMES[name] !== undefined);
  for (const name of declaredTypes) {
    if (GEMINI_TYPE_NAMES[name] !== undefined) continue;
    context.transformations.push(
      transformation(
        'dropped-unknown-type',
        joinPath(path, 'type'),
        `Dropped type \`${name}\`; it is not a Gemini \`Type\` enum value.`,
        true,
      ),
    );
  }

  let effectiveTypes = known;
  if (known.length > 1 && known.includes('null')) {
    nullable = true;
    effectiveTypes = known.filter((name) => name !== 'null');
    context.transformations.push(
      transformation(
        'converted-null-type-to-nullable',
        joinPath(path, 'type'),
        'Moved the `null` member of the `type` array into `nullable: true`.',
        false,
      ),
    );
  }

  const branches: Schema[] = [];
  let type: Type | undefined;
  if (effectiveTypes.length === 1) {
    type = geminiType(effectiveTypes[0] as string);
    context.typeCaseCount += 1;
  } else if (effectiveTypes.length > 1) {
    for (const name of effectiveTypes) {
      branches.push({ type: geminiType(name) });
      context.typeCaseCount += 1;
    }
    context.transformations.push(
      transformation(
        'converted-type-array-to-any-of',
        joinPath(path, 'type'),
        'Emitted the multi-type `type` array as `anyOf` branches; Gemini rejects `type` and `anyOf` together.',
        false,
      ),
    );
  }

  if (Array.isArray(source.anyOf)) {
    source.anyOf.forEach((value, index) => {
      const branch = convertChild(value, joinPath(path, 'anyOf', index), context);
      if (branch) branches.push(branch);
    });
  }

  if (Array.isArray(source.oneOf)) {
    source.oneOf.forEach((value, index) => {
      const branch = convertChild(value, joinPath(path, 'oneOf', index), context);
      if (branch) branches.push(branch);
    });
    context.transformations.push(
      transformation(
        'converted-one-of-to-any-of',
        joinPath(path, 'oneOf'),
        'Emitted `oneOf` branches as `anyOf`; values matching more than one branch are now accepted.',
        true,
      ),
    );
  }

  if (type !== undefined && branches.length > 0) {
    context.transformations.push(
      transformation(
        'dropped-type-beside-any-of',
        joinPath(path, 'type'),
        'Dropped `type` because Gemini rejects a schema that sets both `type` and `anyOf`; the branches are kept.',
        true,
      ),
    );
    type = undefined;
  }

  const out: Schema = {};
  if (type !== undefined) out.type = type;

  const { enumValues, format } = convertEnumAndFormat(source, path, context);
  if (format !== undefined) out.format = format;
  if (typeof source.title === 'string') out.title = source.title;
  if (typeof source.description === 'string') out.description = source.description;
  if (nullable) out.nullable = true;
  if (source.default !== undefined) out.default = source.default;
  if (source['example'] !== undefined) out.example = source['example'];
  if (enumValues !== undefined) out.enum = enumValues;

  if (isPlainObject(source.properties)) {
    const properties: Record<string, Schema> = {};
    for (const [name, value] of Object.entries(source.properties)) {
      const child = convertChild(value, joinPath(path, 'properties', name), context);
      if (child) properties[name] = child;
    }
    out.properties = properties;
  }

  if (Array.isArray(source.required)) {
    out.required = source.required.filter((name): name is string => typeof name === 'string');
  }

  const ordering = source['propertyOrdering'];
  if (Array.isArray(ordering) && ordering.every((name) => typeof name === 'string')) {
    out.propertyOrdering = ordering as string[];
  }

  if (source.items !== undefined) {
    const items = convertChild(source.items, joinPath(path, 'items'), context);
    if (items) out.items = items;
  }

  let usedInt64 = false;
  for (const keyword of INT64_KEYWORDS) {
    const value = source[keyword];
    if (typeof value !== 'number') continue;
    out[keyword] = String(value);
    context.int64Keywords.add(keyword);
    usedInt64 = true;
  }
  if (usedInt64) context.int64Paths += 1;

  if (typeof source.minimum === 'number') out.minimum = source.minimum;
  if (typeof source.maximum === 'number') out.maximum = source.maximum;
  if (typeof source.pattern === 'string') out.pattern = source.pattern;
  if (branches.length > 0) out.anyOf = branches;

  recordDroppedKeywords(source, path, context);

  return reorder(out);
}

/**
 * Emit fields in the order `rules.ts` documents, so two compiles of the same
 * tool serialize byte-identically regardless of how the source was written.
 */
function reorder(schema: Schema): Schema {
  const ordered: Schema = {};
  const source = schema as Record<string, unknown>;
  for (const field of GEMINI_SCHEMA_FIELDS) {
    if (source[field] !== undefined) {
      (ordered as Record<string, unknown>)[field] = source[field];
    }
  }
  return ordered;
}

function convertEnumAndFormat(
  source: JsonSchema,
  path: string,
  context: CompileContext,
): { enumValues?: string[]; format?: string } {
  const declaredFormat = typeof source.format === 'string' ? source.format : undefined;

  let values: string[] | undefined;
  if (Array.isArray(source.enum)) {
    if (source.enum.every((value) => typeof value === 'string')) {
      values = source.enum as string[];
    } else {
      context.transformations.push(
        transformation(
          'dropped-non-string-enum',
          joinPath(path, 'enum'),
          'Dropped `enum`; Gemini declares `enum` as an array of strings.',
          true,
        ),
      );
    }
  }

  if (source.const !== undefined) {
    if (typeof source.const === 'string') {
      values = [source.const];
      context.transformations.push(
        transformation(
          'converted-const-to-enum',
          joinPath(path, 'const'),
          'Emitted `const` as a single-value `enum`; the accepted value set is unchanged.',
          false,
        ),
      );
    } else {
      context.transformations.push(
        transformation(
          'dropped-const',
          joinPath(path, 'const'),
          'Dropped `const`; Gemini has no `const` field and its `enum` only accepts strings.',
          true,
        ),
      );
    }
  }

  if (values === undefined) {
    return declaredFormat === undefined ? {} : { format: declaredFormat };
  }
  if (declaredFormat !== undefined) return { enumValues: values, format: declaredFormat };

  context.transformations.push(
    transformation(
      'added-enum-format',
      joinPath(path, 'format'),
      'Added `format: "enum"`, which the Gemini reference uses to mark an enumerated field.',
      false,
    ),
  );
  return { enumValues: values, format: 'enum' };
}

function recordDroppedKeywords(source: JsonSchema, path: string, context: CompileContext): void {
  const additional = source.additionalProperties;
  if (additional !== undefined) {
    const open = additional === true;
    context.transformations.push(
      transformation(
        open ? 'dropped-open-additional-properties' : 'dropped-additional-properties',
        joinPath(path, 'additionalProperties'),
        open
          ? 'Dropped `additionalProperties: true`; Gemini objects are open already, so nothing changes.'
          : 'Dropped `additionalProperties`; Gemini has no such field, so extra properties are accepted.',
        !open,
      ),
    );
  }

  for (const rule of DROPPED_KEYWORD_RULES) {
    if (source[rule.keyword] === undefined) continue;
    context.transformations.push(
      transformation(
        rule.transformationCode,
        joinPath(path, rule.keyword),
        `Dropped \`${rule.keyword}\`; Gemini has no such field, so ${rule.detail} is no longer enforced.`,
        true,
      ),
    );
  }

  for (const keyword of Object.keys(source)) {
    if ((ANNOTATION_KEYWORDS as readonly string[]).includes(keyword)) {
      context.transformations.push(
        transformation(
          'dropped-annotation-keyword',
          joinPath(path, keyword),
          `Dropped the \`${keyword}\` annotation; it constrains no value.`,
          false,
        ),
      );
      continue;
    }
    if (HANDLED_KEYWORDS.has(keyword)) continue;
    context.transformations.push(
      transformation(
        'dropped-unsupported-keyword',
        joinPath(path, keyword),
        `Dropped \`${keyword}\`; it is not a Gemini \`Schema\` field.`,
        true,
      ),
    );
  }
}
