import type { FunctionCall } from '@google/genai';
import { openMapTool, refundOrderTool } from '@schemaport/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GeminiProbeClient } from '../src/index.js';
import { DEFAULT_PROBE_MODEL, geminiProvider } from '../src/index.js';

interface Recorded {
  model: string;
  contents: string;
  config?: Record<string, unknown>;
}

/** A client that records the request and returns one tool call. No network. */
function acceptingClient(
  calls: FunctionCall[] = [{ name: 'refund_order', args: { orderId: 'ord_123', amount: 10 } }],
): { client: GeminiProbeClient; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const client: GeminiProbeClient = {
    models: {
      generateContent: async (params) => {
        requests.push(params as Recorded);
        return { functionCalls: calls };
      },
    },
  };
  return { client, requests };
}

function throwingClient(error: unknown): GeminiProbeClient {
  return {
    models: {
      generateContent: async () => {
        throw error;
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('probe()', () => {
  it('reports accepted and validates the returned arguments', async () => {
    const { client, requests } = acceptingClient();
    const result = await geminiProvider.probe!(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.schemaAccepted).toBe(true);
    expect(result.toolCallReturned).toBe(true);
    expect(result.argumentsValid).toBe(true);
    expect(result.model).toBe(DEFAULT_PROBE_MODEL);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe(DEFAULT_PROBE_MODEL);
    expect(requests[0]?.contents).toContain('refund_order');
    expect(requests[0]?.config?.['maxOutputTokens']).toBe(512);
    expect(requests[0]?.config?.['tools']).toEqual([
      { functionDeclarations: [geminiProvider.compile(refundOrderTool).output] },
    ]);
  });

  it('flags returned arguments that violate the canonical schema', async () => {
    const { client } = acceptingClient([{ name: 'refund_order', args: { amount: -5 } }]);
    const result = await geminiProvider.probe!(refundOrderTool, { client });
    expect(result.status).toBe('accepted');
    expect(result.argumentsValid).toBe(false);
    expect(result.argumentErrors?.length).toBeGreaterThan(0);
  });

  it('reports accepted with no tool call when the model returned none', async () => {
    const { client } = acceptingClient([]);
    const result = await geminiProvider.probe!(refundOrderTool, { client });
    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.argumentsValid).toBeUndefined();
  });

  it('classifies a 400 about an unknown schema field as a rejection', async () => {
    const client = throwingClient({
      status: 400,
      message:
        'Invalid JSON payload received. Unknown name "multipleOf" at ' +
        "'tools[0].function_declarations[0].parameters.properties[1].value'",
    });
    const result = await geminiProvider.probe!(refundOrderTool, { client });
    expect(result.status).toBe('rejected');
    expect(result.schemaAccepted).toBe(false);
    expect(result.providerError?.status).toBe(400);
  });

  it('classifies a 404 as model-not-found, not as a schema rejection', async () => {
    const client = throwingClient({
      status: 404,
      message: 'models/gemini-does-not-exist is not found for API version v1beta',
    });
    const result = await geminiProvider.probe!(refundOrderTool, {
      client,
      model: 'gemini-does-not-exist',
    });
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('model-not-found');
    expect(result.schemaAccepted).toBe(false);
    expect(result.model).toBe('gemini-does-not-exist');
  });

  it('classifies a 401 as authentication, not as a schema rejection', async () => {
    const client = throwingClient({ status: 401, message: 'API key not valid' });
    const result = await geminiProvider.probe!(refundOrderTool, { client });
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('authentication');
  });

  it('reports missing credentials when neither environment variable is set', async () => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('GOOGLE_API_KEY', undefined);
    const result = await geminiProvider.probe!(refundOrderTool);
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('missing-credentials');
    expect(result.notes.join(' ')).toContain('GEMINI_API_KEY');
  });

  it('never sends a schema that compilation refused', async () => {
    const { client, requests } = acceptingClient();
    const result = await geminiProvider.probe!(openMapTool, { client });
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('compile-refused');
    expect(requests).toEqual([]);
  });

  it('sends the lossy compilation when allowLossy is set', async () => {
    const { client, requests } = acceptingClient([{ name: 'tag_resource', args: {} }]);
    const result = await geminiProvider.probe!(openMapTool, { client, allowLossy: true });
    expect(result.status).toBe('accepted');
    expect(requests).toHaveLength(1);
  });

  it('ignores the environment entirely when a client is supplied', async () => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('GOOGLE_API_KEY', undefined);
    const { client } = acceptingClient();
    const result = await geminiProvider.probe!(refundOrderTool, { client });
    expect(result.status).toBe('accepted');
  });

  it('resolves the model from options, then SCHEMAPORT_GEMINI_MODEL, then the default', async () => {
    const { client, requests } = acceptingClient();
    await geminiProvider.probe!(refundOrderTool, { client, model: 'gemini-explicit' });
    vi.stubEnv('SCHEMAPORT_GEMINI_MODEL', 'gemini-from-env');
    await geminiProvider.probe!(refundOrderTool, { client });
    vi.stubEnv('SCHEMAPORT_GEMINI_MODEL', undefined);
    await geminiProvider.probe!(refundOrderTool, { client });

    expect(requests.map((item) => item.model)).toEqual([
      'gemini-explicit',
      'gemini-from-env',
      DEFAULT_PROBE_MODEL,
    ]);
  });

  it('passes a timeout through as an abort signal', async () => {
    const { client, requests } = acceptingClient();
    await geminiProvider.probe!(refundOrderTool, { client, timeoutMs: 5_000 });
    expect(requests[0]?.config?.['abortSignal']).toBeInstanceOf(AbortSignal);
  });
});
