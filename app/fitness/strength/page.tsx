import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { seedDefaultMuscleMap } from '@/lib/fitness/hevy/muscles';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import StrengthListView from '@/components/fitness/strength-list-view';

export const metadata: Metadata = {
  title: 'Strength — ORION',
};

export const dynamic = 'force-dynamic';

export default async function StrengthPage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  // Seed the muscle map so every exercise name gets a row, even on
  // first visit (no-op when everything is already mapped).
  await seedDefaultMuscleMap(userId);
  const calcs = await computeHevyCalculations(userId);
  return <StrengthListView calcs={calcs} />;
}
