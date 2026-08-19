/**
 * Gemini compatibility rules.
 *
 * Every rule below is backed by a source listed in `rules.ts`. Rules whose
 * evidence is a "must" in the API reference are errors; rules where the
 * reference and the SDK typings disagree, or where the API accepts a field but
 * promises nothing about enforcing it, are warnings that say so.
 */

import type { CanonicalTool, Diagnostic, DiagnosticInit, JsonSchema } from '@schemaport/core';
import {
  collectSchemas,
  compilable,
  compilableLossy,
  diagnostic,
  isPlainObject,
  joinPath,
  notCompilable,
  schemaTypes,
  sortDiagnostics,
} from '@schemaport/core';

import {
  ANNOTATION_KEYWORDS,
  DOC_URLS,
  DROPPED_KEYWORD_RULES,
  FUNCTION_NAME_MAX_LENGTH,
  FUNCTION_NAME_PATTERN,
  FUNCTION_NAME_START_PATTERN,
  GEMINI_TYPE_NAMES,
  HANDLED_KEYWORDS,
  PARAMETER_NAME_MAX_LENGTH,
  PARAMETER_NAME_PATTERN,
  PROVIDER_ID,
  UNENFORCED_CONSTRAINT_KEYWORDS,
} from './rules.js';
import { resolveReferences } from './resolve.js';
import { isNullablePair } from './schema-shape.js';

const ROOT_PATH = 'inputSchema';

/** Run every Gemini compatibility rule against a canonical tool. */
export function checkGeminiTool(tool: CanonicalTool): Diagnostic[] {
  const found: Diagnostic[] = [];
  const add = (init: Omit<DiagnosticInit, 'providerId' | 'toolName'>): void => {
    found.push(diagnostic({ providerId: PROVIDER_ID, toolName: tool.name, ...init }));
  };

  checkFunctionName(tool, add);
  checkFunctionDescription(tool, add);

  const resolved = resolveReferences(tool.inputSchema, ROOT_PATH);
  checkReferences(resolved, add);
  checkParameterNames(resolved.schema, add);
  checkEmptyParameters(resolved.schema, add);

  for (const visit of collectSchemas(resolved.schema, ROOT_PATH)) {
    checkSubschema(visit.schema, visit.path, add);
  }

  return sortDiagnostics(found);
}

type Add = (init: Omit<DiagnosticInit, 'providerId' | 'toolName'>) => void;

function checkFunctionName(tool: CanonicalTool, add: Add): void {
  if (!FUNCTION_NAME_PATTERN.test(tool.name) || tool.name.length > FUNCTION_NAME_MAX_LENGTH) {
    add({
      severity: 'error',
      code: 'gemini/invalid-function-name',
      message:
        `Function name \`${tool.name}\` is not a valid Gemini function name. It must contain ` +
        'only a-z, A-Z, 0-9, underscores, dots, colons and dashes, and be at most ' +
        `${FUNCTION_NAME_MAX_LENGTH} characters.`,
      path: 'name',
      compile: notCompilable('Refused: renaming the tool would change the contract callers use.'),
      docsUrl: DOC_URLS.functionDeclaration,
    });
  } else if (!FUNCTION_NAME_START_PATTERN.test(tool.name)) {
    add({
      severity: 'warning',
      code: 'gemini/function-name-leading-character',
      message:
        `Function name \`${tool.name}\` does not start with a letter or underscore. The Vertex AI ` +
        'reference and the `@google/genai` typings require that; the Gemini Developer API ' +
        'reference does not mention it, so SchemaPort cannot tell whether it will be rejected.',
      path: 'name',
      compile: compilable('Emits the name unchanged.'),
      docsUrl: DOC_URLS.vertexSchema,
    });
  }
}

function checkFunctionDescription(tool: CanonicalTool, add: Add): void {
  if (tool.description !== undefined && tool.description.length > 0) return;
  add({
    severity: 'warning',
    code: 'gemini/missing-function-description',
    message:
      'This tool has no description. The Gemini Developer API reference marks ' +
      '`FunctionDeclaration.description` as required, while the `@google/genai` typings and the ' +
      'Vertex AI reference mark it optional, so SchemaPort cannot tell whether it will be ' +
      'rejected. The model also uses it to decide when to call the tool.',
    path: 'description',
    compile: compilable('Emits the declaration without a description; SchemaPort never invents one.'),
    docsUrl: DOC_URLS.functionDeclaration,
  });
}

