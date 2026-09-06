import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiMessage } from './types';

const MAX_PERSISTED_MESSAGES = 24;

export interface AiConversation {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

const CONVERSATION_COLUMNS = 'id, title, summary, created_at, updated_at';

export async function createConversation(
  db: SupabaseClient,
  userId: string,
): Promise<AiConversation> {
  const { data, error } = await db
    .from('ai_conversations')
    .insert({ user_id: userId })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Conversation creation failed: ${error?.message ?? 'No conversation returned.'}`);
  return data as AiConversation;
}

export async function getConversation(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<AiConversation | null> {
  const { data, error } = await db
    .from('ai_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Conversation lookup failed: ${error.message}`);
  return data ? data as AiConversation : null;
}

export async function ensureConversation(
  db: SupabaseClient,
  userId: string,
  conversationId?: string,
): Promise<AiConversation> {
  if (conversationId) {
    const conversation = await getConversation(db, userId, conversationId);
    if (conversation) return conversation;
  }
  return createConversation(db, userId);
}

export async function listConversationMessages(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<AiMessage[]> {
  const { data, error } = await db
    .from('ai_messages')
    .select('role, content')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_PERSISTED_MESSAGES);
  if (error) throw new Error(`Message history lookup failed: ${error.message}`);
  return [...(data ?? [])].reverse().map((message) => ({
    role: message.role as AiMessage['role'],
    content: message.content,
  }));
}

export async function appendConversationMessages(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  messages: AiMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const { error } = await db.from('ai_messages').insert(
    messages.map((message) => ({
      user_id: userId,
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
    })),
  );
  if (error) throw new Error(`Message persistence failed: ${error.message}`);
  const { error: updateError } = await db
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (updateError) throw new Error(`Conversation update failed: ${updateError.message}`);
}

export async function listMemory(
  db: SupabaseClient,
  userId: string,
): Promise<Array<{ kind: string; memory_key: string; value: string }>> {
  const { data, error } = await db
    .from('ai_memory')
    .select('kind, memory_key, value')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Memory lookup failed: ${error.message}`);
  return (data ?? []) as Array<{ kind: string; memory_key: string; value: string }>;
}
