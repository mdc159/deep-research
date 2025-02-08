import OpenAI from 'openai';
import { getEncoding } from 'js-tiktoken';
import { RecursiveCharacterTextSplitter } from './text-splitter';

// Create OpenAI instance using OpenRouter configuration
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/yourusername/deep-research',
    'X-Title': 'Deep Research',
  },
});

// Helper to wrap model and override 'provider' property using a Proxy
function wrapModel<T extends object>(model: T, providerName: string): T {
  const provider = { name: providerName };
  // Create an extended model with the required properties
  const extendedModel = Object.assign({}, model, {
    specificationVersion: 'v1',
    modelId: 'openai/o1-mini',
    defaultObjectGenerationMode: 'object'
  });
  return new Proxy(extendedModel, {
    get(target: any, prop: string, receiver: any) {
      if (prop === 'provider' || prop === '_provider') {
        return provider;
      }
      if (prop === 'id') {
        return providerName;
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Export the wrapped OpenAI instance
export const o1MiniModel = wrapModel(openai, 'openrouter');

// Utility functions
const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(prompt: string, contextSize = 120_000) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  return trimPrompt(trimmedPrompt, contextSize);
}
