import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import WorkoutHistoryView from '@/components/fitness/workout-history-view';

export const metadata: Metadata = {
  title: 'Workouts — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function WorkoutsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/login');
  return <WorkoutHistoryView userId={userId} />;
}
