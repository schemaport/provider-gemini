import type { FunctionDeclaration } from '@google/genai';
import type { CanonicalTool, CompileResult, JsonSchema } from '@schemaport/core';
import {
  FIXTURE_TOOLS,
  constraintTool,
  minimalTool,
  nestedTool,
  openMapTool,
  refundOrderTool,
  unionTool,
} from '@schemaport/core';
import { describe, expect, it } from 'vitest';

import { geminiProvider } from '../src/index.js';

function declaration(result: CompileResult): FunctionDeclaration {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return result.output as FunctionDeclaration;
}

function toolWith(property: JsonSchema): CanonicalTool {
  return {
    name: 'probe_tool',
    description: 'A tool used by the compilation tests',
    inputSchema: { type: 'object', properties: { value: property }, required: ['value'] },
  };
}

function transformationCodes(result: CompileResult): string[] {
  return result.transformations.map((item) => item.code);
}

describe('compile()', () => {
  it('produces a ready-to-send FunctionDeclaration for refund_order without --allow-lossy', () => {
    const result = geminiProvider.compile(refundOrderTool);
    expect(result.ok).toBe(true);
    expect(declaration(result)).toEqual({
      name: 'refund_order',
      description: 'Refunds all or part of an order',
      parameters: {
        type: 'OBJECT',
        properties: {
          orderId: { type: 'STRING', description: 'The order to refund' },
          amount: {
            type: 'NUMBER',
            description: 'Amount to refund. Omit to refund the full order.',
            minimum: 0,
          },
        },
        required: ['orderId'],
      },
    });
  });

  it('records only representation changes for refund_order', () => {
    const result = geminiProvider.compile(refundOrderTool);
    expect(result.transformations.every((item) => !item.lossy)).toBe(true);
    expect(transformationCodes(result)).toEqual([
      'renamed-input-schema-to-parameters',
      'normalized-type-case',
    ]);
  });

  it('keeps the optional property optional: Gemini needs no nullable conversion', () => {
    const parameters = declaration(geminiProvider.compile(refundOrderTool)).parameters;
    expect(parameters?.required).toEqual(['orderId']);
    expect(parameters?.properties?.['amount']?.nullable).toBeUndefined();
  });

  it('omits `parameters` for a tool with no properties', () => {
    const result = geminiProvider.compile(minimalTool);
    expect(declaration(result)).toEqual({ name: 'ping' });
    expect(transformationCodes(result)).toEqual(['omitted-empty-parameters']);
  });

  it('emits int64 constraints as strings and enums with format "enum"', () => {
    const parameters = declaration(geminiProvider.compile(nestedTool)).parameters;
    expect(parameters?.properties?.['title']).toEqual({
      type: 'STRING',
      minLength: '1',
      maxLength: '200',
    });
    expect(parameters?.properties?.['labels']?.maxItems).toBe('20');
    expect(parameters?.properties?.['priority']).toEqual({
      type: 'STRING',
      format: 'enum',
      enum: ['low', 'medium', 'high'],
    });
  });

  it('collapses `anyOf: [X, null]` into `nullable: true`', () => {
    const result = geminiProvider.compile(unionTool);
    expect(declaration(result).parameters?.properties?.['limit']).toEqual({
      type: 'NUMBER',
      nullable: true,
      minimum: 1,
    });
    const collapse = result.transformations.find((i) => i.code === 'collapsed-nullable-any-of');
    expect(collapse?.lossy).toBe(false);
  });

  it('uppercases every type to the Gemini Type enum name', () => {
    const parameters = declaration(geminiProvider.compile(nestedTool)).parameters;
    const types = JSON.stringify(parameters).match(/"type":"[^"]+"/g) ?? [];
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) expect(type).toMatch(/"type":"[A-Z]+"/);
  });
});

describe('the lossy gate', () => {
  it('refuses tag_resource because `additionalProperties` would be dropped', () => {
    const result = geminiProvider.compile(openMapTool);
    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain('core/lossy-transformation-refused');
    const dropped = result.transformations.find((i) => i.code === 'dropped-additional-properties');
    expect(dropped?.lossy).toBe(true);
  });

  it('compiles tag_resource once lossy output is allowed', () => {
    const result = geminiProvider.compile(openMapTool, { allowLossy: true });
    expect(declaration(result).parameters?.properties?.['tags']).toEqual({ type: 'OBJECT' });
  });

  it('refuses schedule_job because of `multipleOf` alone', () => {
    const result = geminiProvider.compile(constraintTool);
    expect(result.ok).toBe(false);
    expect(result.transformations.filter((item) => item.lossy).map((item) => item.code)).toEqual([
      'dropped-multiple-of',
    ]);
  });

  it('drops `multipleOf` with --allow-lossy but keeps minimum and maximum', () => {
    const result = geminiProvider.compile(constraintTool, { allowLossy: true });
    expect(declaration(result).parameters?.properties?.['runEvery']).toEqual({
      type: 'INTEGER',
      minimum: 60,
      maximum: 86400,
    });
  });

  it('refuses a recursive reference outright, even with --allow-lossy', () => {
    const tool: CanonicalTool = {
      name: 'walk_tree',
      description: 'Recursive fixture',
      inputSchema: {
        type: 'object',
        properties: { node: { $ref: '#/$defs/Node' } },
        required: ['node'],
        $defs: { Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } } },
      },
    };
    const result = geminiProvider.compile(tool, { allowLossy: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(
      'gemini/unresolvable-schema-reference',
    );
  });
});

