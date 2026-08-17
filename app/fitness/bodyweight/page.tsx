import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import BodyweightDetailView from '@/components/fitness/bodyweight-detail-view';

export const metadata: Metadata = {
  title: 'Bodyweight — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function BodyweightPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/login');
  return <BodyweightDetailView userId={userId} />;
}
