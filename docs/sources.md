# Sources and reconciliation

`rulesReviewedAt: 2026-08-20`

Every rule in this package comes from one of the sources below. Where they
disagree, the disagreement is written down here and turned into a warning rather
than a guess.

## Sources

| Source | Used for |
| --- | --- |
| <https://ai.google.dev/gemini-api/docs/function-calling> | "Only a subset of the OpenAPI schema is supported"; function-calling modes `auto`, `any`, `none`, `validated`; "For `any` mode, the API may reject very large or deeply nested schemas". |
| <https://ai.google.dev/api/caching#FunctionDeclaration> | the `FunctionDeclaration` reference the function-calling guide links to as the definition of the supported subset. |
| <https://ai.google.dev/api/caching#Schema> | the `Schema` reference. |
| <https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta> | **machine-readable ground truth** for `Schema`, `FunctionDeclaration` and `FunctionCallingConfig`. Read at revision `20260816`. |
| <https://aiplatform.googleapis.com/$discovery/rest?version=v1> | the Vertex AI equivalent, read at revision `20260808`. |
| <https://cloud.google.com/vertex-ai/docs/reference/rest/v1/Schema> | the Vertex AI `Schema` reference. |
| <https://ai.google.dev/gemini-api/docs/structured-output> | structured output, which is a different feature from function calling. |
| <https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite> | the probe model's capability list ("Function calling: Supported") and its model code. |
| <https://ai.google.dev/gemini-api/docs/pricing> | which current model is cheapest. |
| `@google/genai@2.17.1` (`dist/genai.d.ts`, `dist/node/index.mjs`) | the installed SDK's `Schema`, `FunctionDeclaration` and `Type` types, and the `processJsonSchema` converter it runs before sending. |

## The confirmed `Schema` field set

The Gemini Developer API discovery document (`v1beta`, revision `20260816`) and
`@google/genai@2.17.1`'s `export declare interface Schema` list **exactly the
same 22 fields**:

`anyOf`, `default`, `description`, `enum`, `example`, `format`, `items`,
`maxItems`, `maxLength`, `maxProperties`, `maximum`, `minItems`, `minLength`,
`minProperties`, `minimum`, `nullable`, `pattern`, `properties`,
`propertyOrdering`, `required`, `title`, `type`.

Answers to the specific keywords SchemaPort had to decide on:

| Keyword | In `functionDeclarations[].parameters`? | Evidence |
| --- | --- | --- |
| `type` | yes, as the `Type` enum | discovery `Schema.type` enum `TYPE_UNSPECIFIED, STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT, NULL`; SDK `enum Type` |
| `format` | yes | discovery: "Any value is allowed, but most do not trigger any special functionality" |
| `title` | yes | discovery + SDK |
| `description` | yes | discovery + SDK |
| `nullable` | yes | discovery + SDK |
| `enum` | yes, `string[]` only | discovery `enum.items.type = string` |
| `properties` | yes | discovery + SDK |
| `required` | yes | discovery + SDK |
| `items` | yes | discovery + SDK |
| `minItems` / `maxItems` | yes, `string (int64)` | discovery `format: int64`, SDK `?: string` |
| `minimum` / `maximum` | **yes**, `number (double)` | discovery `format: double`, SDK `?: number` |
| `minLength` / `maxLength` | yes, `string (int64)` | discovery + SDK |
| `pattern` | yes | discovery + SDK |
| `minProperties` / `maxProperties` | yes, `string (int64)` | discovery + SDK |
| `propertyOrdering` | yes | discovery: "Not a standard field in open api spec" |
| `default` | yes, but ignored | discovery: "intended for documentation generators and doesn't affect validation. Thus it's included here and ignored so that developers who send schemas with a `default` field don't get unknown-field errors" |
| `anyOf` | yes | discovery + SDK |
| `oneOf` | **no** | absent from both |
| `allOf` | **no** | absent from both |
| `additionalProperties` | **no** on the Gemini Developer API | absent from the v1beta discovery document and from the SDK type. Present on Vertex AI — see below |
| `$ref` | **no** | absent; Vertex AI has `ref`, see below |
| `$defs` | **no** | absent; Vertex AI has `defs`, see below |
| `multipleOf` | **no** | absent from both |
| `exclusiveMinimum` / `exclusiveMaximum` | **no** | absent from both |
| `const` | **no** | absent from both |
| `uniqueItems` | **no** | absent from both |

