import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import WorkoutHistoryView from '@/components/fitness/workout-history-view';

export const metadata: Metadata = {
  title: 'Workouts — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function WorkoutsPage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  return <WorkoutHistoryView userId={userId} />;
}
