import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { getHevyWorkoutDetail } from '@/lib/fitness/hevy/history';
import WorkoutDetailView from '@/components/fitness/workout-detail-view';

export const metadata: Metadata = {
  title: 'Workout — ORION Fitness',
};

export const dynamic = 'force-dynamic';

/**
 * Workout drill-down route — preserves the Hevy-imported data
 * (Stage 5 §15). We load it via the existing history library rather
 * than re-querying, so the existing record-verification surface
 * stays the source of truth.
 */
export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  const { id } = await params;
  const detail = await getHevyWorkoutDetail(userId, id);
  if (!detail) notFound();
  return <WorkoutDetailView detail={detail} />;
}
