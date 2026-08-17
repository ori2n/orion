'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { FreebuffTerminalChunk } from '@/lib/freebuff';

/**
 * Recent terminal chunks to load on first mount / task switch. The
 * Bridge prunes old chunks server-side too, but this bound keeps the
 * browser from ever rendering an unbounded history on a narrow phone.
 */
const RECENT_CHUNK_LIMIT = 500;

/**
 * Live Freebuff terminal output.
 *
 * Owns its own data + Realtime subscription. On `taskId` change it
 * resets, loads the most recent chunk window, then streams new chunks
 * as they arrive (no manual refresh). Auto-scrolls to the newest output
 * only while the user is already near the bottom, so scrolling up to
 * read history is never yanked away.
 */
export default function TerminalOutput({
  taskId,
  userId,
}: {
  taskId: string | null;
  userId: string | null;
}) {
  const [chunks, setChunks] = useState<FreebuffTerminalChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Track whether the user is pinned to the latest output.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (!taskId || !userId) {
      setChunks([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setChunks([]);
    atBottomRef.current = true;

    (async () => {
      const { data, error } = await supabase
        .from('freebuff_terminal_output')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(RECENT_CHUNK_LIMIT);

      if (cancelled) return;
      if (error) {
        // Terminal history is non-critical — fail soft, keep streaming.
        console.error('[freebuff] terminal history load failed:', error.message);
      }
      // Reverse to chronological order for rendering.
      setChunks((data ?? []).slice().reverse() as FreebuffTerminalChunk[]);
      setLoading(false);
    })();

    // Subscribe to live chunks for this task.
    const channel = supabase
      .channel(`freebuff-terminal-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'freebuff_terminal_output',
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const row = payload.new as FreebuffTerminalChunk;
          setChunks((prev) => [...prev, row]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [taskId, userId]);

  // Auto-scroll on new chunks, but only when pinned to the bottom.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom('auto');
  }, [chunks, scrollToBottom]);

  const text = chunks.map((c) => c.output).join('');
  const isAtBottom = atBottomRef.current;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black">
      <div
        className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          Terminal output
        </span>
        {!isAtBottom && text.length > 0 && (
          <button
            type="button"
            onClick={() => {
              atBottomRef.current = true;
              scrollToBottom('smooth');
            }}
            className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            ↓ Latest
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-zinc-600">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          </div>
        ) : text.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-600">
            Waiting for output…
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
        )}
      </div>
    </div>
  );
}

/**
 * Presentational terminal body — shared by the history detail view for
 * a static, non-subscribing replay of a past session's output.
 */
export function TerminalView({
  text,
  emptyLabel = 'No output captured.',
}: {
  text: string;
  emptyLabel?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-black px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300">
      {text.length === 0 ? (
        <div className="flex h-full items-center justify-center text-zinc-600">
          {emptyLabel}
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
      )}
    </div>
  );
}
