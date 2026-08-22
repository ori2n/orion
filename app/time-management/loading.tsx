/**
 * Time Management loading state — shown immediately during navigation
 * so a route click never appears to hang while data streams in.
 */
export default function TimeManagementLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
        <span className="text-xs text-zinc-400 dark:text-zinc-600">
          Loading…
        </span>
      </div>
    </div>
  );
}
