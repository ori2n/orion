import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
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
  // Use the SERVER client — the hevy data layer defaults to a browser
  // client, which has no session server-side and would return no rows.
  const db = await createClient();
  // Seed the muscle map so every exercise name gets a row, even on
  // first visit (no-op when everything is already mapped).
  await seedDefaultMuscleMap(userId, db);
  const calcs = await computeHevyCalculations(userId, undefined, db);
  return <StrengthListView calcs={calcs} />;
}
