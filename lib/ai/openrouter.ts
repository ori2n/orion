import type { AiProvider, AiStreamRequest } from './types';
import { ORION_TOOL_DECLARATIONS } from './tools';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const encoder = new TextEncoder();
const MAX_TOOL_ROUNDS = 4;

type OpenRouterToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
};

type OpenRouterTurn = {
  text: string;
  toolCalls: OpenRouterToolCall[];
};

type OpenRouterToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenRouterChoiceDelta = {
  content?: string | null;
  toolCalls?: OpenRouterToolCallDelta[];
};

function requestLabel(request: AiStreamRequest): string {
  return request.requestId ? `[ai:${request.requestId}]` : '[ai]';
}

function systemPrompt(request: AiStreamRequest): string {
  const hasTools = Boolean(request.toolExecutor);
  return [
    'You are ORION AI, a concise personal life-management assistant.',
    'You are speaking with the authenticated ORION user whose data is isolated by the application.',
    hasTools
      ? 'You can use the approved ORION tools when live app data is needed. Use tools instead of guessing.'
      : 'No ORION data tools are connected for this request. Never claim to have retrieved app data.',
    'Read tools are safe to call without confirmation. Level 1 task and habit actions may execute immediately only when the user clearly requested that single action.',
    'After any mutation tool succeeds, explicitly report what changed using the returned object. If a tool returns an error, say it failed and do not claim success.',
    'There are no calendar mutation, bulk scheduling, deletion, or external-action tools available. Do not imply those actions were performed.',
    'Saved memory is user-approved context, not a license to infer sensitive facts. Only save or change memory after an explicit remember/forget request.',
    'Saved ORION memory:',
    JSON.stringify(request.memory ?? []),
    'Do not mention internal tool names unless it helps explain a limitation.',
    `Current page context: ${JSON.stringify(request.context)}`,
    'Use plain text with short paragraphs. Be explicit when data is unavailable or a result is uncertain.',
  ].join('\n');
}

function toMessages(messages: AiStreamRequest['messages']): OpenRouterMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toOpenRouterSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenRouterSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'type' && typeof entry === 'string' ? entry.toLowerCase() : toOpenRouterSchema(entry),
    ]),
  );
}

function openRouterTools() {
  return ORION_TOOL_DECLARATIONS.map((declaration) => ({
    type: 'function' as const,
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: toOpenRouterSchema(declaration.parameters),
    },
  }));
}

function parseSseJson(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '[DONE]' || !trimmed.startsWith('data:')) return null;
  try {
    return JSON.parse(trimmed.slice(5).trim()) as unknown;
  } catch {
    return null;
  }
}

function splitLines(buffer: string): { complete: string[]; remainder: string } {
  const lines = buffer.split('\n');
  return { complete: lines.slice(0, -1), remainder: lines.at(-1) ?? '' };
}

