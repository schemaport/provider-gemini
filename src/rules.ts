/**
 * Constants describing what the Gemini function-calling API accepts.
 *
 * Every value here is backed by one of the sources in {@link GEMINI_DOCS}.
 * The field list is the intersection of two independently checkable sources:
 *
 *  - the Gemini Developer API discovery document
 *    (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`,
 *    revision 20260816), which defines `Schema` and `FunctionDeclaration`; and
 *  - the installed SDK typings, `@google/genai@2.17.1`
 *    (`dist/genai.d.ts`, `export declare interface Schema`).
 *
 * The two agree exactly: 22 fields, no `additionalProperties`, no `$ref`,
 * no `$defs`, no `oneOf`, no `allOf`, no `multipleOf`.
 */

import type { ProviderDocReference } from '@schemaport/core';

export const PROVIDER_ID = 'gemini';
export const DISPLAY_NAME = 'Gemini';

/** ISO date these rules were last checked against the sources below. */
export const RULES_REVIEWED_AT = '2026-08-20';

/** Primary environment variable read by `probe()`. */
export const API_KEY_ENV_VAR = 'GEMINI_API_KEY';

/** Fallback the `@google/genai` SDK also reads. */
export const FALLBACK_API_KEY_ENV_VAR = 'GOOGLE_API_KEY';

export const PROBE_MODEL_ENV_VAR = 'SCHEMAPORT_GEMINI_MODEL';

/**
 * Cheapest current Gemini model whose documented capability list includes
 * "Function calling: Supported".
 *
 * @see https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
 * @see https://ai.google.dev/gemini-api/docs/pricing
 */
export const DEFAULT_PROBE_MODEL = 'gemini-2.5-flash-lite';

/** Version of `@google/genai` the rules were checked against. */
export const REVIEWED_SDK_VERSION = '2.17.1';

/** Revision of the Gemini Developer API discovery document that was read. */
export const REVIEWED_DISCOVERY_REVISION = '20260816';

/** Revision of the Vertex AI discovery document that was read. */
export const REVIEWED_VERTEX_DISCOVERY_REVISION = '20260808';

export const DOC_URLS = {
  functionCalling: 'https://ai.google.dev/gemini-api/docs/function-calling',
  functionDeclaration: 'https://ai.google.dev/api/caching#FunctionDeclaration',
  schema: 'https://ai.google.dev/api/caching#Schema',
  discovery: 'https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta',
  vertexDiscovery: 'https://aiplatform.googleapis.com/$discovery/rest?version=v1',
  vertexSchema: 'https://cloud.google.com/vertex-ai/docs/reference/rest/v1/Schema',
  structuredOutput: 'https://ai.google.dev/gemini-api/docs/structured-output',
  model: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite',
  pricing: 'https://ai.google.dev/gemini-api/docs/pricing',
  sdk: 'https://github.com/googleapis/js-genai',
} as const;

export const GEMINI_DOCS: readonly ProviderDocReference[] = Object.freeze([
  { title: 'Gemini API — Function calling', url: DOC_URLS.functionCalling },
  { title: 'Gemini API reference — FunctionDeclaration', url: DOC_URLS.functionDeclaration },
  { title: 'Gemini API reference — Schema', url: DOC_URLS.schema },
  {
    title: `Gemini Developer API discovery document (v1beta, revision ${REVIEWED_DISCOVERY_REVISION})`,
    url: DOC_URLS.discovery,
  },
  {
    title: `Vertex AI discovery document (v1, revision ${REVIEWED_VERTEX_DISCOVERY_REVISION})`,
    url: DOC_URLS.vertexDiscovery,
  },
  { title: 'Vertex AI reference — Schema', url: DOC_URLS.vertexSchema },
  { title: 'Gemini API — Structured output', url: DOC_URLS.structuredOutput },
  { title: 'Gemini 2.5 Flash-Lite model card', url: DOC_URLS.model },
  { title: `@google/genai TypeScript SDK (reviewed at ${REVIEWED_SDK_VERSION})`, url: DOC_URLS.sdk },
]);

/**
 * Every field the Gemini Developer API `Schema` object accepts, in the order
 * SchemaPort emits them. Matches `@google/genai@2.17.1` `interface Schema`.
 */
export const GEMINI_SCHEMA_FIELDS = [
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'default',
  'example',
  'enum',
  'properties',
  'required',
  'propertyOrdering',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
  'pattern',
  'anyOf',
] as const;

/**
 * Fields Vertex AI's `Schema` declares that the Gemini Developer API does not.
 *
 * The installed SDK's `Schema` type declares none of them, and its
 * `processJsonSchema` helper deletes `additionalProperties` before sending on
 * both backends, so SchemaPort treats them as unsupported everywhere.
 */
