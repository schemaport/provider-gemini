/**
 * `$ref` inlining.
 *
 * Neither the Gemini Developer API `Schema` object nor the installed SDK's
 * `Schema` type has a `$ref`/`$defs` field, so a reference has to be inlined
 * before the schema can be sent. Inlining a non-recursive reference preserves
 * every constraint, so it is a `lossy: false` transformation. A recursive or
 * unresolvable reference cannot be inlined at all.
 *
 * Both `check()` and `compile()` run this first so they agree on what the
 * schema actually says.
 */

import type { JsonSchema, Transformation } from '@schemaport/core';
import { asSchema, isPlainObject, joinPath, transformation } from '@schemaport/core';

export interface InlinedReference {
  /** Path of the `$ref` keyword in the canonical tool. */
  path: string;
  ref: string;
}

export interface ReferenceProblem {
  path: string;
  ref: string;
  reason: 'recursive' | 'unresolvable';
}

export interface ResolveResult {
  /** The schema with every resolvable reference inlined and `$defs` removed. */
  schema: JsonSchema;
  transformations: Transformation[];
  inlined: InlinedReference[];
  problems: ReferenceProblem[];
}

/**
 * Keyword slots holding a map of subschemas.
 *
 * `$defs` and `definitions` are deliberately absent. They are the *targets* of
 * inlining, not places to inline into: walking them would rewrite a definition
 * that is about to be removed from the output anyway.
 */
const MAP_SLOTS = ['properties'] as const;
/** Keyword slots holding an array of subschemas. */
const LIST_SLOTS = ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const;
/** Keyword slots holding a single subschema. */
const SINGLE_SLOTS = ['items', 'not', 'additionalProperties'] as const;

/** Inline every `$ref` that points at a root-level `$defs`/`definitions` entry. */
export function resolveReferences(root: JsonSchema, rootPath: string): ResolveResult {
  const result: ResolveResult = { schema: root, transformations: [], inlined: [], problems: [] };
  const definitions = collectDefinitions(root);

  result.schema = resolveNode(root, rootPath, [], definitions, result);

  if (isPlainObject(result.schema['$defs']) || isPlainObject(result.schema['definitions'])) {
    const copy = { ...result.schema };
    const keyword = isPlainObject(copy['$defs']) ? '$defs' : 'definitions';
    delete copy['$defs'];
    delete copy['definitions'];
    result.schema = copy;
    result.transformations.push(
      transformation(
        'dropped-schema-definitions',
        joinPath(rootPath, keyword),
        'Removed the schema definition map; Gemini has no reference support, so definitions are inlined at each use site.',
        false,
      ),
    );
  }

  return result;
}

function collectDefinitions(root: JsonSchema): Map<string, JsonSchema> {
  const found = new Map<string, JsonSchema>();
  for (const keyword of ['$defs', 'definitions'] as const) {
    const map = root[keyword];
    if (!isPlainObject(map)) continue;
    for (const [name, value] of Object.entries(map)) {
      const schema = asSchema(value);
      if (schema) found.set(`#/${keyword}/${name}`, schema);
    }
  }
  return found;
}

function resolveNode(
  schema: JsonSchema,
  path: string,
  stack: readonly string[],
  definitions: ReadonlyMap<string, JsonSchema>,
  result: ResolveResult,
): JsonSchema {
  let current = schema;

  const ref = current['$ref'];
  if (typeof ref === 'string') {
    const { $ref: _dropped, ...siblings } = current;
    const target = definitions.get(ref);
    if (target === undefined) {
      result.problems.push({ path: joinPath(path, '$ref'), ref, reason: 'unresolvable' });
      current = siblings as JsonSchema;
    } else if (stack.includes(ref)) {
      result.problems.push({ path: joinPath(path, '$ref'), ref, reason: 'recursive' });
      current = siblings as JsonSchema;
    } else {
      result.inlined.push({ path: joinPath(path, '$ref'), ref });
      result.transformations.push(
        transformation(
          'inlined-schema-reference',
          joinPath(path, '$ref'),
          `Inlined \`${ref}\`; Gemini has no \`$ref\` field.`,
          false,
        ),
      );
      const expanded = resolveNode(target, path, [...stack, ref], definitions, result);
      current = { ...expanded, ...(siblings as JsonSchema) };
    }
  }

  const out: JsonSchema = { ...current };

  for (const slot of MAP_SLOTS) {
    const map = current[slot];
    if (!isPlainObject(map)) continue;
    const next: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(map)) {
      const child = asSchema(value);
      next[key] = child
        ? resolveNode(child, joinPath(path, slot, key), stack, definitions, result)
        : (value as JsonSchema);
    }
    out[slot] = next;
  }

  for (const slot of LIST_SLOTS) {
    const list = current[slot];
    if (!Array.isArray(list)) continue;
    out[slot] = list.map((value, index) => {
      const child = asSchema(value);
      return child
        ? resolveNode(child, joinPath(path, slot, index), stack, definitions, result)
        : value;
    });
  }

  for (const slot of SINGLE_SLOTS) {
    const child = asSchema(current[slot]);
    if (!child) continue;
    out[slot] = resolveNode(child, joinPath(path, slot), stack, definitions, result);
  }

  return out;
}