function getChoiceDelta(value: unknown): OpenRouterChoiceDelta | null {
  if (!value || typeof value !== 'object') return null;
  const choices = (value as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return null;
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return null;
  const item = delta as { content?: unknown; tool_calls?: unknown };
  const toolCalls = Array.isArray(item.tool_calls)
    ? item.tool_calls.filter((call): call is OpenRouterToolCallDelta => Boolean(call && typeof call === 'object'))
    : undefined;
  return {
    content: typeof item.content === 'string' ? item.content : null,
    toolCalls,
  };
}

async function readTurn(response: Response, onText: (text: string) => void): Promise<OpenRouterTurn> {
  if (!response.body) throw new Error('OpenRouter returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const toolCalls = new Map<number, OpenRouterToolCall>();

  const consumeLine = (line: string) => {
    const value = parseSseJson(line);
    const delta = getChoiceDelta(value);
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const part of delta.toolCalls ?? []) {
      const index = typeof part.index === 'number' ? part.index : toolCalls.size;
      const current = toolCalls.get(index) ?? {
        id: part.id ?? `openrouter-tool-${index}`,
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (part.id) current.id = part.id;
      if (part.function?.name) current.function.name += part.function.name;
      if (part.function?.arguments) current.function.arguments += part.function.arguments;
      toolCalls.set(index, current);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = splitLines(buffer);
      buffer = split.remainder;
      split.complete.forEach(consumeLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return { text, toolCalls: [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) };
}

function jsonSafe(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return null;
    if (serialized.length <= 20_000) return value;
    return { error: 'Tool result was truncated because it was too large.' };
  } catch {
    return { error: 'Tool result could not be serialized.' };
  }
}

function responseDetail(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: unknown } | string; message?: unknown };
    const error = parsed.error;
    if (typeof error === 'string') return error.slice(0, 500);
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message.slice(0, 500);
    if (typeof parsed.message === 'string') return parsed.message.slice(0, 500);
  } catch {
    // Keep the provider's plain-text response below.
  }
  return detail.trim().slice(0, 500) || 'Unknown OpenRouter error.';
}

async function requestOpenRouter(
  messages: OpenRouterMessage[],
  tools: ReturnType<typeof openRouterTools> | undefined,
  model: string,
  apiKey: string,
  request: AiStreamRequest,
): Promise<Response> {
  const label = requestLabel(request);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        stream: true,
        temperature: 0.4,
        max_tokens: 1024,
      }),
      cache: 'no-store',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown network error.';
    console.error(`${label} OpenRouter network request failed`, {
      model,
      hasApiKey: Boolean(apiKey),
      toolCount: tools?.length ?? 0,
      detail,
    });
    throw new Error(`Could not reach OpenRouter: ${detail}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => 'Unable to read provider error.');
    const message = responseDetail(detail);
    console.error(`${label} OpenRouter returned an error`, {
      status: response.status,
      model,
      hasApiKey: Boolean(apiKey),
      toolCount: tools?.length ?? 0,
      detail: message,
    });
    throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
  }

  console.info(`${label} OpenRouter request accepted`, {
    model,
    hasApiKey: Boolean(apiKey),
    toolCount: tools?.length ?? 0,
  });
  return response;
}

export class OpenRouterProvider implements AiProvider {
  async stream(request: AiStreamRequest): Promise<ReadableStream<Uint8Array>> {
    const label = requestLabel(request);
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim();
    if (!apiKey) {
      console.error(`${label} OpenRouter configuration error: OPENROUTER_API_KEY is missing or empty.`);
      throw new Error('OPENROUTER_API_KEY is not configured on the server.');
    }
    if (!model) {
      console.error(`${label} OpenRouter configuration error: OPENROUTER_MODEL is missing or empty.`);
      throw new Error('OPENROUTER_MODEL is not configured on the server.');
    }

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt(request) },
      ...toMessages(request.messages),
    ];
    const tools = request.toolExecutor ? openRouterTools() : undefined;

    // Perform the first upstream request before returning a Response. This means
    // provider failures can still become useful JSON from the ORION API route,
    // rather than an already-open stream that browsers report as "Failed to fetch".
    let response = await requestOpenRouter(messages, tools, model, apiKey, request);
    if (!response.body) throw new Error('OpenRouter returned no response body.');

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const turn = await readTurn(response, (text) => {
              controller.enqueue(encoder.encode(text));
            });
            if (turn.toolCalls.length === 0 || !request.toolExecutor) {
              controller.close();
              return;
            }

            messages.push({
              role: 'assistant',
              content: turn.text || null,
              tool_calls: turn.toolCalls,
            });
            for (const call of turn.toolCalls.slice(0, 8)) {
              let result: unknown;
              try {
                const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                if (!args || typeof args !== 'object' || Array.isArray(args)) {
                  throw new Error('OpenRouter returned invalid tool arguments.');
                }
                result = await request.toolExecutor(call.function.name, args as Record<string, unknown>);
              } catch (error) {
                result = { error: error instanceof Error ? error.message : 'Tool execution failed.' };
              }
              messages.push({
                role: 'tool',
                content: JSON.stringify(jsonSafe(result)),
                tool_call_id: call.id,
              });
            }
            response = await requestOpenRouter(messages, tools, model, apiKey, request);
            if (!response.body) throw new Error('OpenRouter returned no response body.');
          }

          throw new Error('The AI reached the maximum number of data lookups for one response.');
        } catch (error) {
          console.error(`${label} OpenRouter stream failed`, error);
          controller.error(error instanceof Error ? error : new Error('OpenRouter stream failed.'));
        }
      },
    });
  }
}
