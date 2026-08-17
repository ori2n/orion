import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import ExerciseDetailView from '@/components/fitness/exercise-detail-view';

export const metadata: Metadata = {
  title: 'Exercise — ORION Fitness',
};

export const dynamic = 'force-dynamic';

/**
 * Exercise drill-down route. Stage 5 §9.
 *
 * The dynamic part of the URL is the EXACT Hevy exercise name (e.g.
 * `Bench%20Press%20(Barbell)`). Names are case-sensitive — we encode
 * them in URLs and decode them on the server.
 */
export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const calcs = await computeHevyCalculations(userId);
  const summary = calcs.exercises.find((e) => e.name === decoded);
  if (!summary) notFound();
  return <ExerciseDetailView summary={summary} />;
}