Because `minimum` is a genuine `Schema` field, the shared `refund_order` fixture
(`amount: {type: 'number', minimum: 0}`) **compiles without `--allow-lossy`**.
That is pinned by a test.

## Disagreements found

### 1. Developer API vs Vertex AI: three extra fields

Vertex AI's `Schema` (`GoogleCloudAiplatformV1Schema`, discovery revision
`20260808`) declares three fields the Gemini Developer API does not:

- `additionalProperties` — "If it is a boolean `false`, no additional properties
  are allowed. If it is a schema, additional properties are allowed if they
  conform to the schema."
- `defs` — "provides a map of schema definitions that can be reused by `ref`
  elsewhere in the schema. Only allowed at root level of the schema."
- `ref` — "Allows referencing another schema definition to use in place of this
  schema."

**How SchemaPort resolves it:** the narrower Developer API set is applied
everywhere. Two reasons. First, the installed SDK's `Schema` type declares none
of the three, so a Vertex-only field will not type-check. Second, the SDK's
`processJsonSchema` converter — which runs on `functionDeclaration.parameters`
before the request is sent, on **both** backends — contains:

```js
// additionalProperties is not included in JSONSchema, skipping it.
if (fieldName === 'additionalProperties') { continue; }
```

so `additionalProperties` is deleted before it reaches either API. Treating it
as unsupported is therefore the honest answer for anyone using this SDK.

### 2. Is `FunctionDeclaration.description` required?

- Gemini Developer API discovery (`v1` and `v1beta`): **"Required.** A brief
  description of the function."
- Vertex AI discovery: "*Optional.* Description and purpose of the function."
- `@google/genai` typings: `description?: string`.

**How SchemaPort resolves it:** a `gemini/missing-function-description`
**warning** that states the disagreement. Compiling never invents a description.

### 3. Does the function name have to start with a letter or underscore?

- Gemini Developer API discovery: "Must be a-z, A-Z, 0-9, or contain
  underscores, colons, dots, and dashes, with a maximum length of 128."
- Vertex AI discovery and the SDK typings add: "Must start with a letter or an
  underscore."

**How SchemaPort resolves it:** the part both agree on is an **error**
(`gemini/invalid-function-name`); the leading-character rule only Vertex and the
SDK state is a **warning** (`gemini/function-name-leading-character`).

### 4. Parameter-name charset

The SDK's `FunctionDeclaration.parameters` doc comment and the Vertex AI
reference say: "Parameter names must start with a letter or an underscore and
must only contain chars a-z, A-Z, 0-9, or underscores with a maximum length of
64." The Gemini Developer API discovery document does not state this.

**How SchemaPort resolves it:** a `gemini/parameter-name-charset` **warning** on
top-level parameter names only.

### 5. Type casing: docs show lowercase, the reference defines an enum

The function-calling guide's REST examples use `"type": "string"`, while
`Schema.type` is a proto enum whose values are `STRING`, `NUMBER`, and so on.
The SDK resolves this by uppercasing (`fieldValue.toUpperCase()`), and throws on
a bare `'null'` type while accepting `'NULL'`.

**How SchemaPort resolves it:** it emits the enum names. This is correct for the
reference, correct for the SDK's `Schema` type, and unchanged by the SDK's own
conversion — so the output is stable whether you post it as raw REST or hand it
to `@google/genai`.

## Enforcement, strict mode and structured output

- `FunctionCallingConfig.mode` has four documented values plus the unspecified
  one: `AUTO` (default), `ANY`, `NONE` and **`VALIDATED`** — "Model decides to
  predict either a function call or a natural language response, but will
  validate function calls with **constrained decoding**." That is the closest
  thing Gemini has to a strict mode for function calls, and it is a request-level
  setting, not a schema field. SchemaPort does not set it, and warns that
  constraints are not enforced under the default mode.
- **Structured output is a different feature.** `GenerateContentConfig` has
  `responseSchema` (the same `Schema` subset) and `responseJsonSchema` (full
  JSON Schema). Neither affects function declarations, and SchemaPort does not
  emit them.
- `FunctionDeclaration` also has `parametersJsonSchema`, "mutually exclusive
  with `parameters`", which takes full JSON Schema including
  `additionalProperties`. Present on both the Gemini Developer API (v1beta) and
  Vertex AI; absent from the Developer API `v1` discovery document. SchemaPort
  0.1.0 always emits `parameters`. Note that the SDK reroutes `parameters` to
  `parametersJsonSchema` whenever the object contains a `$schema` key, which is
  why compilation always drops `$schema`.
