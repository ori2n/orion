'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  taskStatusLabel,
  TASK_STATUS_META,
  formatTimestamp,
  formatElapsed,
  type FreebuffPrompt,
  type FreebuffTask,
  type FreebuffTerminalChunk,
} from '@/lib/freebuff';
import { TerminalView } from './terminal-output';

/**
 * Past Freebuff tasks. A compact list (title / date / status / duration
 * / branch / commit / prompt count) that expands into the full session
 * history — prompts in order plus the terminal output replay.
 */
export default function TaskHistory({ tasks }: { tasks: FreebuffTask[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promptCounts, setPromptCounts] = useState<Map<string, number>>(new Map());
  const [prompts, setPrompts] = useState<FreebuffPrompt[]>([]);
  const [terminalText, setTerminalText] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  // One query for prompt counts across the whole history list.
  useEffect(() => {
    if (tasks.length === 0) {
      setPromptCounts(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = tasks.map((t) => t.id);
      const { data, error } = await supabase
        .from('freebuff_prompts')
        .select('task_id')
        .in('task_id', ids);
      if (cancelled) return;
      if (error) {
        console.error('[freebuff] prompt count load failed:', error.message);
        return;
      }
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.task_id, (counts.get(row.task_id) ?? 0) + 1);
      }
      setPromptCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  const loadDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    setPrompts([]);
    setTerminalText('');
    const [promptRes, termRes] = await Promise.all([
      supabase
        .from('freebuff_prompts')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true }),
      supabase
        .from('freebuff_terminal_output')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
    if (promptRes.error) {
      console.error('[freebuff] detail prompts failed:', promptRes.error.message);
    }
    if (termRes.error) {
      console.error('[freebuff] detail terminal failed:', termRes.error.message);
    }
    setPrompts((promptRes.data ?? []) as FreebuffPrompt[]);
    const chunks = ((termRes.data ?? []) as FreebuffTerminalChunk[]).slice().reverse();
    // Rebuild the terminal view: finalized scrollback lines plus the final
    // live-screen snapshot (screen chunks replace, so keep only the last).
    const scrollback = chunks
      .filter((c) => (c.kind ?? 'output') !== 'screen')
      .map((c) => c.output)
      .join('\n');
    const screen = [...chunks].reverse().find((c) => c.kind === 'screen')?.output ?? '';
    setTerminalText(scrollback + (scrollback && screen ? '\n\n' : '') + screen);
    setDetailLoading(false);
  }, []);

  function toggleTask(taskId: string) {
    if (selectedId === taskId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(taskId);
    void loadDetail(taskId);
  }

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-1.5">
      {tasks.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-sm text-zinc-400 dark:border-zinc-800">
          No Freebuff tasks yet.
        </div>
      ) : (
        tasks.map((task) => {
          const isOpen = selectedId === task.id;
          const meta = TASK_STATUS_META[task.status];
          const duration = taskDuration(task);
          return (
            <div
              key={task.id}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => toggleTask(task.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
                    <span>{formatTimestamp(task.created_at)}</span>
                    <span>·</span>
                    <span>{duration}</span>
                    {task.branch_name && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{task.branch_name}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{promptCounts.get(task.id) ?? 0} prompts</span>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {taskStatusLabel(task.status)}
                </span>
                <svg
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
                          Initial prompt
                        </div>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                          {task.initial_prompt}
                        </p>
                      </div>

                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
                          Prompts ({prompts.length})
                        </div>
                        <ol className="space-y-1.5">
                          {prompts.map((p, i) => (
                            <li
                              key={p.id}
                              className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                            >
                              <span className="mr-1.5 text-[10px] font-semibold text-zinc-400">
                                #{i + 1}
                              </span>
                              {p.prompt}
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div className="flex h-48 flex-col">
                        <TerminalView text={terminalText} />
                      </div>

                      {(task.git_commit || task.preview_url || task.error) && (
                        <div className="space-y-1 text-[11px] text-zinc-400">
                          {task.git_commit && (
                            <div>
                              <span className="font-semibold text-zinc-500">Commit </span>
                              <span className="font-mono">{task.git_commit.slice(0, 10)}</span>
                            </div>
                          )}
                          {task.preview_url && (
                            <div>
                              <span className="font-semibold text-zinc-500">Preview </span>
                              <a
                                href={task.preview_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-violet-500 underline underline-offset-2 hover:text-violet-400"
                              >
                                {task.preview_url}
                              </a>
                            </div>
                          )}
                          {task.error && (
                            <div className="text-red-500">{task.error}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function taskDuration(task: FreebuffTask): string {
  const startRaw = task.started_at ?? task.created_at;
  const endRaw = task.completed_at ?? task.stopped_at;
  if (!startRaw) return '—';
  const start = Date.parse(startRaw);
  const end = endRaw ? Date.parse(endRaw) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  return formatElapsed((end - start) / 1000);
}
