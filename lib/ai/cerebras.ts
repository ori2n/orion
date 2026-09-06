import type { AiProvider, AiStreamRequest } from './types';
import { ORION_TOOL_DECLARATIONS } from './tools';

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_DEFAULT_MODEL = 'qwen-3-235b-a22b-instruct-2507';
const CEREBRAS_REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOOL_ROUNDS = 4;
const encoder = new TextEncoder();

type CerebrasToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type CerebrasMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: CerebrasToolCall[];
  tool_call_id?: string;
};

type CerebrasToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type CerebrasChoiceDelta = {
  content?: string | null;
  toolCalls?: CerebrasToolCallDelta[];
};

type CerebrasTurn = {
  text: string;
  toolCalls: CerebrasToolCall[];
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

function toMessages(messages: AiStreamRequest['messages']): CerebrasMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toCerebrasSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCerebrasSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'type' && typeof entry === 'string' ? entry.toLowerCase() : toCerebrasSchema(entry),
    ]),
  );
}

function cerebrasTools() {
  return ORION_TOOL_DECLARATIONS.map((declaration) => ({
    type: 'function' as const,
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: toCerebrasSchema(declaration.parameters),
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

function getChoiceDelta(value: unknown): CerebrasChoiceDelta | null {
  if (!value || typeof value !== 'object') return null;
  const choices = (value as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return null;
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return null;
  const item = delta as { content?: unknown; tool_calls?: unknown };
  const toolCalls = Array.isArray(item.tool_calls)
    ? item.tool_calls.filter((call): call is CerebrasToolCallDelta => Boolean(call && typeof call === 'object'))
    : undefined;
  return {
    content: typeof item.content === 'string' ? item.content : null,
    toolCalls,
  };
}

async function readTurn(response: Response, onText: (text: string) => void): Promise<CerebrasTurn> {
  if (!response.body) throw new Error('Cerebras returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let sawData = false;
  let sawValidChunk = false;
  const toolCalls = new Map<number, CerebrasToolCall>();

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[DONE]' || !trimmed.startsWith('data:')) return;
    if (trimmed.slice(5).trim() === '[DONE]') return;
    sawData = true;
    const value = parseSseJson(line);
    if (!value) throw new Error('Cerebras returned malformed streaming data.');
    const delta = getChoiceDelta(value);
    if (!delta) throw new Error('Cerebras returned a malformed streaming response.');
    sawValidChunk = true;
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const part of delta.toolCalls ?? []) {
      const index = typeof part.index === 'number' ? part.index : toolCalls.size;
      const current = toolCalls.get(index) ?? {
        id: part.id ?? `cerebras-tool-${index}`,
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

  if (!sawData || !sawValidChunk || (!text && toolCalls.size === 0)) {
    throw new Error('Cerebras returned an empty or malformed streaming response.');
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

function responseDetail(detail: string, apiKey?: string): string {
  const sanitized = apiKey ? detail.replaceAll(apiKey, '[redacted]') : detail;
  try {
    const parsed = JSON.parse(sanitized) as { error?: { message?: unknown } | string; message?: unknown };
    const error = parsed.error;
    if (typeof error === 'string') return error.slice(0, 500);
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message.slice(0, 500);
    if (typeof parsed.message === 'string') return parsed.message.slice(0, 500);
  } catch {
    // Keep the provider's plain-text response below.
  }
  return sanitized.trim().slice(0, 500) || 'Unknown Cerebras error.';
}

function providerError(status: number, detail: string): string {
  if (status === 401 || status === 403) return `Cerebras authentication failed (${status}). Check CEREBRAS_API_KEY.`;
  if (status === 408 || status === 504) return `Cerebras request timed out (${status}).`;
  if (status === 429) return 'Cerebras rate limit reached. Please try again shortly.';
  const normalizedDetail = detail.toLowerCase();
  if (status === 404 || (/model|endpoint/.test(normalizedDetail) && /unavailable|not found|unsupported|deprecated/.test(normalizedDetail))) {
    return `Cerebras model or endpoint unavailable (${status}): ${detail}`;
  }
  if (status >= 500) return `Cerebras service failure (${status}): ${detail}`;
  return `Cerebras request failed (${status}): ${detail}`;
}

async function requestCerebras(
  messages: CerebrasMessage[],
  tools: ReturnType<typeof cerebrasTools> | undefined,
  model: string,
  apiKey: string,
  request: AiStreamRequest,
): Promise<Response> {
  const label = requestLabel(request);
  const timeout = AbortSignal.timeout(CEREBRAS_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(CEREBRAS_API_URL, {
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
        parallel_tool_calls: false,
      }),
      cache: 'no-store',
      signal: timeout,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown network error.';
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    console.error(`${label} Cerebras network request failed`, {
      model,
      hasApiKey: Boolean(apiKey),
      toolCount: tools?.length ?? 0,
      timedOut,
      detail,
    });
    throw new Error(timedOut ? 'Cerebras request timed out.' : `Could not reach Cerebras: ${detail}`);
  }

  if (!response.ok) {
    const rawDetail = await response.text().catch(() => 'Unable to read provider error.');
    const detail = responseDetail(rawDetail, apiKey);
    console.error(`${label} Cerebras returned an error`, {
      status: response.status,
      model,
      hasApiKey: Boolean(apiKey),
      toolCount: tools?.length ?? 0,
    });
    throw new Error(providerError(response.status, detail));
  }

  if (!response.body) {
    console.error(`${label} Cerebras returned a successful response without a body`, { model });
    throw new Error('Cerebras returned no response body.');
  }

  console.info(`${label} Cerebras request accepted`, {
    model,
    hasApiKey: Boolean(apiKey),
    toolCount: tools?.length ?? 0,
  });
  return response;
}

export class CerebrasProvider implements AiProvider {
  async stream(request: AiStreamRequest): Promise<ReadableStream<Uint8Array>> {
    const label = requestLabel(request);
    const apiKey = process.env.CEREBRAS_API_KEY?.trim();
    const model = process.env.CEREBRAS_MODEL?.trim() || CEREBRAS_DEFAULT_MODEL;
    if (!apiKey) {
      console.error(`${label} Cerebras configuration error: CEREBRAS_API_KEY is missing or empty.`);
      throw new Error('CEREBRAS_API_KEY is not configured on the server.');
    }

    const messages: CerebrasMessage[] = [
      { role: 'system', content: systemPrompt(request) },
      ...toMessages(request.messages),
    ];
    const tools = request.toolExecutor ? cerebrasTools() : undefined;

    let response = await requestCerebras(messages, tools, model, apiKey, request);
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

            if (turn.toolCalls.some((call) => !call.function.name || !call.id)) {
              throw new Error('Cerebras returned a malformed tool call.');
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
                  throw new Error('Cerebras returned invalid tool arguments.');
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
            response = await requestCerebras(messages, tools, model, apiKey, request);
          }

          throw new Error('The AI reached the maximum number of data lookups for one response.');
        } catch (error) {
          console.error(`${label} Cerebras stream failed`, {
            model,
            error: error instanceof Error ? error.message : 'Unknown stream error.',
          });
          controller.error(error instanceof Error ? error : new Error('Cerebras stream failed.'));
        }
      },
    });
  }
}
