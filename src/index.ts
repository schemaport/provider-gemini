/**
 * `@schemaport/provider-gemini`
 *
 * Gemini function-declaration compatibility checks, compilation and live
 * probing for SchemaPort.
 *
 * Gemini's `FunctionDeclaration.parameters` is a select subset of an OpenAPI
 * 3.0 schema object, not JSON Schema: 22 fields, no `additionalProperties`, no
 * `$ref`, no `oneOf`/`allOf`, no `multipleOf`. See `docs/` for the full table
 * and the sources behind every rule.
 */

import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  Diagnostic,
  ProbeOptions,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';

import { checkGeminiTool } from './check.js';
import { compileGeminiTool } from './compile.js';
import { probeGeminiTool } from './probe.js';
import {
  API_KEY_ENV_VAR,
  DISPLAY_NAME,
  GEMINI_DOCS,
  PROVIDER_ID,
  RULES_REVIEWED_AT,
} from './rules.js';

export const geminiProvider: SchemaPortProvider = {
  id: PROVIDER_ID,
  displayName: DISPLAY_NAME,
  rulesReviewedAt: RULES_REVIEWED_AT,
  docs: GEMINI_DOCS,
  apiKeyEnvVar: API_KEY_ENV_VAR,

  check(tool: CanonicalTool): Diagnostic[] {
    return checkGeminiTool(tool);
  },

  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult {
    return compileGeminiTool(tool, options);
  },

  probe(tool: CanonicalTool, options?: ProbeOptions): Promise<ProbeResult> {
    return probeGeminiTool(tool, options);
  },
};

export default geminiProvider;

export { checkGeminiTool, omitsParameters } from './check.js';
export { compileGeminiTool } from './compile.js';
export type { GeminiCompileOptions, PropertyOrderingMode } from './compile.js';
export { probeGeminiTool } from './probe.js';
export type { GeminiProbeClient } from './probe.js';
export { resolveReferences } from './resolve.js';
export type { InlinedReference, ReferenceProblem, ResolveResult } from './resolve.js';
export {
  ANNOTATION_KEYWORDS,
  API_KEY_ENV_VAR,
  DEFAULT_PROBE_MODEL,
  DOC_URLS,
  DROPPED_KEYWORD_RULES,
  FALLBACK_API_KEY_ENV_VAR,
  GEMINI_DOCS,
  GEMINI_SCHEMA_FIELDS,
  GEMINI_TYPE_NAMES,
  INT64_KEYWORDS,
  PROBE_MODEL_ENV_VAR,
  REVIEWED_DISCOVERY_REVISION,
  REVIEWED_SDK_VERSION,
  REVIEWED_VERTEX_DISCOVERY_REVISION,
  UNENFORCED_CONSTRAINT_KEYWORDS,
  VERTEX_ONLY_SCHEMA_FIELDS,
} from './rules.js';