describe('transformations', () => {
  it('inlines a `$ref` without losing anything', () => {
    const tool: CanonicalTool = {
      name: 'adopt_pet',
      description: 'Reference fixture',
      inputSchema: {
        type: 'object',
        properties: { pet: { $ref: '#/$defs/Pet', description: 'The pet' } },
        required: ['pet'],
        $defs: { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    };
    const result = geminiProvider.compile(tool);
    expect(result.ok).toBe(true);
    expect(declaration(result).parameters?.properties?.['pet']).toEqual({
      type: 'OBJECT',
      description: 'The pet',
      properties: { name: { type: 'STRING' } },
    });
    expect(result.transformations.filter((item) => item.lossy)).toEqual([]);
    expect(transformationCodes(result)).toContain('dropped-schema-definitions');
  });

  it('drops `$schema` so the SDK does not reroute the payload to parametersJsonSchema', () => {
    const tool: CanonicalTool = {
      name: 'tagged',
      description: 'Carries a draft identifier keyword',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    };
    const result = geminiProvider.compile(tool);
    expect(JSON.stringify(declaration(result))).not.toContain('$schema');
    const dropped = result.transformations.find((i) => i.code === 'dropped-annotation-keyword');
    expect(dropped?.lossy).toBe(false);
  });

  it('converts `oneOf` to `anyOf` and marks it lossy', () => {
    const tool = toolWith({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    const result = geminiProvider.compile(tool, { allowLossy: true });
    expect(declaration(result).parameters?.properties?.['value']).toEqual({
      anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }],
    });
    const converted = result.transformations.find((i) => i.code === 'converted-one-of-to-any-of');
    expect(converted?.lossy).toBe(true);
  });

  it('converts a string `const` into a single-value enum without loss', () => {
    const result = geminiProvider.compile(toolWith({ type: 'string', const: 'refund' }));
    expect(result.ok).toBe(true);
    expect(declaration(result).parameters?.properties?.['value']).toEqual({
      type: 'STRING',
      format: 'enum',
      enum: ['refund'],
    });
  });

  it('moves a `null` member of a type array into `nullable`', () => {
    const result = geminiProvider.compile(toolWith({ type: ['string', 'null'] }));
    expect(declaration(result).parameters?.properties?.['value']).toEqual({
      type: 'STRING',
      nullable: true,
    });
    expect(result.transformations.filter((item) => item.lossy)).toEqual([]);
  });

  it('emits a multi-type array as anyOf branches', () => {
    const result = geminiProvider.compile(toolWith({ type: ['string', 'number'] }));
    expect(declaration(result).parameters?.properties?.['value']).toEqual({
      anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }],
    });
  });

  it('never drops a boolean subschema silently', () => {
    const tool: CanonicalTool = {
      name: 'boolean_tool',
      description: 'Boolean subschema fixture',
      // Boolean subschemas are valid JSON Schema but core's `JsonSchema` type
      // does not model them, so build this one the way a loaded file would.
      inputSchema: JSON.parse('{"type":"object","properties":{"open":true,"closed":false}}') as JsonSchema,
    };
    expect(geminiProvider.compile(tool).ok).toBe(false);

    const result = geminiProvider.compile(tool, { allowLossy: true });
    expect(declaration(result).parameters?.properties).toEqual({ open: {}, closed: {} });
    expect(
      result.transformations.filter((item) =>
        ['converted-true-subschema', 'widened-false-subschema'].includes(item.code),
      ),
    ).toEqual([
      {
        code: 'converted-true-subschema',
        path: 'inputSchema.properties.open',
        detail:
          'Emitted the `true` subschema as an unconstrained Gemini schema; `true` already accepted every value.',
        lossy: false,
      },
      {
        code: 'widened-false-subschema',
        path: 'inputSchema.properties.closed',
        detail:
          'Emitted the `false` subschema as an unconstrained Gemini schema; Gemini cannot express a subschema that accepts nothing.',
        lossy: true,
      },
    ]);
  });

  it('always names a path inside the canonical tool', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      for (const item of geminiProvider.compile(tool, { allowLossy: true }).transformations) {
        expect(item.path.startsWith('inputSchema')).toBe(true);
        expect(item.detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('determinism', () => {
  it('compiles every shared fixture to byte-identical output twice', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      const first = geminiProvider.compile(tool, { allowLossy: true });
      const second = geminiProvider.compile(tool, { allowLossy: true });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('does not depend on the key order of the canonical schema', () => {
    const a: CanonicalTool = {
      name: 'ordered',
      description: 'Key order fixture',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string', maxLength: 5, description: 'v' } },
        required: ['value'],
      },
    };
    const b: CanonicalTool = {
      name: 'ordered',
      description: 'Key order fixture',
      inputSchema: {
        properties: { value: { description: 'v', maxLength: 5, type: 'string' } },
        required: ['value'],
        type: 'object',
      },
    };
    expect(JSON.stringify(geminiProvider.compile(b).output)).toBe(
      JSON.stringify(geminiProvider.compile(a).output),
    );
  });
});
