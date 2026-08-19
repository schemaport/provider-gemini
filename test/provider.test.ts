import type { FunctionDeclaration, Schema } from '@google/genai';
import { FIXTURE_TOOLS } from '@schemaport/core';
import { describe, expect, it } from 'vitest';

import defaultExport, {
  GEMINI_SCHEMA_FIELDS,
  GEMINI_TYPE_NAMES,
  INT64_KEYWORDS,
  geminiProvider,
} from '../src/index.js';

const FIELD_SET = new Set<string>(GEMINI_SCHEMA_FIELDS);
const TYPE_NAMES = new Set(Object.values(GEMINI_TYPE_NAMES));

function assertGeminiSchema(schema: Schema, path: string): void {
  for (const [key, value] of Object.entries(schema)) {
    expect(FIELD_SET.has(key), `${path}.${key} is not a Gemini Schema field`).toBe(true);
    if (key === 'type') expect(TYPE_NAMES.has(value as string), `${path}.type=${value}`).toBe(true);
    if ((INT64_KEYWORDS as readonly string[]).includes(key)) expect(typeof value).toBe('string');
  }
  for (const child of Object.values(schema.properties ?? {})) assertGeminiSchema(child, path);
  if (schema.items) assertGeminiSchema(schema.items, path);
  for (const branch of schema.anyOf ?? []) assertGeminiSchema(branch, path);
}

describe('provider metadata', () => {
  it('exposes the identity the CLI expects', () => {
    expect(geminiProvider.id).toBe('gemini');
    expect(geminiProvider.displayName).toBe('Gemini');
    expect(geminiProvider.rulesReviewedAt).toBe('2026-08-20');
    expect(geminiProvider.apiKeyEnvVar).toBe('GEMINI_API_KEY');
    expect(defaultExport).toBe(geminiProvider);
    expect(typeof geminiProvider.probe).toBe('function');
  });

  it('cites official documentation for its rules', () => {
    expect(geminiProvider.docs.length).toBeGreaterThan(0);
    for (const doc of geminiProvider.docs) {
      expect(doc.url).toMatch(/^https:\/\//);
      expect(doc.title.length).toBeGreaterThan(0);
    }
  });
});

describe('compiled output', () => {
  it('only ever uses fields the Gemini Schema object declares', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      const result = geminiProvider.compile(tool, { allowLossy: true });
      expect(result.ok).toBe(true);
      const declaration = result.output as FunctionDeclaration;
      expect(Object.keys(declaration).sort()).toEqual(
        Object.keys(declaration)
          .filter((key) => ['name', 'description', 'parameters'].includes(key))
          .sort(),
      );
      if (declaration.parameters) assertGeminiSchema(declaration.parameters, tool.name);
    }
  });

  it('uses `parameters`, never `parametersJsonSchema`', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      const declaration = geminiProvider.compile(tool, { allowLossy: true })
        .output as FunctionDeclaration;
      expect(declaration.parametersJsonSchema).toBeUndefined();
      expect(declaration.response).toBeUndefined();
    }
  });
});
