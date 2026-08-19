# Probing Gemini

`probe()` answers one question: **does the Gemini API accept this compiled
schema?** It sends the compiled `FunctionDeclaration`, one short user message,
and a small output cap. It never executes your function and never sends real
data.

## Setup

```sh
export GEMINI_API_KEY="..."          # primary
# or
export GOOGLE_API_KEY="..."          # fallback, also read by @google/genai
```

`GEMINI_API_KEY` is checked first. `GOOGLE_API_KEY` is supported because the
`@google/genai` SDK reads it too — note that the SDK itself prefers
`GOOGLE_API_KEY` when both are set, while SchemaPort prefers `GEMINI_API_KEY`.

With no key, probing returns `status: 'error'` and
`errorKind: 'missing-credentials'`. That is **not** a schema rejection.

## Model

| Source | Value |
| --- | --- |
| `options.model` | highest priority |
| `SCHEMAPORT_GEMINI_MODEL` | environment override |
| default | `gemini-2.5-flash-lite` |

The default is the cheapest model on the Gemini API pricing page whose model
card lists "Function calling: Supported"
(<https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite>).

```sh
SCHEMAPORT_GEMINI_MODEL=gemini-3.7-flash schemaport probe ./tools/refund_order.json --target gemini
```

## Commands

```sh
# Probe a tool with the default model
schemaport probe ./tools/refund_order.json --target gemini

# Probe a tool whose compilation is lossy (it is refused without this flag)
schemaport probe ./tools/tag_resource.json --target gemini --allow-lossy
```

Programmatically:

```ts
import { geminiProvider } from '@schemaport/provider-gemini';

const result = await geminiProvider.probe(refundOrderTool, {
  model: 'gemini-2.5-flash-lite',
  timeoutMs: 20_000,
});
```

## What the request looks like

- `model`: the resolved model id.
- `contents`: the one-line prompt from core's `probePrompt(tool)`, asking for a
  single call with placeholder values.
- `config.tools`: `[{ functionDeclarations: [<compiled declaration>] }]`.
- `config.maxOutputTokens`: `512`.
- `config.abortSignal`: set only when `options.timeoutMs` is given.

No `toolConfig` is sent, so the request uses the default `AUTO` function-calling
mode. `ANY` is documented to reject "very large or deeply nested schemas", which
would turn an otherwise fine schema into a false rejection, and `VALIDATED`
would enable constrained decoding and hide exactly the enforcement gaps the
probe is meant to reveal. Every accepted result carries a note saying so.

## Reading the result

| Outcome | `status` | `errorKind` | Meaning |
| --- | --- | --- | --- |
| Schema accepted | `accepted` | – | Gemini accepted the declaration. `argumentsValid` says whether the returned arguments satisfied your *canonical* schema. |
| Schema rejected | `rejected` | – | Gemini returned 400/422 about the request body. This is a real schema problem. |
| Compilation refused | `error` | `compile-refused` | Nothing was sent. Fix the schema or pass `allowLossy`. |
| No key | `error` | `missing-credentials` | Environment problem. |
| Bad key | `error` | `authentication` | Environment problem. |
| Unknown model | `error` | `model-not-found` | A stale model id, not a bad schema. |
| Throttled | `error` | `rate-limit` | Environment problem. |
| Never reached the API | `error` | `network` | Environment problem. |

`argumentsValid: false` on an `accepted` probe is the interesting case: Gemini
took the schema, but the model produced arguments the canonical schema rejects —
usually one of the constraints listed under `gemini/constraint-not-enforced`.

## Testing

`options.client` is a test seam. When it is supplied, the adapter uses it and
never constructs a client or reads the environment:

```ts
const result = await geminiProvider.probe(tool, {
  client: {
    models: {
      generateContent: async () => ({ functionCalls: [{ name: tool.name, args: {} }] }),
    },
  },
});
```

Every test in this package uses that seam. No test makes a network request.
