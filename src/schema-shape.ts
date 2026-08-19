/**
 * Small shape predicates shared by `check()` and `compile()`, so both agree on
 * what a subschema will look like once it is emitted.
 */

import type { JsonSchema } from '@schemaport/core';
import { asSchema } from '@schemaport/core';

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
