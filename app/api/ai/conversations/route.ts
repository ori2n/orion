import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureConversation } from '@/lib/ai/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.info(`[ai/conversations:${requestId}] request received`, { url: request.url });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    console.error(`[ai/conversations:${requestId}] Supabase client creation failed:`, error);
    return NextResponse.json(
      { error: 'The ORION AI server could not initialize its database client.', requestId },
      { status: 502, headers: { 'x-ai-request-id': requestId } },
    );
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResult = await supabase.auth.getUser();
  } catch (error) {
    console.error(`[ai/conversations:${requestId}] authentication lookup failed:`, error);
    return NextResponse.json(
      { error: 'The ORION AI server could not verify your session.', requestId },
      { status: 502, headers: { 'x-ai-request-id': requestId } },
    );
  }
  if (authResult.error || !authResult.data.user) {
    console.warn(`[ai/conversations:${requestId}] authentication failed`, { message: authResult.error?.message });
    return NextResponse.json(
      { error: 'Authentication required.', requestId },
      { status: 401, headers: { 'x-ai-request-id': requestId } },
    );
  }
  const user = authResult.data.user;

  let payload: { conversationId?: unknown } = {};
  try {
    const parsed = (await request.json().catch(() => ({}))) as { conversationId?: unknown };
    payload = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    payload = {};
  }

  const requestedConversationId = typeof payload.conversationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.conversationId)
    ? payload.conversationId
    : undefined;

  try {
    const conversation = await ensureConversation(supabase, user.id, requestedConversationId);
    console.info(`[ai/conversations:${requestId}] conversation ready`, { conversationId: conversation.id });
    return NextResponse.json(
      { conversationId: conversation.id, requestId },
      { headers: { 'x-ai-request-id': requestId } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversation creation failed.';
    console.error(`[ai/conversations:${requestId}] request failed:`, error);
    return NextResponse.json(
      { error: message, requestId },
      { status: 502, headers: { 'x-ai-request-id': requestId } },
    );
  }
}
