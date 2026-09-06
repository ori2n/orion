import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/lib/ai/provider';
import { AI_STREAM_ERROR_PREFIX } from '@/lib/ai/types';
import type { AiMessage, AiPageContext, AiStreamRequest } from '@/lib/ai/types';
import { createAiToolExecutor } from '@/lib/ai/tools';
import {
  appendConversationMessages,
  getConversation,
  listConversationMessages,
  listMemory,
} from '@/lib/ai/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_LENGTH = 2000;

type ChatPayload = {
  conversationId?: unknown;
  message?: unknown;
  context?: unknown;
};

function isContext(value: unknown): value is AiPageContext {
  if (!value || typeof value !== 'object') return false;
  const item = value as {
    pathname?: unknown;
    page?: unknown;
    currentDate?: unknown;
    currentTime?: unknown;
    timezone?: unknown;
    section?: unknown;
    selectedItem?: unknown;
  };
  return (
    typeof item.pathname === 'string' &&
    item.pathname.length <= MAX_CONTEXT_LENGTH &&
    typeof item.currentDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.currentDate) &&
    typeof item.currentTime === 'string' &&
    item.currentTime.length <= 16 &&
    typeof item.timezone === 'string' &&
    item.timezone.length <= 100 &&
    (item.page === 'time_management' ||
      item.page === 'fitness' ||
      item.page === 'finance' ||
      item.page === 'other') &&
    (item.section === undefined || typeof item.section === 'string') &&
    (item.selectedItem === undefined || typeof item.selectedItem === 'string')
  );
}

function isUserMessage(value: unknown): value is AiMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { role?: unknown }).role === 'user' &&
      typeof (value as { content?: unknown }).content === 'string' &&
      (value as { content: string }).content.trim().length > 0 &&
      (value as { content: string }).content.length <= MAX_MESSAGE_LENGTH,
  );
}

function validConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function badRequest(message: string, requestId?: string) {
  return NextResponse.json({ error: message, requestId }, { status: 400, headers: { 'x-ai-request-id': requestId ?? '' } });
}

function errorResponse(message: string, requestId: string, status = 502) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { 'x-ai-request-id': requestId } },
  );
}

function isExplicitActionRequest(content: string): boolean {
  return /^\s*(please\s+)?(add|create|mark|complete|uncomplete|move|reschedule)\b/i.test(content);
}

function isExplicitMemoryRequest(content: string): boolean {
  return /\b(remember|save this|store this|forget|delete that memory|update that memory)\b/i.test(content);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info(`[ai/chat:${requestId}] request received`, { url: request.url });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    console.error(`[ai/chat:${requestId}] Supabase client creation failed:`, error);
    return errorResponse('The ORION AI server could not initialize its database client.', requestId);
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResult = await supabase.auth.getUser();
  } catch (error) {
    console.error(`[ai/chat:${requestId}] authentication lookup failed:`, error);
    return errorResponse('The ORION AI server could not verify your session.', requestId);
  }
  if (authResult.error || !authResult.data.user) {
    console.warn(`[ai/chat:${requestId}] authentication failed`, { message: authResult.error?.message });
    return errorResponse('Authentication required.', requestId, 401);
  }
  const user = authResult.data.user;

  let payload: ChatPayload;
  try {
    payload = (await request.json()) as ChatPayload;
  } catch {
    return badRequest('Request body must be valid JSON.', requestId);
  }

  if (!validConversationId(payload.conversationId)) {
    return badRequest('conversationId must be a valid id. Create a conversation before sending a message.', requestId);
  }
  if (!isUserMessage(payload.message)) {
    return badRequest('message must be a non-empty user message.', requestId);
  }
  if (!isContext(payload.context)) {
    return badRequest('A valid page context is required.', requestId);
  }

  try {
    const conversation = await getConversation(supabase, user.id, payload.conversationId);
    if (!conversation) {
      return badRequest('Conversation not found. Start a new conversation before sending a message.', requestId);
    }
    const [history, memory] = await Promise.all([
      listConversationMessages(supabase, user.id, conversation.id),
      listMemory(supabase, user.id),
    ]);
    const userMessage = { role: 'user' as const, content: payload.message.content.trim() };
    await appendConversationMessages(supabase, user.id, conversation.id, [userMessage]);

    const allowImmediateActions = isExplicitActionRequest(userMessage.content);
    const allowMemoryActions = isExplicitMemoryRequest(userMessage.content);
    const stream = await getAiProvider().stream({
      requestId,
      messages: [...history, userMessage],
      context: payload.context,
      userId: user.id,
      memory: memory as AiStreamRequest['memory'],
      toolExecutor: createAiToolExecutor(
        supabase,
        user.id,
        allowImmediateActions,
        allowMemoryActions,
      ),
    });

    const encoder = new TextEncoder();
    const reader = stream.getReader();
    const assistantParts: string[] = [];
    let streamFailed = false;
    const persistedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (text) {
              assistantParts.push(text);
              controller.enqueue(encoder.encode(text));
            }
          }
          const tail = decoder.decode();
          if (tail) {
            assistantParts.push(tail);
            controller.enqueue(encoder.encode(tail));
          }
          const assistantContent = assistantParts.join('').trim();
          if (assistantContent && !streamFailed) {
            await appendConversationMessages(supabase, user.id, conversation.id, [
              { role: 'assistant', content: assistantContent },
            ]);
          }
          controller.close();
        } catch (error) {
          streamFailed = true;
          const message = error instanceof Error ? error.message : 'AI stream failed.';
          console.error(`[ai/chat:${requestId}] stream persistence failed:`, error);
          controller.enqueue(encoder.encode(`${AI_STREAM_ERROR_PREFIX}${message}`));
          controller.close();
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(persistedStream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        'content-type': 'text/plain; charset=utf-8',
        connection: 'keep-alive',
        'x-conversation-id': conversation.id,
        'x-ai-request-id': requestId,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed.';
    console.error(`[ai/chat:${requestId}] request failed:`, error);
    return errorResponse(message, requestId);
  }
}
