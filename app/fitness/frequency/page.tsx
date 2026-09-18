import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { seedDefaultMuscleMap } from '@/lib/fitness/hevy/muscles';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import FrequencyListView from '@/components/fitness/frequency-list-view';

export const metadata: Metadata = {
  title: 'Training Frequency — ORION Fitness',
};

export const dynamic = 'force-dynamic';

/**
 * Training Frequency analytics — the per-muscle weekly-session
 * comparison against the user's targets. This is the same grid that
 * used to live on the Overview page (Stage 5 §4), now hosted on its
 * own route so Overview stays clean. The status-badge logic, drill
 * targets and data pipeline are unchanged.
 */
export default async function FrequencyPage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  // Server client — the calculations layer defaults to the browser
  // client, which has no session server-side and would return no rows.
  const db = await createClient();
  // Seed the muscle map so every exercise name gets a muscle row, even
  // on first visit (no-op when everything is already mapped).
  await seedDefaultMuscleMap(userId, db);
  const calcs = await computeHevyCalculations(userId, undefined, db);
  return <FrequencyListView calcs={calcs} />;
}
