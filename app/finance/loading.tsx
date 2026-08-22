export default function FinanceLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
      <div className="flex flex-col items-center gap-3">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
        <span className="text-xs text-zinc-500">Loading finance data…</span>
      </div>
    </div>
  );
}
