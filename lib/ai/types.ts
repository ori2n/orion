export const AI_STREAM_ERROR_PREFIX = '[ORION_AI_ERROR]';

export type AiRole = 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiPageContext {
  pathname: string;
  page: 'time_management' | 'fitness' | 'finance' | 'other';
  currentDate: string;
  currentTime: string;
  timezone: string;
  section?: string;
  selectedItem?: string;
}

export type AiToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface AiMemoryItem {
  kind: 'goal' | 'preference' | 'routine' | 'fact' | 'project';
  memory_key: string;
  value: string;
}

export interface AiStreamRequest {
  requestId?: string;
  messages: AiMessage[];
  context: AiPageContext;
  userId: string;
  memory?: AiMemoryItem[];
  toolExecutor?: AiToolExecutor;
}

export interface AiProvider {
  stream(request: AiStreamRequest): Promise<ReadableStream<Uint8Array>>;
}
