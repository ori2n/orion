import type { AiProvider, AiStreamRequest } from './types';
import { ORION_TOOL_DECLARATIONS } from './tools';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const encoder = new TextEncoder();
const MAX_TOOL_ROUNDS = 4;

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
};

type GeminiModelPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
};

type GeminiTurn = {
  modelParts: GeminiModelPart[];
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
};

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

function toGeminiContents(messages: AiStreamRequest['messages']): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
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

function getCandidateParts(value: unknown): GeminiPart[] {
  if (!value || typeof value !== 'object') return [];
  const candidates = (value as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates)) return [];
  const content = candidates[0] as { content?: { parts?: unknown[] } } | undefined;
  if (!Array.isArray(content?.content?.parts)) return [];
  return content.content.parts.filter((part): part is GeminiPart => Boolean(part && typeof part === 'object'));
}

function splitLines(buffer: string): { complete: string[]; remainder: string } {
  const lines = buffer.split('\n');
  return { complete: lines.slice(0, -1), remainder: lines.at(-1) ?? '' };
}

async function readTurn(
  response: Response,
  onText: (text: string) => void,
): Promise<GeminiTurn> {
  if (!response.body) throw new Error('Gemini returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const modelParts: GeminiModelPart[] = [];
  const functionCalls: GeminiTurn['functionCalls'] = [];

  const consumeLine = (line: string) => {
    const value = parseSseJson(line);
    if (!value) return;
    for (const part of getCandidateParts(value)) {
      if (typeof part.text === 'string' && part.text) {
        modelParts.push({ text: part.text });
        onText(part.text);
      }
      if (part.functionCall?.name) {
        const call = {
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        };
        modelParts.push({ functionCall: call });
        functionCalls.push(call);
      }
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

  return { modelParts, functionCalls };
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

export class GeminiProvider implements AiProvider {
  async stream(request: AiStreamRequest): Promise<ReadableStream<Uint8Array>> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server.');
    const model = process.env.GEMINI_MODEL ?? 'gemini-3.7-flash';
    const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent`;

    const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] | Array<Record<string, unknown>> }> =
      toGeminiContents(request.messages);
    const tools = request.toolExecutor ? [{ functionDeclarations: ORION_TOOL_DECLARATIONS }] : undefined;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const response = await fetch(`${endpoint}?alt=sse&key=${encodeURIComponent(apiKey)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt(request) }] },
                contents,
                tools,
                generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
              }),
              cache: 'no-store',
            });

            if (!response.ok) {
              const detail = await response.text().catch(() => 'Unknown provider error.');
              throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 500)}`);
            }

            const turn = await readTurn(response, (text) => controller.enqueue(encoder.encode(text)));
            if (turn.functionCalls.length === 0 || !request.toolExecutor) {
              controller.close();
              return;
            }

            contents.push({ role: 'model', parts: turn.modelParts });
            const functionResponses: Array<Record<string, unknown>> = [];
            for (const call of turn.functionCalls.slice(0, 8)) {
              let result: unknown;
              try {
                result = await request.toolExecutor(call.name, call.args);
              } catch (error) {
                result = { error: error instanceof Error ? error.message : 'Tool execution failed.' };
              }
              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { result: jsonSafe(result) },
                },
              });
            }
            contents.push({ role: 'user', parts: functionResponses });
          }

          throw new Error('The AI reached the maximum number of data lookups for one response.');
        } catch (error) {
          controller.error(error instanceof Error ? error : new Error('Gemini stream failed.'));
        }
      },
    });
  }
}
