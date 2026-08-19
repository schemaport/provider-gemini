import type { CanonicalTool, JsonSchema } from '@schemaport/core';
import {
  constraintTool,
  minimalTool,
  nestedTool,
  openMapTool,
  refundOrderTool,
  unionTool,
} from '@schemaport/core';
import { describe, expect, it } from 'vitest';

import { geminiProvider } from '../src/index.js';

/** Wrap a property subschema in a valid canonical tool. */
function toolWith(property: JsonSchema, name = 'value'): CanonicalTool {
  return {
    name: 'probe_tool',
    description: 'A tool used by the compatibility tests',
    inputSchema: {
      type: 'object',
      properties: { [name]: property },
      required: [name],
    },
  };
}

function codes(tool: CanonicalTool): string[] {
  return geminiProvider.check(tool).map((item) => item.code);
}

function find(tool: CanonicalTool, code: string) {
  const diagnostic = geminiProvider.check(tool).find((item) => item.code === code);
  expect(diagnostic, `expected a ${code} diagnostic`).toBeDefined();
  return diagnostic!;
}

describe('valid fixtures', () => {
  it('reports no errors for the shared fixtures Gemini fully supports', () => {
    for (const tool of [refundOrderTool, minimalTool, nestedTool, unionTool]) {
      const errors = geminiProvider.check(tool).filter((item) => item.severity === 'error');
      expect(errors, `${tool.name} should have no errors`).toEqual([]);
    }
  });

  it('keeps `minimum` because Gemini declares it as a Schema field', () => {
    expect(codes(refundOrderTool)).not.toContain('gemini/unsupported-keyword');
    const warning = find(refundOrderTool, 'gemini/constraint-not-enforced');
    expect(warning.path).toBe('inputSchema.properties.amount');
  });
});

describe('invalid fixtures', () => {
  it('flags `additionalProperties` on the open-map fixture', () => {
    const diagnostic = find(openMapTool, 'gemini/unsupported-additional-properties');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.compile).toEqual({
      supported: true,
      lossy: true,
      detail: 'Drops the `additionalProperties` schema; extra properties become unconstrained.',
    });
    expect(diagnostic.path).toBe('inputSchema.properties.tags.additionalProperties');
  });

  it('flags `multipleOf` as the only error on the constraint fixture', () => {
    const errors = geminiProvider.check(constraintTool).filter((i) => i.severity === 'error');
    expect(errors.map((item) => item.code)).toEqual(['gemini/unsupported-multiple-of']);
  });
});

