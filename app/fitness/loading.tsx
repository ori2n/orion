/**
 * Fitness route loading state — shown IMMEDIATELY during navigation
 * while the page's server component (and its data fetch) streams in.
 * Without this, a route click on a slow connection looks like nothing
 * happened until the server responds.
 */
export default function FitnessLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Hero skeleton */}
      <div className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/40 p-5 sm:p-6">
        <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
        <div className="mt-3 h-7 w-56 animate-pulse rounded bg-zinc-800/70" />
        <div className="mt-2 h-3 w-40 animate-pulse rounded bg-zinc-800/50" />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-zinc-800/40 bg-zinc-950/40"
            />
          ))}
        </div>
      </div>

      {/* Section skeletons */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5"
        >
          <div className="h-3 w-32 animate-pulse rounded bg-zinc-800/70" />
          <div className="mt-1 h-2.5 w-48 animate-pulse rounded bg-zinc-800/50" />
          <div className="mt-4 h-36 animate-pulse rounded-xl bg-zinc-950/50" />
        </div>
      ))}
    </div>
  );
}
