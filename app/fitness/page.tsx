import type { Metadata } from 'next';
import FitnessOverview from '@/components/fitness/fitness-overview';

/**
 * Fitness overview (Stage 5 §2 dashboard).
 *
 * The shared HUD chrome (top bar + sub-nav + footer) is owned by
 * `app/fitness/layout.tsx`. This page is just the route entrypoint.
 */

export const metadata: Metadata = {
  title: 'Fitness — ORION',
};

/** Bound the dashboard load to the 3 most-recent workouts. */
export const dynamic = 'force-dynamic';

export default function FitnessOverviewPage() {
  return <FitnessOverview />;
}