function checkReferences(resolved: ReturnType<typeof resolveReferences>, add: Add): void {
  for (const problem of resolved.problems) {
    add({
      severity: 'error',
      code: 'gemini/unresolvable-schema-reference',
      message:
        `\`${problem.ref}\` is ${problem.reason === 'recursive' ? 'recursive' : 'not resolvable'} ` +
        'and Gemini has no `$ref` field, so the reference cannot be inlined.',
      path: problem.path,
      compile: notCompilable(
        problem.reason === 'recursive'
          ? 'Refused: a recursive reference cannot be expanded into a finite schema.'
          : 'Refused: the reference does not point at a root-level `$defs` or `definitions` entry.',
      ),
      docsUrl: DOC_URLS.schema,
    });
  }

  for (const inlined of resolved.inlined) {
    add({
      severity: 'error',
      code: 'gemini/unsupported-schema-reference',
      message: `Gemini has no \`$ref\` field, so \`${inlined.ref}\` cannot be sent as a reference.`,
      path: inlined.path,
      compile: compilable('Inlines the referenced schema; no constraint is lost.'),
      docsUrl: DOC_URLS.schema,
    });
  }
}

function checkParameterNames(root: JsonSchema, add: Add): void {
  const properties = root.properties;
  if (!isPlainObject(properties)) return;
  for (const name of Object.keys(properties)) {
    if (PARAMETER_NAME_PATTERN.test(name) && name.length <= PARAMETER_NAME_MAX_LENGTH) continue;
    add({
      severity: 'warning',
      code: 'gemini/parameter-name-charset',
      message:
        `Parameter name \`${name}\` may be rejected. The \`@google/genai\` typings and the Vertex ` +
        'AI reference say parameter names must start with a letter or underscore, contain only ' +
        `a-z, A-Z, 0-9 and underscores, and be at most ${PARAMETER_NAME_MAX_LENGTH} characters; ` +
        'the Gemini Developer API reference does not state this, so the outcome is uncertain.',
      path: joinPath(ROOT_PATH, 'properties', name),
      compile: compilable('Emits the parameter name unchanged.'),
      docsUrl: DOC_URLS.functionDeclaration,
    });
  }
}

/**
 * Keys a parameterless root schema may carry and still be omitted entirely.
 * Anything else (`minProperties`, say) is a constraint that must be emitted.
 */
const PARAMETERLESS_ROOT_KEYS: ReadonlySet<string> = new Set([
  'type',
  'title',
  'description',
  'properties',
  'required',
  'propertyOrdering',
]);

/**
 * Whether the compiled `FunctionDeclaration` should omit `parameters`.
 *
 * The Gemini reference says `parameters` "can be left unset" for a function
 * with no parameters, and an empty `properties` map carries no constraint.
 */
export function omitsParameters(root: JsonSchema): boolean {
  const properties = root.properties;
  if (isPlainObject(properties) && Object.keys(properties).length > 0) return false;
  if (Array.isArray(root.required) && root.required.length > 0) return false;
  return Object.keys(root).every((key) => PARAMETERLESS_ROOT_KEYS.has(key));
}

function checkEmptyParameters(root: JsonSchema, add: Add): void {
  if (!omitsParameters(root)) return;
  add({
    severity: 'info',
    code: 'gemini/empty-parameters-omitted',
    message:
      'This tool declares no properties. The Gemini reference says `parameters` can be left ' +
      'unset for a function with no parameters, so SchemaPort omits the field entirely.',
    path: ROOT_PATH,
    compile: compilable('Emits a `FunctionDeclaration` with no `parameters` field.'),
    docsUrl: DOC_URLS.functionDeclaration,
  });
}

function checkSubschema(schema: JsonSchema, path: string, add: Add): void {
  checkAdditionalProperties(schema, path, add);
  checkOneOf(schema, path, add);
  checkDroppedKeywords(schema, path, add);
  checkConst(schema, path, add);
  checkEnum(schema, path, add);
  checkTypes(schema, path, add);
  checkTypeWithBranches(schema, path, add);
  checkUnknownKeywords(schema, path, add);
  checkEnforcement(schema, path, add);
}

