import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import { isMuscle } from '@/lib/fitness/hevy/muscle-data';
import MuscleDetailView from '@/components/fitness/muscle-detail-view';

export const metadata: Metadata = {
  title: 'Muscle — ORION Fitness',
};

export const dynamic = 'force-dynamic';

/**
 * Muscle drill-down route. Stage 5 §11 + §12.
 *
 * URL `name` is one of the canonical muscle labels from
 * `lib/fitness/hevy/muscle-data.ts`. Anything else 404s.
 */
export default async function MusclePage({
  params,
}: {
  params: Promise<{ muscle: string }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/login');
  const { muscle } = await params;
  const decoded = decodeURIComponent(muscle);
  if (!isMuscle(decoded) && decoded !== 'Unmapped') notFound();
  const calcs = await computeHevyCalculations(userId);
  const summary = calcs.muscles.find((m) => m.muscle === decoded);
  if (!summary) notFound();
  return <MuscleDetailView muscle={decoded} summary={summary} />;
}
