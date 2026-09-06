'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AI_STREAM_ERROR_PREFIX } from '@/lib/ai/types';
import type { AiMessage, AiPageContext } from '@/lib/ai/types';

function pageForPath(pathname: string): AiPageContext['page'] {
  if (pathname === '/time-management' || pathname.startsWith('/time-management/')) {
    return 'time_management';
  }
  if (pathname === '/fitness' || pathname.startsWith('/fitness/')) return 'fitness';
  if (pathname === '/finance' || pathname.startsWith('/finance/')) return 'finance';
  return 'other';
}

function sectionForPath(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'fitness' && parts[1]) return parts[1];
  if (parts[0] === 'time-management') return 'dashboard';
  if (parts[0] === 'finance' && parts[1]) return parts[1];
  return undefined;
}

function selectedItemForPath(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'fitness' && parts[1] === 'strength' && parts[2]) {
    return decodeURIComponent(parts[2]);
  }
  if (parts[0] === 'fitness' && parts[1] === 'muscles' && parts[2]) {
    return decodeURIComponent(parts[2]);
  }
  if (parts[0] === 'fitness' && parts[1] === 'workouts' && parts[2]) {
    return decodeURIComponent(parts[2]);
  }
  return undefined;
}

function pageLabel(page: AiPageContext['page']): string {
  if (page === 'time_management') return 'Time Management';
  if (page === 'fitness') return 'Fitness';
  if (page === 'finance') return 'Finance';
  return 'ORION';
}

const CONVERSATION_STORAGE_KEY = 'orion-ai-conversation-id';

function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    return isConversationId(value) ? value : null;
  } catch {
    return null;
  }
}

function storeConversationId(value: string): void {
  try {
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, value);
  } catch {
    // The server remains authoritative if browser storage is unavailable.
  }
}

function clearStoredConversationId(): void {
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions; reset still clears in-memory state.
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown; requestId?: unknown } | null;
  const message = typeof body?.error === 'string' ? body.error : fallback;
  const requestId = typeof body?.requestId === 'string'
    ? body.requestId
    : response.headers.get('x-ai-request-id');
  return new Error(requestId ? `${message} (request ${requestId})` : message);
}

function networkError(error: unknown, endpoint: string): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return error;
  const detail = error instanceof Error ? error.message : 'Unknown network error.';
  return new Error(`Could not reach ${endpoint}. ${detail}`);
}

function initialMessage(page: AiPageContext['page']): AiMessage {
  return {
    role: 'assistant',
    content: `I’m ORION AI. I can help you think through ${pageLabel(page)} and answer questions using the read-only ORION data available to this page. Single-task and single-habit actions can run when you clearly request them; larger changes still require a later confirmation flow.`,
  };
}

