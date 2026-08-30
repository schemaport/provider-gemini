import { describe, expect, it } from 'vitest';
import type { CanonicalTool } from '@schemaport/core';

import { compileGeminiTool } from '../src/compile.js';
import type { PropertyOrderingMode } from '../src/compile.js';

interface Ordered {
  parameters?: { properties?: Record<string, unknown>; propertyOrdering?: string[] };
}

const tool = (inputSchema: CanonicalTool['inputSchema']): CanonicalTool => ({
  name: 'place_order',
  description: 'Place one order',
  inputSchema,
});

const flat = tool({
  type: 'object',
  properties: {
    note: { type: 'string' },
    orderId: { type: 'string' },
    quantity: { type: 'integer' },
  },
  required: ['orderId', 'quantity'],
});

const compile = (t: CanonicalTool, propertyOrdering?: PropertyOrderingMode) =>
  compileGeminiTool(t, propertyOrdering === undefined ? undefined : { propertyOrdering });
const ordering = (t: CanonicalTool, mode?: PropertyOrderingMode): string[] | undefined =>
  (compile(t, mode).output as Ordered).parameters?.propertyOrdering;
const codes = (t: CanonicalTool, mode?: PropertyOrderingMode) =>
  compile(t, mode).transformations.map((change) => change.code);

describe('propertyOrdering: preserve (the default)', () => {
  it('generates nothing', () => {
    expect(ordering(flat)).toBeUndefined();
    expect(ordering(flat, 'preserve')).toBeUndefined();
  });

  it('is what an absent option means', () => {
    expect(compileGeminiTool(flat)).toEqual(compileGeminiTool(flat, {}));
  });

  it('still passes a declared ordering through', () => {
    const declared = tool({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      propertyOrdering: ['b', 'a'],
    });

    expect(ordering(declared)).toEqual(['b', 'a']);
    expect(codes(declared)).not.toContain('kept-declared-property-ordering');
  });
});

describe('propertyOrdering: declaration', () => {
  it('orders by the canonical properties key order', () => {
    expect(ordering(flat, 'declaration')).toEqual(['note', 'orderId', 'quantity']);
  });

  it('records one non-lossy transformation', () => {
    const generated = compile(flat, 'declaration').transformations.filter(
      (change) => change.code === 'generated-property-ordering',
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]?.lossy).toBe(false);
    expect(generated[0]?.detail).toContain('`declaration`');
  });

  it('compiles without allowLossy, because ordering destroys no constraint', () => {
    expect(compile(flat, 'declaration').ok).toBe(true);
  });
});

describe('propertyOrdering: required-first', () => {
  it('puts required properties first, in required order', () => {
    expect(ordering(flat, 'required-first')).toEqual(['orderId', 'quantity', 'note']);
  });

  it('keeps declaration order among the optional properties', () => {
    const many = tool({
      type: 'object',
      properties: {
        d: { type: 'string' },
        c: { type: 'string' },
        b: { type: 'string' },
        a: { type: 'string' },
      },
      required: ['c'],
    });

    expect(ordering(many, 'required-first')).toEqual(['c', 'd', 'b', 'a']);
  });

  it('ignores a required name that is not a declared property', () => {
    const mismatched = tool({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'ghost'],
    });

    expect(ordering(mismatched, 'required-first')).toEqual(['a']);
  });

  it('falls back to declaration order when nothing is required', () => {
    const optional = tool({ type: 'object', properties: { b: { type: 'string' }, a: { type: 'string' } } });

    expect(ordering(optional, 'required-first')).toEqual(['b', 'a']);
    expect(ordering(optional, 'required-first')).toEqual(ordering(optional, 'declaration'));
  });
});

describe('a declared ordering always wins', () => {
  const declared = tool({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['b'],
    propertyOrdering: ['a', 'b'],
  });

  it.each(['declaration', 'required-first'] as const)('is not overruled in %s mode', (mode) => {
    expect(ordering(declared, mode)).toEqual(['a', 'b']);
  });

  it('reports that the request was declined in favour of the schema', () => {
    const kept = compile(declared, 'required-first').transformations.filter(
      (change) => change.code === 'kept-declared-property-ordering',
    );

    expect(kept).toHaveLength(1);
    expect(kept[0]?.lossy).toBe(false);
  });

  it('does not also report a generated ordering', () => {
    expect(codes(declared, 'declaration')).not.toContain('generated-property-ordering');
  });
});

describe('nested schemas', () => {
  const nested = tool({
    type: 'object',
    properties: {
      customer: {
        type: 'object',
        properties: { name: { type: 'string' }, id: { type: 'string' } },
        required: ['id'],
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { sku: { type: 'string' }, qty: { type: 'integer' } },
          required: ['sku', 'qty'],
        },
      },
    },
    required: ['customer'],
  });

  it('orders every object schema, not only the root', () => {
    const parameters = (compile(nested, 'required-first').output as Ordered).parameters as Record<
      string,
      never
    >;
    const json = JSON.stringify(parameters);

    expect(json).toContain('"propertyOrdering":["customer","items"]');
    expect(json).toContain('"propertyOrdering":["id","name"]');
    expect(json).toContain('"propertyOrdering":["sku","qty"]');
  });

  it('reports one transformation covering them all, with the count', () => {
    const [generated] = compile(nested, 'declaration').transformations.filter(
      (change) => change.code === 'generated-property-ordering',
    );

    expect(generated?.detail).toContain('3 object schemas');
  });
});

describe('edge cases', () => {
  it('emits no ordering for an object with no properties', () => {
    expect(ordering(tool({ type: 'object', properties: {} }), 'declaration')).toBeUndefined();
  });

  it('emits no ordering for a tool that takes no parameters at all', () => {
    const bare = compile(tool({ type: 'object' }), 'declaration');

    expect((bare.output as Ordered).parameters).toBeUndefined();
    expect(bare.transformations.map((c) => c.code)).not.toContain('generated-property-ordering');
  });

  it('ignores a malformed declared ordering and generates instead', () => {
    const malformed = tool({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      propertyOrdering: ['a', 7],
    });

    expect(ordering(malformed, 'declaration')).toEqual(['a', 'b']);
  });

  it('is deterministic', () => {
    const a = JSON.stringify(compile(flat, 'required-first').output);
    const b = JSON.stringify(compile(flat, 'required-first').output);

    expect(a).toBe(b);
  });

  it('changes nothing but the ordering field', () => {
    const withOrdering = compile(flat, 'declaration').output as Record<string, unknown>;
    const without = compile(flat).output as Record<string, unknown>;
    const stripped = JSON.parse(JSON.stringify(withOrdering)) as Ordered;
    delete stripped.parameters?.propertyOrdering;

    expect(stripped).toEqual(without);
  });
});