describe('every diagnostic', () => {
  it('carries the provider id, tool name, a gemini/ code and a docs URL', () => {
    for (const tool of [openMapTool, constraintTool, refundOrderTool, minimalTool]) {
      for (const diagnostic of geminiProvider.check(tool)) {
        expect(diagnostic.providerId).toBe('gemini');
        expect(diagnostic.toolName).toBe(tool.name);
        expect(diagnostic.code.startsWith('gemini/')).toBe(true);
        expect(diagnostic.docsUrl).toMatch(/^https:\/\//);
        expect(diagnostic.path.length).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic', () => {
    const first = JSON.stringify(geminiProvider.check(nestedTool));
    const second = JSON.stringify(geminiProvider.check(nestedTool));
    expect(first).toBe(second);
  });
});

describe('function declaration rules', () => {
  it('gemini/invalid-function-name rejects characters outside the documented set', () => {
    const tool: CanonicalTool = { ...minimalTool, name: 'refund order!' };
    const diagnostic = find(tool, 'gemini/invalid-function-name');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.compile.supported).toBe(false);
  });

  it('gemini/invalid-function-name rejects names longer than 128 characters', () => {
    const tool: CanonicalTool = { ...minimalTool, name: 'a'.repeat(129) };
    expect(codes(tool)).toContain('gemini/invalid-function-name');
  });

  it('gemini/function-name-leading-character warns about a leading digit', () => {
    const tool: CanonicalTool = { ...minimalTool, name: '1refund' };
    const diagnostic = find(tool, 'gemini/function-name-leading-character');
    expect(diagnostic.severity).toBe('warning');
    expect(codes(tool)).not.toContain('gemini/invalid-function-name');
  });

  it('gemini/missing-function-description warns when there is no description', () => {
    const diagnostic = find(minimalTool, 'gemini/missing-function-description');
    expect(diagnostic.severity).toBe('warning');
    expect(codes(refundOrderTool)).not.toContain('gemini/missing-function-description');
  });

  it('gemini/parameter-name-charset warns about a dotted parameter name', () => {
    const tool = toolWith({ type: 'string' }, 'order.id');
    const diagnostic = find(tool, 'gemini/parameter-name-charset');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.path).toBe('inputSchema.properties["order.id"]');
  });

  it('gemini/empty-parameters-omitted is an info on a parameterless tool', () => {
    const diagnostic = find(minimalTool, 'gemini/empty-parameters-omitted');
    expect(diagnostic.severity).toBe('info');
  });
});

describe('unsupported keywords', () => {
  const cases: [string, JsonSchema][] = [
    ['gemini/unsupported-one-of', { oneOf: [{ type: 'string' }, { type: 'number' }] }],
    ['gemini/unsupported-all-of', { allOf: [{ type: 'string' }] }],
    ['gemini/unsupported-not', { not: { type: 'string' } }],
    ['gemini/unsupported-multiple-of', { type: 'number', multipleOf: 5 }],
    ['gemini/unsupported-exclusive-minimum', { type: 'number', exclusiveMinimum: 0 }],
    ['gemini/unsupported-exclusive-maximum', { type: 'number', exclusiveMaximum: 10 }],
    ['gemini/unsupported-unique-items', { type: 'array', items: { type: 'string' }, uniqueItems: true }],
    ['gemini/unsupported-prefix-items', { type: 'array', prefixItems: [{ type: 'string' }] }],
    ['gemini/non-string-enum-values', { type: 'integer', enum: [1, 2, 3] }],
    ['gemini/unsupported-type', { type: 'decimal' }],
    ['gemini/unsupported-keyword', { type: 'object', patternProperties: { '^x-': { type: 'string' } } }],
  ];

  for (const [code, schema] of cases) {
    it(`${code} is an error compile can only fix lossily`, () => {
      const diagnostic = find(toolWith(schema), code);
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.compile.supported).toBe(true);
      expect(diagnostic.compile.lossy).toBe(true);
    });
  }

  it('gemini/unsupported-const is non-lossy for a string constant', () => {
    const diagnostic = find(toolWith({ type: 'string', const: 'refund' }), 'gemini/unsupported-const');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.compile).toMatchObject({ supported: true, lossy: false });
  });

  it('gemini/unsupported-const is lossy for a non-string constant', () => {
    const diagnostic = find(toolWith({ type: 'number', const: 7 }), 'gemini/unsupported-const');
    expect(diagnostic.compile).toMatchObject({ supported: true, lossy: true });
  });

  it('gemini/type-with-any-of fires when a subschema sets both', () => {
    const tool = toolWith({ type: 'string', anyOf: [{ type: 'string' }, { type: 'number' }] });
    const diagnostic = find(tool, 'gemini/type-with-any-of');
    expect(diagnostic.compile.lossy).toBe(true);
  });

  it('gemini/type-with-any-of does not fire for a nullable anyOf pair', () => {
    const tool = toolWith({ type: 'string', anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(codes(tool)).not.toContain('gemini/type-with-any-of');
  });

  it('gemini/multi-type-union warns about a multi-type `type` array', () => {
    const diagnostic = find(toolWith({ type: ['string', 'number'] }), 'gemini/multi-type-union');
    expect(diagnostic.severity).toBe('warning');
  });

  it('gemini/dropped-annotation-keyword is an info', () => {
    const diagnostic = find(
      toolWith({ type: 'string', examples: ['a'] }),
      'gemini/dropped-annotation-keyword',
    );
    expect(diagnostic.severity).toBe('info');
    expect(diagnostic.compile.lossy).toBe(false);
  });
});

describe('references', () => {
  const withDefs = (property: JsonSchema, defs: Record<string, JsonSchema>): CanonicalTool => ({
    name: 'ref_tool',
    description: 'Reference fixture',
    inputSchema: {
      type: 'object',
      properties: { value: property },
      required: ['value'],
      $defs: defs,
    },
  });

  it('gemini/unsupported-schema-reference is fixed by inlining', () => {
    const tool = withDefs({ $ref: '#/$defs/Pet' }, { Pet: { type: 'string' } });
    const diagnostic = find(tool, 'gemini/unsupported-schema-reference');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.compile).toMatchObject({ supported: true, lossy: false });
  });

  it('gemini/unresolvable-schema-reference blocks compilation for a recursive ref', () => {
    const tool = withDefs(
      { $ref: '#/$defs/Node' },
      { Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } } },
    );
    const diagnostic = find(tool, 'gemini/unresolvable-schema-reference');
    expect(diagnostic.compile.supported).toBe(false);
  });

  it('gemini/unresolvable-schema-reference blocks compilation for a dangling ref', () => {
    const tool = withDefs({ $ref: '#/$defs/Missing' }, { Pet: { type: 'string' } });
    expect(codes(tool)).toContain('gemini/unresolvable-schema-reference');
  });
});

describe('warning fixtures', () => {
  it('gemini/format-not-enforced warns for every `format`', () => {
    const diagnostic = find(
      toolWith({ type: 'string', format: 'email' }),
      'gemini/format-not-enforced',
    );
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.compile.lossy).toBe(false);
  });

  it('gemini/default-not-enforced warns that Gemini ignores `default`', () => {
    const diagnostic = find(toolWith({ type: 'string', default: 'x' }), 'gemini/default-not-enforced');
    expect(diagnostic.severity).toBe('warning');
  });

  it('gemini/constraint-not-enforced lists the keywords in a fixed order', () => {
    const diagnostic = find(
      toolWith({ type: 'string', maxLength: 5, minLength: 1, pattern: '^a' }),
      'gemini/constraint-not-enforced',
    );
    expect(diagnostic.message).toContain('`minLength`, `maxLength`, `pattern`');
  });
});
