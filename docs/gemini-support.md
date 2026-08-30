# Gemini support

`rulesReviewedAt: 2026-08-20`. Sources are listed in
[`sources.md`](./sources.md); every rule below names the one it comes from.

SchemaPort compiles a canonical tool into a Gemini `FunctionDeclaration` whose
`parameters` field is a `Schema` — "a select subset of an OpenAPI 3.0 schema
object". The subset has exactly these 22 fields:

```
anyOf   default   description   enum      example   format
items   maxItems  maxLength     maxProperties       maximum
minItems          minLength     minProperties       minimum
nullable          pattern       properties          propertyOrdering
required          title         type
```

Nothing else is accepted, and the API rejects unknown fields.

## Keyword survival table

"Survives" means the constraint is still expressed in the compiled schema.
"Lossy" means compilation is refused unless the caller passes `--allow-lossy`.

| JSON Schema keyword | Survives? | Notes |
| --- | --- | --- |
| `type` | yes | rewritten to the `Type` enum name (`string` -> `STRING`) |
| `title` | yes | passed through |
| `description` | yes | passed through |
| `enum` (all strings) | yes | `format: "enum"` is added when `format` is absent |
| `enum` (any non-string member) | **no, lossy** | Gemini declares `enum` as `string[]` |
| `const` (string) | yes | emitted as a single-value `enum` |
| `const` (non-string) | **no, lossy** | no `const` field, and `enum` is strings only |
| `format` | yes, unenforced | the reference says most values trigger no special behaviour |
| `default` | yes, unenforced | the reference says it is accepted and ignored for validation |
| `nullable` | yes | passed through |
| `properties` | yes | recursed into |
| `required` | yes | passed through; optional stays optional |
| `propertyOrdering` | yes | passed through if you set it; generated on request — see [Property ordering](#property-ordering) |
| `additionalProperties: false` | **no, lossy** | no field for it; the object stays open |
| `additionalProperties: {schema}` | **no, lossy** | extra properties become unconstrained |
| `additionalProperties: true` | dropped, not lossy | Gemini objects are open already |
| `minProperties` / `maxProperties` | yes | emitted as int64 strings |
| `items` | yes | recursed into |
| `prefixItems` | **no, lossy** | no tuple support |
| `minItems` / `maxItems` | yes | emitted as int64 strings |
| `uniqueItems` | **no, lossy** | no field for it |
| `minimum` / `maximum` | yes | real `Schema` fields (numbers) |
| `exclusiveMinimum` / `exclusiveMaximum` | **no, lossy** | no field; not silently relaxed to inclusive bounds |
| `multipleOf` | **no, lossy** | no field for it |
| `minLength` / `maxLength` | yes | emitted as int64 strings |
| `pattern` | yes, unenforced | real field; enforcement is not promised |
| `anyOf` | yes | `anyOf: [X, {type:'null'}]` collapses to `nullable: true` |
| `oneOf` | **no, lossy** | emitted as `anyOf`, which accepts multi-branch matches |
| `allOf` | **no, lossy** | no field for it |
| `not` | **no, lossy** | no field for it |
| `$ref` (non-recursive, into root `$defs`/`definitions`) | yes | inlined at the use site |
| `$ref` (recursive or dangling) | **no** | compilation is refused outright |
| `$defs` / `definitions` | yes, via inlining | the map itself is removed after inlining |
| `examples`, `$schema`, `$id`, `$anchor`, `$comment`, `readOnly`, `writeOnly`, `deprecated` | dropped, not lossy | annotations; they constrain no value |
| `true` as a subschema | yes | emitted as an unconstrained `{}`, which accepts everything just as `true` did |
| `false` as a subschema | **no, lossy** | Gemini has no way to say "no value is valid"; it becomes an unconstrained `{}` |
| any other keyword | **no, lossy** | unknown fields are rejected by the API, so they are dropped and treated as constraining |

### Why int64 fields become strings

`minItems`, `maxItems`, `minLength`, `maxLength`, `minProperties` and
`maxProperties` are declared `string (int64 format)` in the discovery document
and `string` in the SDK's `Schema` interface, because proto3 JSON writes int64
as a decimal string. SchemaPort emits `"maxItems": "20"`, not `20`. Nothing is
lost; the value is identical.

### Why types are uppercased

`Schema.type` is the `Type` enum: `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`,
`ARRAY`, `OBJECT`, `NULL`. The official guide's REST examples use lowercase and
the SDK uppercases lowercase input for you, but the SDK's own `Schema` type only
accepts `Type`, and its converter throws on the literal string `'null'` while
accepting `'NULL'`. Emitting the enum names is therefore the only form that is
correct on every path.

Reading that converter also suggests SchemaPort's output passes through it
unchanged: uppercase types are idempotent, int64 strings fall through its
verbatim branch, and the output never contains `additionalProperties`, `$schema`
or a `type` next to an `anyOf`. That is an inference from the SDK source, not a
tested guarantee — the converter is internal and not exported, so no test in this
package asserts it.

## Compatibility rules

Every diagnostic carries a stable `code`, a `path` built with `joinPath`, and a
`docsUrl`.

### Errors that block compilation entirely

| Code | When |
| --- | --- |
| `gemini/invalid-function-name` | the name has characters outside `a-zA-Z0-9_.:-`, or is longer than 128 characters. Compile will not rename your tool. |
| `gemini/unresolvable-schema-reference` | a `$ref` is recursive, or does not point at a root-level `$defs`/`definitions` entry. It cannot be inlined into a finite schema. |

### Errors compile fixes without losing anything

| Code | Fix |
| --- | --- |
| `gemini/unsupported-schema-reference` | inlines the referenced subschema |
| `gemini/unsupported-const` (string value) | emits `enum: ["value"]` with `format: "enum"` |

### Errors compile can only fix lossily

Compilation is refused unless `--allow-lossy` is passed.

| Code | What is lost |
| --- | --- |
| `gemini/unsupported-additional-properties` | `additionalProperties: false` or a schema for extra properties |
| `gemini/unsupported-one-of` | the exactly-one-branch requirement (`oneOf` becomes `anyOf`) |
| `gemini/unsupported-all-of` | every `allOf` subschema |
| `gemini/unsupported-not` | the negated subschema |
| `gemini/unsupported-multiple-of` | the divisibility constraint |
| `gemini/unsupported-exclusive-minimum` | the exclusive lower bound |
| `gemini/unsupported-exclusive-maximum` | the exclusive upper bound |
| `gemini/unsupported-unique-items` | array uniqueness |
| `gemini/unsupported-prefix-items` | positional tuple types |
| `gemini/non-string-enum-values` | the whole `enum` (Gemini's is `string[]`) |
| `gemini/unsupported-const` (non-string value) | the pinned value |
| `gemini/unsupported-type` | a `type` value that is not a Gemini `Type` |
| `gemini/type-with-any-of` | the `type` of a subschema that also has union branches, because Gemini rejects both together |
| `gemini/boolean-subschema` | a `false` subschema, which accepts nothing and has no Gemini equivalent |
| `gemini/unsupported-keyword` | any other keyword with no Gemini field; SchemaPort assumes it constrains values |

### Warnings

The schema compiles, but the compiled form behaves differently or its acceptance
is uncertain.

| Code | Why |
| --- | --- |
| `gemini/constraint-not-enforced` | `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `minProperties`, `maxProperties` are sent, but only `FunctionCallingConfig.mode = VALIDATED` is documented to validate calls with constrained decoding. Under the default `AUTO` mode they guide the model. |
| `gemini/format-not-enforced` | the reference says any `format` value is allowed and most trigger no special functionality. |
| `gemini/default-not-enforced` | the reference states `default` is accepted only so schemas carrying it are not rejected, and does not affect validation. |
| `gemini/missing-function-description` | the Gemini Developer API reference marks `FunctionDeclaration.description` **required**; the SDK typings and the Vertex AI reference mark it optional. SchemaPort cannot tell which wins, and will not invent a description. |
| `gemini/function-name-leading-character` | the name does not start with a letter or underscore. Vertex AI and the SDK require that; the Developer API reference does not mention it. |
| `gemini/parameter-name-charset` | a top-level parameter name is not `[A-Za-z_][A-Za-z0-9_]*` or is longer than 64 characters. The SDK typings and Vertex AI state this rule; the Developer API reference does not. |
| `gemini/multi-type-union` | a multi-type `type` array is emitted as `anyOf` branches; whether sibling constraints still apply to each branch is undocumented. |

### Turning constraints into enforcement with VALIDATED mode

Every `gemini/constraint-not-enforced` warning has the same underlying cause and
the same possible remedy, so it is worth stating once rather than per keyword.

Gemini accepts `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`,
`minItems`, `maxItems`, `minProperties` and `maxProperties` — SchemaPort emits
them unchanged, and nothing is dropped. What is not promised is *enforcement*.
Under the default `FunctionCallingConfig.mode = AUTO`, the documented behaviour
is that the schema guides the model. Only `mode = VALIDATED` is documented to
validate function calls with constrained decoding.

That mode is a property of your **request**, not of the compiled tool, so
SchemaPort cannot set it for you. It lives alongside `tools` in the
`generateContent` call:

```ts
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash-lite',
  contents: 'Refund order ord_123',
  config: {
    tools: [{ functionDeclarations: [compiled] }],
    toolConfig: {
      functionCallingConfig: { mode: 'VALIDATED' },
    },
  },
})
```

Two caveats before you reach for it:

- SchemaPort has **not** verified this end to end. No live Gemini call has been
  made from this repository, so treat the snippet as the documented shape rather
  than a tested result. `schemaport probe --targets gemini` with your own key is
  the way to confirm it against the current API.
- The warning is still correct with `VALIDATED` set. SchemaPort reports what the
  *compiled schema* guarantees on its own, and it cannot see your request
  configuration.

If you need a constraint enforced regardless of mode, validate the returned
arguments yourself — `validateValue` from `@schemaport/core` checks a tool call
against the canonical schema.

### Infos

| Code | Why |
| --- | --- |
| `gemini/empty-parameters-omitted` | the tool declares no properties, so `parameters` is left unset, as the reference permits. |
| `gemini/dropped-annotation-keyword` | an annotation such as `examples` or `$schema` was dropped. It constrains no value. |

## Transformations

`compile()` records every change. `lossy: true` is the gate that makes
compilation refuse without `--allow-lossy`.

### Representation changes (`lossy: false`)

| Code | What it does |
| --- | --- |
| `renamed-input-schema-to-parameters` | emits `inputSchema` as `FunctionDeclaration.parameters` |
| `omitted-empty-parameters` | omits `parameters` for a function with no properties |
| `normalized-type-case` | rewrites `type` values to `Type` enum names |
| `int64-constraint-as-string` | encodes the six int64 fields as decimal strings |
| `collapsed-nullable-any-of` | `anyOf: [X, {type:'null'}]` -> `X` plus `nullable: true` |
| `converted-null-type-to-nullable` | moves `'null'` out of a `type` array into `nullable` |
| `converted-type-array-to-any-of` | emits a multi-type `type` array as `anyOf` branches |
| `converted-const-to-enum` | emits a string `const` as a single-value `enum` |
| `added-enum-format` | adds `format: "enum"` beside an `enum`, as the reference prescribes |
| `inlined-schema-reference` | inlines one `$ref` |
| `dropped-schema-definitions` | removes `$defs`/`definitions` after inlining |
| `dropped-annotation-keyword` | drops an annotation keyword |
| `dropped-open-additional-properties` | drops `additionalProperties: true`, which constrained nothing |
| `converted-true-subschema` | emits a `true` subschema as an unconstrained `{}` |
| `generated-property-ordering` | adds a `propertyOrdering` the schema did not declare |
| `kept-declared-property-ordering` | keeps a declared ordering in a generating mode |

### Constraint-destroying changes (`lossy: true`)

| Code | What is dropped |
| --- | --- |
| `dropped-additional-properties` | `additionalProperties: false` or its schema |
| `converted-one-of-to-any-of` | the exactly-one-branch requirement |
| `dropped-all-of` | `allOf` |
| `dropped-not` | `not` |
| `dropped-multiple-of` | `multipleOf` |
| `dropped-exclusive-minimum` | `exclusiveMinimum` |
| `dropped-exclusive-maximum` | `exclusiveMaximum` |
| `dropped-unique-items` | `uniqueItems` |
| `dropped-prefix-items` | `prefixItems` |
| `dropped-const` | a non-string `const` |
| `dropped-non-string-enum` | an `enum` with non-string members |
| `dropped-unknown-type` | a `type` value that is not a Gemini `Type` |
| `dropped-type-beside-any-of` | `type` on a subschema that also has union branches |
| `widened-false-subschema` | a `false` subschema, which accepted nothing |
| `dropped-unsupported-keyword` | any other unrecognised keyword |

## Property ordering

Gemini reads `propertyOrdering` to decide what order to emit object keys in.
Without one the order is unspecified, so a schema that reads naturally to a
person can come back with its fields shuffled.

`compileGeminiTool` takes a mode:

```ts
compileGeminiTool(tool, { propertyOrdering: 'declaration' });
compileGeminiTool(tool, { propertyOrdering: 'required-first' });
```

| Mode | Ordering |
| --- | --- |
| `preserve` *(default)* | Only what the schema declares. Nothing is generated. |
| `declaration` | The canonical `properties` key order. |
| `required-first` | Required properties in `required` order, then the rest in declaration order. |

For

```json
{
  "type": "object",
  "properties": { "note": {}, "orderId": {}, "quantity": {} },
  "required": ["orderId", "quantity"]
}
```

`declaration` emits `["note", "orderId", "quantity"]` and `required-first`
emits `["orderId", "quantity", "note"]`.

Ordering is applied to **every** object schema, not just the root — nested
objects and objects inside `items` get one too.

### A declared ordering always wins

The generating modes fill a gap; they never overrule an author. If the
canonical schema declares `propertyOrdering`, that ordering is emitted
unchanged even under `declaration` or `required-first`, and the compile
records `kept-declared-property-ordering` so a caller who asked for an
ordering and got a different one can see why.

### Two details

- **`required-first` skips a `required` entry that `properties` does not
  declare.** `required: ["a", "ghost"]` with only `a` declared orders `["a"]`.
  Naming `ghost` would order a key Gemini will never emit.
- **An object with no properties gets no `propertyOrdering` at all.** An empty
  array is not "no opinion" to Gemini — it would say to emit no keys.

### Not lossy

An ordering adds information and destroys no constraint, so both
transformations are `lossy: false` and neither needs `--allow-lossy`.

### Why this is opt-in

Generating an ordering changes what the model emits, and SchemaPort does not
invent schema content unprompted. But almost nobody writes `propertyOrdering`
by hand, and the order they want is nearly always the order they already wrote
the properties in — so the capability exists, behind a flag, and the default
stays `preserve`.

## Documentation links on diagnostics

Every diagnostic carries a `docsUrl`. Schema-field rules point at the
function-calling guide, which is the page that states the subset rule and was
verified to render it. Rules that come from a field description point at the
discovery document, and rules that come from the SDK's own typings point at the
SDK repository. The `ai.google.dev/api/caching#Schema` anchor is rendered client
side and could not be confirmed during review, so it is listed as a source but
is not used as a `docsUrl`.

