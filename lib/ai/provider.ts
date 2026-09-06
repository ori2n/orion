import type { AiProvider } from './types';
import { GeminiProvider } from './gemini';
import { OpenRouterProvider } from './openrouter';
import { CerebrasProvider } from './cerebras';

export function getAiProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER ?? 'openrouter').trim().toLowerCase();

  switch (provider) {
    case 'openrouter':
      return new OpenRouterProvider();
    case 'gemini':
      return new GeminiProvider();
    case 'cerebras':
      return new CerebrasProvider();
    default:
      throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }
}
