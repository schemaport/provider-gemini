# Changelog

All notable changes to `@schemaport/provider-gemini` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-20

### Added

- `geminiProvider`, implementing `SchemaPortProvider` with `id: 'gemini'`,
  `rulesReviewedAt: '2026-08-20'` and `apiKeyEnvVar: 'GEMINI_API_KEY'`.
- `check()` with 27 compatibility rules, each carrying a stable `gemini/` code,
  a path into the canonical tool and an official documentation URL:
  - blocking errors — `gemini/invalid-function-name`,
    `gemini/unresolvable-schema-reference`;
  - errors compile fixes without loss — `gemini/unsupported-schema-reference`,
    `gemini/unsupported-const` (string values);
  - errors compile can only fix lossily —
    `gemini/unsupported-additional-properties`, `gemini/unsupported-one-of`,
    `gemini/unsupported-all-of`, `gemini/unsupported-not`,
    `gemini/unsupported-multiple-of`, `gemini/unsupported-exclusive-minimum`,
    `gemini/unsupported-exclusive-maximum`, `gemini/unsupported-unique-items`,
    `gemini/unsupported-prefix-items`, `gemini/non-string-enum-values`,
    `gemini/unsupported-const` (non-string values), `gemini/unsupported-type`,
    `gemini/type-with-any-of`, `gemini/boolean-subschema`,
    `gemini/unsupported-keyword`;
  - warnings — `gemini/constraint-not-enforced`, `gemini/format-not-enforced`,
    `gemini/default-not-enforced`, `gemini/missing-function-description`,
    `gemini/function-name-leading-character`, `gemini/parameter-name-charset`,
    `gemini/multi-type-union`;
  - infos — `gemini/empty-parameters-omitted`,
    `gemini/dropped-annotation-keyword`.
- `compile()`, producing a ready-to-send Gemini `FunctionDeclaration` whose
  `parameters` uses only the 22 fields the Gemini `Schema` object declares.
  Type names are emitted as `Type` enum values, int64 constraints as decimal
  strings, `$ref` is inlined, and `anyOf: [X, null]` collapses to
  `nullable: true`. Every change is recorded as a `Transformation`, and
  constraint-destroying changes are refused without `allowLossy`.
- `probe()` using `@google/genai`, defaulting to the `gemini-2.5-flash-lite`
  model, overridable via `options.model` and `SCHEMAPORT_GEMINI_MODEL`, with
  `GEMINI_API_KEY` as the primary credential and `GOOGLE_API_KEY` as a fallback.
  `options.client` is supported as a test seam.
- Documentation: `README.md`, `docs/gemini-support.md`, `docs/probing.md` and
  `docs/sources.md`, including the doc-versus-SDK disagreements found during
  review.

[0.1.0]: https://github.com/schemaport/provider-gemini/releases/tag/v0.1.0