export const VERTEX_ONLY_SCHEMA_FIELDS = ['additionalProperties', 'defs', 'ref'] as const;

/** JSON Schema `type` value -> Gemini `Type` enum name. */
export const GEMINI_TYPE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
  null: 'NULL',
});

/**
 * Gemini fields declared `string (int64 format)`, which proto3 JSON encodes as
 * decimal strings. The SDK types them `string` too.
 */
export const INT64_KEYWORDS = [
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
] as const;

/**
 * Keywords Gemini accepts but does not promise to enforce for function calls.
 *
 * `FunctionCallingConfig.mode = VALIDATED` is documented as the mode that
 * "will validate function calls with constrained decoding"; the default `AUTO`
 * mode makes no such promise, so these are guidance for the model.
 */
export const UNENFORCED_CONSTRAINT_KEYWORDS = [
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
] as const;

/** Annotation-only keywords: dropped without weakening any constraint. */
export const ANNOTATION_KEYWORDS = [
  '$anchor',
  '$comment',
  '$id',
  '$schema',
  'deprecated',
  'examples',
  'readOnly',
  'writeOnly',
] as const;

/** A validation keyword Gemini has no field for, which compile drops. */
export interface DroppedKeywordRule {
  keyword: string;
  /** Diagnostic code, `gemini/`-prefixed. */
  code: string;
  /** Transformation code recorded when compile drops it. */
  transformationCode: string;
  /** What the canonical schema loses. */
  detail: string;
}

/**
 * Validation keywords with no Gemini `Schema` field. Dropping any of them lets
 * the compiled schema accept values the canonical schema rejects, so each is an
 * `error` whose compile ability is lossy.
 */
export const DROPPED_KEYWORD_RULES: readonly DroppedKeywordRule[] = Object.freeze([
  {
    keyword: 'allOf',
    code: 'gemini/unsupported-all-of',
    transformationCode: 'dropped-all-of',
    detail: 'every subschema constraint in `allOf`',
  },
  {
    keyword: 'not',
    code: 'gemini/unsupported-not',
    transformationCode: 'dropped-not',
    detail: 'the negated subschema in `not`',
  },
  {
    keyword: 'multipleOf',
    code: 'gemini/unsupported-multiple-of',
    transformationCode: 'dropped-multiple-of',
    detail: 'the divisibility constraint in `multipleOf`',
  },
  {
    keyword: 'exclusiveMinimum',
    code: 'gemini/unsupported-exclusive-minimum',
    transformationCode: 'dropped-exclusive-minimum',
    detail: 'the exclusive lower bound in `exclusiveMinimum`',
  },
  {
    keyword: 'exclusiveMaximum',
    code: 'gemini/unsupported-exclusive-maximum',
    transformationCode: 'dropped-exclusive-maximum',
    detail: 'the exclusive upper bound in `exclusiveMaximum`',
  },
  {
    keyword: 'uniqueItems',
    code: 'gemini/unsupported-unique-items',
    transformationCode: 'dropped-unique-items',
    detail: 'the uniqueness constraint in `uniqueItems`',
  },
  {
    keyword: 'prefixItems',
    code: 'gemini/unsupported-prefix-items',
    transformationCode: 'dropped-prefix-items',
    detail: 'the positional tuple constraint in `prefixItems`',
  },
]);

/** Keywords check() and compile() handle by name. Anything else is unknown. */
export const HANDLED_KEYWORDS: ReadonlySet<string> = new Set<string>([
  ...GEMINI_SCHEMA_FIELDS,
  ...ANNOTATION_KEYWORDS,
  ...DROPPED_KEYWORD_RULES.map((rule) => rule.keyword),
  'additionalProperties',
  'const',
  'definitions',
  'oneOf',
  '$defs',
  '$ref',
]);

/**
 * `FunctionDeclaration.name`: "Must be a-z, A-Z, 0-9, or contain underscores,
 * colons, dots, and dashes, with a maximum length of 128."
 */
export const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;
export const FUNCTION_NAME_MAX_LENGTH = 128;

/**
 * Vertex AI's reference and the SDK's `FunctionDeclaration.name` doc comment
 * add "Must start with a letter or an underscore". The Gemini Developer API
 * discovery document does not, so this is only a warning.
 */
export const FUNCTION_NAME_START_PATTERN = /^[A-Za-z_]/;

/**
 * The SDK's `FunctionDeclaration.parameters` doc comment: "Parameter names must
 * start with a letter or an underscore and must only contain chars a-z, A-Z,
 * 0-9, or underscores with a maximum length of 64." The Developer API discovery
 * document omits this sentence, so SchemaPort only warns.
 */
export const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const PARAMETER_NAME_MAX_LENGTH = 64;