export default function AiChatPanel() {
  const pathname = usePathname() ?? '/';
  const context = useMemo<AiPageContext>(() => ({
    pathname,
    page: pageForPath(pathname),
    currentDate: new Intl.DateTimeFormat('en-CA').format(new Date()),
    currentTime: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    section: sectionForPath(pathname),
    selectedItem: selectedItemForPath(pathname),
  }), [pathname]);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>(() => [initialMessage(pageForPath(pathname))]);
  const [, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const conversationCreationRef = useRef<{ generation: number; promise: Promise<string> } | null>(null);
  const conversationGenerationRef = useRef(0);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeView, setTimeView] = useState<'calendar' | 'habits' | 'todos'>('calendar');
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pathname !== '/time-management') return;
    const handleViewChange = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (value === 'calendar' || value === 'habits' || value === 'todos') setTimeView(value);
    };
    window.addEventListener('orion-time-view-change', handleViewChange);
    return () => window.removeEventListener('orion-time-view-change', handleViewChange);
  }, [pathname]);

  function cycleTimeView() {
    window.dispatchEvent(new CustomEvent('orion-time-view-cycle'));
  }

  useEffect(() => {
    const storedConversationId = readStoredConversationId();
    if (!storedConversationId || conversationIdRef.current) return;
    conversationIdRef.current = storedConversationId;
    setConversationId(storedConversationId);
  }, []);

  function setActiveConversationId(value: string): void {
    if (!isConversationId(value)) throw new Error('The server returned an invalid conversation id.');
    conversationIdRef.current = value;
    setConversationId(value);
    storeConversationId(value);
  }

  async function createConversation(): Promise<string> {
    const existing = conversationIdRef.current;
    const generation = conversationGenerationRef.current;
    const pending = conversationCreationRef.current;
    if (pending && pending.generation === generation) return pending.promise;

    const creation = (async () => {
      let response: Response;
      try {
        response = await fetch('/api/ai/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(existing ? { conversationId: existing } : {}),
          signal: abortRef.current?.signal,
        });
      } catch (error) {
        throw networkError(error, '/api/ai/conversations');
      }
      if (!response.ok) {
        throw await responseError(response, 'Could not create an AI conversation.');
      }
      const body = await response.json().catch(() => null) as { conversationId?: unknown; error?: string } | null;
      if (!isConversationId(body?.conversationId)) {
        throw new Error('Conversation creation returned an invalid id.');
      }
      if (generation !== conversationGenerationRef.current) {
        throw new DOMException('Conversation was reset.', 'AbortError');
      }
      setActiveConversationId(body.conversationId);
      return body.conversationId;
    })();

    const pendingCreation = { generation, promise: creation };
    conversationCreationRef.current = pendingCreation;
    try {
      return await creation;
    } finally {
      if (conversationCreationRef.current === pendingCreation) {
        conversationCreationRef.current = null;
      }
    }
  }

  function openPanel() {
    setOpen(true);
    setError(null);
    void createConversation().catch((caught) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Could not create an AI conversation.');
    });
  }

  function closePanel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setOpen(false);
  }

  function resetConversation() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setError(null);
    conversationGenerationRef.current += 1;
    conversationIdRef.current = null;
    setConversationId(null);
    clearStoredConversationId();
    setMessages([initialMessage(context.page)]);
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setStreaming(true);
    let requestId: string | null = null;

    try {
      const activeConversationId = await createConversation();
      const userMessage: AiMessage = { role: 'user', content };
      setMessages((current) => [...current, userMessage]);
      setInput('');

      let response: Response;
      try {
        response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId: activeConversationId,
            message: userMessage,
            context,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw networkError(error, '/api/ai/chat');
      }

      const returnedConversationId = response.headers.get('x-conversation-id');
      if (returnedConversationId) setActiveConversationId(returnedConversationId);

      if (!response.ok) {
        throw await responseError(response, 'The ORION AI request failed.');
      }
      if (!response.body) {
        throw new Error('The ORION AI server returned no response body.');
      }

      setMessages((current) => [...current, { role: 'assistant', content: '' }]);
      requestId = response.headers.get('x-ai-request-id');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        const nextContent = assistantContent;
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: 'assistant', content: nextContent };
          return next;
        });
        window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'nearest' }));
      }
      assistantContent += decoder.decode();
      const streamErrorIndex = assistantContent.indexOf(AI_STREAM_ERROR_PREFIX);
      if (streamErrorIndex >= 0) {
        const streamError = assistantContent.slice(streamErrorIndex + AI_STREAM_ERROR_PREFIX.length).trim();
        throw new Error(streamError || 'The ORION AI stream failed on the server.');
      }
      if (!assistantContent.trim()) {
        setError('The AI returned an empty response.');
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      const detail = caught instanceof Error ? caught.message : 'The ORION AI request failed.';
      setError(requestId ? `${detail} (request ${requestId})` : detail);
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === 'assistant')));
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  const promptSuggestions = context.page === 'fitness'
    ? ['Summarise what I should focus on in this section.', 'What would be useful to review here?']
    : context.page === 'time_management'
      ? ['Help me think through today.', 'What should I prioritise?']
      : ['What can you help me with?', 'Help me plan my next step.'];

  return (
    <>
      {!open && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 sm:bottom-6 sm:right-6">
          {pathname === '/time-management' && (
            <button
              type="button"
              onClick={cycleTimeView}
              aria-label={`Switch Time Management view from ${timeView}`}
              title={`Next view: ${timeView === 'habits' ? 'To-dos' : timeView === 'todos' ? 'Calendar' : 'Habits'}`}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-bold uppercase tracking-wide text-zinc-200 shadow-xl shadow-black/30 transition hover:border-rose-400 hover:text-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
            >
              {timeView === 'habits' ? 'H' : timeView === 'todos' ? 'T' : 'C'}
            </button>
          )}
          <button
            type="button"
            onClick={openPanel}
            aria-label="Open ORION AI"
            title="Open ORION AI"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/40 bg-zinc-950 text-xs font-bold tracking-wide text-rose-300 shadow-xl shadow-black/30 transition hover:border-rose-300 hover:text-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
          >
            AI
          </button>
        </div>
      )}

      {open && (
        <aside
          aria-label="ORION AI chat"
          className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/50 sm:inset-x-6 sm:bottom-6 sm:right-6 sm:top-6 sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:w-[min(760px,calc(100vw-48px))] sm:rounded-2xl sm:border sm:border-zinc-700"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4 sm:px-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">ORION AI</p>
              <p className="mt-0.5 text-xs text-zinc-500">Context: {pageLabel(context.page)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={resetConversation}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              >
                New chat
              </button>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close ORION AI"
                title="Close ORION AI"
                className="rounded-md px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
              >
                ×
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-7" role="log" aria-live="polite">
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={message.role === 'user' ? 'ml-8 sm:ml-24' : 'mr-8 sm:mr-24'}>
                <div className={message.role === 'user'
                  ? 'rounded-xl bg-rose-500/15 px-4 py-3 text-sm leading-6 text-rose-50 sm:px-5 sm:py-4' 
                  : 'rounded-xl bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-200 sm:px-5 sm:py-4 sm:text-[15px]' }
                >
                  {message.content || (streaming && index === messages.length - 1 ? 'Thinking...' : '')}
                </div>
              </div>
            ))}
            {error && (
              <div className="rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            {!streaming && messages.length === 1 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {promptSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={sendMessage} className="shrink-0 border-t border-zinc-800 bg-zinc-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Ask ORION AI..."
                aria-label="Message ORION AI"
                disabled={streaming}
                className="min-h-12 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                className="rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {streaming ? '...' : 'Send'}
              </button>
            </div>
            {streaming && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Stop response
              </button>
            )}
          </form>
        </aside>
      )}
    </>
  );
}
