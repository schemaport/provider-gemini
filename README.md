# @schemaport/provider-gemini

Gemini compatibility checks, compilation and live probing for
[SchemaPort](https://github.com/schemaport).

Gemini is the most restrictive of SchemaPort's four targets.
`FunctionDeclaration.parameters` is not JSON Schema: it is a *select subset of
an OpenAPI 3.0 schema object* with **22 fields**. There is no
`additionalProperties`, no `$ref`, no `oneOf`, no `allOf`, no `multipleOf` and
no `exclusiveMinimum`/`exclusiveMaximum`. This package refuses to drop any of
those silently.

- **Rules reviewed:** `2026-08-20`
- **Checked against:** Gemini Developer API discovery document `v1beta`
  (revision `20260816`), Vertex AI discovery document `v1` (revision
  `20260808`), and `@google/genai@2.17.1` TypeScript typings.
- **Default probe model:** `gemini-2.5-flash-lite`

## Install

```sh
npm install @schemaport/provider-gemini
```

## Usage

```ts
import { geminiProvider } from '@schemaport/provider-gemini';

const tool = {
  name: 'refund_order',
  description: 'Refunds all or part of an order',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'The order to refund' },
      amount: { type: 'number', minimum: 0 },
    },
    required: ['orderId'],
  },
};

geminiProvider.check(tool);          // Diagnostic[]
geminiProvider.compile(tool);        // CompileResult with a FunctionDeclaration
await geminiProvider.probe(tool);    // ProbeResult (needs GEMINI_API_KEY)
```

`compile()` returns a `FunctionDeclaration` you can send as-is:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "orderId": { "type": "STRING", "description": "The order to refund" },
      "amount": { "type": "NUMBER", "minimum": 0 }
    },
    "required": ["orderId"]
  }
}
```

Two things to notice:

- **`minimum` survives.** Gemini declares `minimum` and `maximum` as `Schema`
  fields, so `refund_order` compiles **without `--allow-lossy`**. `check()` does
  emit a `gemini/constraint-not-enforced` warning, because only
  `FunctionCallingConfig.mode = VALIDATED` is documented to validate calls with
  constrained decoding.
- **Optional properties stay optional.** Unlike OpenAI's strict mode, Gemini's
  `required` is a plain list, so an optional property is simply left out of it.
  No optional-to-nullable conversion happens, and nothing is lost.

## What compiles cleanly, and what does not

| Shared fixture | `compile()` without `--allow-lossy` | Why |
| --- | --- | --- |
| `refund_order` | compiles | `minimum` is a real Gemini field |
| `ping` | compiles | `parameters` is omitted for a parameterless function |
| `create_ticket` | compiles | every keyword it uses has a Gemini field |
| `set_limit` | compiles | `anyOf: [X, null]` becomes `nullable: true` |
| `tag_resource` | **refused** | `additionalProperties: {type: 'string'}` must be dropped |
| `schedule_job` | **refused** | `multipleOf` has no Gemini field |

## Documentation

- [`docs/gemini-support.md`](docs/gemini-support.md) — every JSON Schema keyword
  and whether it survives, every rule with its code, every transformation and
  its lossy classification, known limitations.
- [`docs/probing.md`](docs/probing.md) — probe setup, environment variables and
  exact commands.
- [`docs/sources.md`](docs/sources.md) — the sources behind every rule, and the
  places where the official documentation and the SDK typings disagree.

## Licence

MIT