## Known limitations

- **`parametersJsonSchema` is not emitted.** `FunctionDeclaration` also has a
  `parametersJsonSchema` field that takes full JSON Schema (including
  `additionalProperties`) and is mutually exclusive with `parameters`. Version
  0.1.0 always emits `parameters`, so schemas that need `additionalProperties`
  or `$ref` are reported as lossy even though that other field might carry them.
  This is a deliberate scope decision, not a claim that the field does not work.
- **Enforcement is a warning, never a promise.** SchemaPort sends constraints
  Gemini accepts, but does not claim the model obeys them. `probe()` validates
  returned arguments against the *canonical* schema so that a constraint Gemini
  ignored shows up as an argument mismatch.
- **Numbers in enums are not re-typed.** The reference documents writing integer
  enums as quoted strings (`{type:INTEGER, format:enum, enum:["101","201"]}`).
  SchemaPort will not change your value types on your behalf, so a non-string
  enum is reported as lossy instead.
- **`propertyOrdering` is never generated unless you ask.** The default
  (`preserve`) emits only an ordering the schema already declares, because
  generating one changes what the model emits and SchemaPort does not invent
  schema content unprompted. `declaration` and `required-first` opt in to
  generating one. A declared ordering always wins over a generated one — see
  [Property ordering](#property-ordering).
- **Only top-level parameter names are name-checked.** The naming rule
  SchemaPort found is stated for parameters, not for nested property names.
- **Vertex AI is not a separate target.** Vertex AI's `Schema` additionally
  declares `additionalProperties`, `defs` and `ref` (see
  [`sources.md`](./sources.md)), but the installed SDK's `Schema` type declares
  none of them and its converter deletes `additionalProperties` on both
  backends. The `gemini` target therefore applies the narrower Developer API
  rules everywhere.
- **Definitions are checked at their use sites.** `check()` runs after `$ref`
  inlining, so a `$defs` entry that nothing references is dropped without being
  checked, and one that is referenced twice is reported twice — once per path
  where it lands.
