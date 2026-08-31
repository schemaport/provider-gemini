/**
 * Small shape predicates shared by `check()` and `compile()`, so both agree on
 * what a subschema will look like once it is emitted.
 */

import type { JsonSchema } from '@schemaport/core';
import { asSchema, isPlainObject, joinPath } from '@schemaport/core';

/** `{ type: 'null' }` and nothing else: the JSON Schema spelling of "null". */
export function isNullOnlySchema(value: unknown): boolean {
  const schema = asSchema(value);
  return schema !== undefined && Object.keys(schema).length === 1 && schema.type === 'null';
}

/**
 * `anyOf: [X, {type: 'null'}]` — the JSON Schema spelling of "nullable X",
 * which compiles to `nullable: true` rather than to an `anyOf`.
 */
export function isNullablePair(schema: JsonSchema): boolean {
  const branches = schema.anyOf;
  if (!Array.isArray(branches) || branches.length !== 2) return false;
  const nullIndex = branches.findIndex(isNullOnlySchema);
  return nullIndex !== -1 && asSchema(branches[1 - nullIndex]) !== undefined;
}

/** A `true` or `false` used where JSON Schema allows a boolean subschema. */
export interface BooleanSubschema {
  path: string;
  value: boolean;
}

/**
 * Find every boolean subschema in the slots compile recurses into.
 *
 * Gemini's `Schema` is always an object, so `true` and `false` have to be
 * re-expressed. `false` ("no value is valid") has no Gemini equivalent at all,
 * which is why `check()` reports it.
 *
 * The slot lists below are the same ones `resolve.ts` walks, minus
 * `additionalProperties` — Gemini's `Schema` has no such field, so a boolean
 * there is dropped by compile rather than re-expressed, and reporting it here
 * would point at a keyword that never reaches the wire. If a slot is ever
 * added to `resolve.ts`, it belongs here too.
 */
export function collectBooleanSubschemas(root: JsonSchema, rootPath: string): BooleanSubschema[] {
  const found: BooleanSubschema[] = [];

  const visit = (schema: JsonSchema, path: string): void => {
    const properties = schema.properties;
    if (isPlainObject(properties)) {
      for (const [key, value] of Object.entries(properties)) {
        record(value, joinPath(path, 'properties', key));
      }
    }
    for (const slot of ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const) {
      const list = schema[slot];
      if (!Array.isArray(list)) continue;
      list.forEach((value, index) => record(value, joinPath(path, slot, index)));
    }
    for (const slot of ['items', 'not'] as const) {
      record(schema[slot], joinPath(path, slot));
    }
  };

  const record = (value: unknown, path: string): void => {
    if (typeof value === 'boolean') {
      found.push({ path, value });
      return;
    }
    const child = asSchema(value);
    if (child) visit(child, path);
  };

  visit(root, rootPath);
  return found;
}