function checkAdditionalProperties(schema: JsonSchema, path: string, add: Add): void {
  const value = schema.additionalProperties;
  if (value === undefined || value === true) return;
  const isClosed = value === false;
  add({
    severity: 'error',
    code: 'gemini/unsupported-additional-properties',
    message: isClosed
      ? 'Gemini has no `additionalProperties` field, so this object cannot be closed. The ' +
        'compiled schema accepts properties the canonical schema rejects.'
      : 'Gemini has no `additionalProperties` field, so the schema for extra properties cannot ' +
        'be sent. The compiled schema accepts extra properties of any shape.',
    path: joinPath(path, 'additionalProperties'),
    compile: compilableLossy(
      isClosed
        ? 'Drops `additionalProperties: false`; the object stays open.'
        : 'Drops the `additionalProperties` schema; extra properties become unconstrained.',
    ),
    docsUrl: DOC_URLS.schema,
  });
}

function checkOneOf(schema: JsonSchema, path: string, add: Add): void {
  if (!Array.isArray(schema.oneOf)) return;
  add({
    severity: 'error',
    code: 'gemini/unsupported-one-of',
    message:
      'Gemini has `anyOf` but no `oneOf`. Compiling to `anyOf` accepts values that match more ' +
      'than one branch, which `oneOf` rejects.',
    path: joinPath(path, 'oneOf'),
    compile: compilableLossy('Emits the branches as `anyOf`, losing the exactly-one requirement.'),
    docsUrl: DOC_URLS.schema,
  });
}

function checkDroppedKeywords(schema: JsonSchema, path: string, add: Add): void {
  for (const rule of DROPPED_KEYWORD_RULES) {
    if (schema[rule.keyword] === undefined) continue;
    add({
      severity: 'error',
      code: rule.code,
      message: `Gemini has no \`${rule.keyword}\` field, so ${rule.detail} cannot be expressed.`,
      path: joinPath(path, rule.keyword),
      compile: compilableLossy(`Drops \`${rule.keyword}\`; the constraint stops being expressed.`),
      docsUrl: DOC_URLS.schema,
    });
  }
}

function checkConst(schema: JsonSchema, path: string, add: Add): void {
  if (schema.const === undefined) return;
  const convertible = typeof schema.const === 'string';
  add({
    severity: 'error',
    code: 'gemini/unsupported-const',
    message: convertible
      ? 'Gemini has no `const` field, but a single-value `enum` says the same thing.'
      : 'Gemini has no `const` field, and its `enum` field only accepts strings, so a non-string ' +
        'constant cannot be expressed.',
    path: joinPath(path, 'const'),
    compile: convertible
      ? compilable('Emits `enum` with the single allowed value and `format: "enum"`.')
      : compilableLossy('Drops `const`; the value stops being pinned.'),
    docsUrl: DOC_URLS.schema,
  });
}

function checkEnum(schema: JsonSchema, path: string, add: Add): void {
  if (!Array.isArray(schema.enum)) return;
  if (schema.enum.every((value) => typeof value === 'string')) return;
  add({
    severity: 'error',
    code: 'gemini/non-string-enum-values',
    message:
      'Gemini declares `enum` as an array of strings, so this enum cannot be sent as written. ' +
      'The reference shows integers written as quoted strings ' +
      '(`{type:INTEGER, format:enum, enum:["101","201"]}`), but SchemaPort will not re-type ' +
      'values on your behalf.',
    path: joinPath(path, 'enum'),
    compile: compilableLossy('Drops `enum`; the value stops being restricted to the listed set.'),
    docsUrl: DOC_URLS.schema,
  });
}

