/**
 * Live probe: send the compiled `FunctionDeclaration` to the Gemini API and
 * report whether the schema was accepted.
 *
 * The probe never executes the developer's function. It asks the model for one
 * synthetic call with placeholder arguments and inspects the arguments against
 * the *canonical* schema, so a constraint Gemini ignored shows up as an
 * argument mismatch rather than as a pass.
 */

import type { FunctionCall, FunctionDeclaration, GenerateContentConfig } from '@google/genai';
import type { CanonicalTool, ProbeOptions, ProbeResult } from '@schemaport/core';
import {
  classifyProviderError,
  probeAccepted,
  probeCompileRefused,
  probeError,
  probeMissingCredentials,
  probePrompt,
  probeRejected,
  resolveApiKey,
  resolveProbeModel,
} from '@schemaport/core';

import { compileGeminiTool } from './compile.js';
import {
  API_KEY_ENV_VAR,
  DEFAULT_PROBE_MODEL,
  FALLBACK_API_KEY_ENV_VAR,
  PROBE_MODEL_ENV_VAR,
  PROVIDER_ID,
} from './rules.js';

/** The slice of `GoogleGenAI` the probe uses. Tests pass their own. */
export interface GeminiProbeClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: GenerateContentConfig;
    }): Promise<{ functionCalls?: FunctionCall[] }>;
  };
}

/** Output cap for the probe: one short tool call is all we need. */
const PROBE_MAX_OUTPUT_TOKENS = 512;

export async function probeGeminiTool(
  tool: CanonicalTool,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const base = { providerId: PROVIDER_ID, toolName: tool.name };

  const compiled = compileGeminiTool(tool, { allowLossy: options.allowLossy ?? false });
  if (!compiled.ok || compiled.output === undefined) {
    return probeCompileRefused(base, compiled);
  }

  let client = options.client as GeminiProbeClient | undefined;
  if (client === undefined) {
    const apiKey =
      resolveApiKey(options.apiKey, API_KEY_ENV_VAR) ??
      resolveApiKey(options.apiKey, FALLBACK_API_KEY_ENV_VAR);
    if (apiKey === undefined) return probeMissingCredentials(base, API_KEY_ENV_VAR);
    const { GoogleGenAI } = await import('@google/genai');
    client = new GoogleGenAI({ apiKey });
  }

  const model = resolveProbeModel(options.model, PROBE_MODEL_ENV_VAR, DEFAULT_PROBE_MODEL);

  // `CompileResult.output` is `unknown` because it is the shared shape across
  // four providers. The cast is safe here for a reason the type cannot carry:
  // `compiled` came from `compileGeminiTool` a few lines up, and the guard
  // above has already returned on both `ok: false` and an absent `output`, so
  // what remains is the `FunctionDeclaration` that function writes.
  const declaration = compiled.output as FunctionDeclaration;
  const config: GenerateContentConfig = {
    tools: [{ functionDeclarations: [declaration] }],
    maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  };
  if (options.timeoutMs !== undefined) config.abortSignal = AbortSignal.timeout(options.timeoutMs);

  try {
    const response = await client.models.generateContent({
      model,
      contents: probePrompt(tool),
      config,
    });

    const calls = response.functionCalls ?? [];
    const call = calls.find((candidate) => candidate.name === tool.name) ?? calls[0];
    const accepted: Parameters<typeof probeAccepted>[0] = {
      ...base,
      model,
      tool,
      notes: [
        'Sent with the default AUTO function-calling mode, which does not use constrained decoding.',
      ],
    };
    if (call?.args !== undefined) accepted.argumentsReceived = call.args;
    return probeAccepted(accepted);
  } catch (error) {
    const { kind, detail } = classifyProviderError(error);
    if (kind === 'rejected') return probeRejected(base, model, detail);
    return probeError(base, kind, detail, model);
  }
}
