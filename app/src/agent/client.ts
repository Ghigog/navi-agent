/**
 * Provider selection.
 *
 * Both providers speak the same OpenAI-compatible API, so there is one client type and one
 * agent loop. Ollama is the daily driver and the core path must work with no cloud account and
 * no network beyond localhost (ADR 0001); the hosted provider is an optional extra behind the
 * same seam, never a dependency.
 */

import OpenAI from 'openai';
import type { Settings } from '../shared/settings.js';

export interface Provider {
  client: OpenAI;
  model: string;
  /** True when requests leave the machine. The UI says so; the user should never be unsure. */
  remote: boolean;
}

export function createProvider(settings: Settings): Provider {
  if (settings.provider === 'openai') {
    if (settings.openaiApiKey === '') {
      throw new Error('No OpenAI key is set. Add one in Settings, or switch back to Ollama.');
    }
    return {
      client: new OpenAI({ apiKey: settings.openaiApiKey }),
      model: settings.openaiModel,
      remote: true,
    };
  }

  return {
    client: new OpenAI({
      baseURL: `${settings.ollamaBaseUrl.replace(/\/+$/, '')}/v1`,
      // Ollama ignores the key but the client requires one to be present.
      apiKey: 'ollama',
    }),
    model: settings.ollamaModel,
    remote: false,
  };
}