function checkTypes(schema: JsonSchema, path: string, add: Add): void {
  const types = schemaTypes(schema);
  const unknown = types.filter((type) => GEMINI_TYPE_NAMES[type] === undefined);
  for (const type of unknown) {
    add({
      severity: 'error',
      code: 'gemini/unsupported-type',
      message: `\`${type}\` is not one of the Gemini \`Type\` enum values.`,
      path: joinPath(path, 'type'),
      compile: compilableLossy('Drops the unknown type; the value stops being type-constrained.'),
      docsUrl: DOC_URLS.schema,
    });
  }

  const nonNull = types.filter((type) => type !== 'null');
  if (nonNull.length > 1) {
    add({
      severity: 'warning',
      code: 'gemini/multi-type-union',
      message:
        'Gemini rejects a schema that sets both `type` and `anyOf`, so a multi-type `type` array ' +
        'is emitted as `anyOf` branches. Whether sibling constraints still apply to each branch ' +
        'is not documented.',
      path: joinPath(path, 'type'),
      compile: compilable('Emits one `anyOf` branch per type, mirroring the SDK conversion.'),
      docsUrl: DOC_URLS.schema,
    });
  }
}

function checkTypeWithBranches(schema: JsonSchema, path: string, add: Add): void {
  const hasBranches =
    (Array.isArray(schema.anyOf) && !isNullablePair(schema)) || Array.isArray(schema.oneOf);
  const types = schemaTypes(schema).filter((type) => type !== 'null');
  if (!hasBranches || types.length !== 1) return;
  add({
    severity: 'error',
    code: 'gemini/type-with-any-of',
    message:
      'Gemini rejects a schema that sets both `type` and `anyOf`, and this subschema declares a ' +
      'type alongside union branches.',
    path: joinPath(path, 'type'),
    compile: compilableLossy('Drops `type` and keeps the branches; the type constraint is lost.'),
    docsUrl: DOC_URLS.schema,
  });
}

function checkUnknownKeywords(schema: JsonSchema, path: string, add: Add): void {
  for (const keyword of Object.keys(schema)) {
    if ((ANNOTATION_KEYWORDS as readonly string[]).includes(keyword)) {
      add({
        severity: 'info',
        code: 'gemini/dropped-annotation-keyword',
        message: `\`${keyword}\` is an annotation Gemini has no field for. It constrains nothing, so dropping it changes no accepted value.`,
        path: joinPath(path, keyword),
        compile: compilable(`Drops \`${keyword}\`.`),
        docsUrl: DOC_URLS.schema,
      });
      continue;
    }
    if (HANDLED_KEYWORDS.has(keyword)) continue;
    add({
      severity: 'error',
      code: 'gemini/unsupported-keyword',
      message:
        `\`${keyword}\` is not a Gemini \`Schema\` field. The API rejects unknown fields, and ` +
        'SchemaPort cannot tell whether it constrains values, so it is treated as constraining.',
      path: joinPath(path, keyword),
      compile: compilableLossy(`Drops \`${keyword}\`; anything it constrained stops being checked.`),
      docsUrl: DOC_URLS.schema,
    });
  }
}

function checkEnforcement(schema: JsonSchema, path: string, add: Add): void {
  const present = UNENFORCED_CONSTRAINT_KEYWORDS.filter((k) => schema[k] !== undefined);
  if (present.length > 0) {
    add({
      severity: 'warning',
      code: 'gemini/constraint-not-enforced',
      message:
        `${present.map((k) => `\`${k}\``).join(', ')} ${present.length === 1 ? 'is' : 'are'} sent ` +
        'to Gemini, but only `FunctionCallingConfig.mode = VALIDATED` is documented to validate ' +
        'function calls with constrained decoding. Under the default `AUTO` mode these guide the ' +
        'model rather than bind it.',
      path,
      compile: compilable('Emits the constraint unchanged.'),
      docsUrl: DOC_URLS.functionCalling,
    });
  }

  if (schema.format !== undefined) {
    add({
      severity: 'warning',
      code: 'gemini/format-not-enforced',
      message:
        `\`format: ${JSON.stringify(schema.format)}\` is accepted, but the Gemini reference says ` +
        'any value is allowed and most trigger no special behaviour, so it may not be enforced.',
      path: joinPath(path, 'format'),
      compile: compilable('Emits `format` unchanged.'),
      docsUrl: DOC_URLS.schema,
    });
  }

  if (schema.default !== undefined) {
    add({
      severity: 'warning',
      code: 'gemini/default-not-enforced',
      message:
        '`default` is accepted, but the Gemini reference states it is included only so that ' +
        'schemas carrying it are not rejected, and that it does not affect validation.',
      path: joinPath(path, 'default'),
      compile: compilable('Emits `default` unchanged.'),
      docsUrl: DOC_URLS.schema,
    });
  }
}
