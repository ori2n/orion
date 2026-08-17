import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import BodyweightDetailView from '@/components/fitness/bodyweight-detail-view';

export const metadata: Metadata = {
  title: 'Bodyweight — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function BodyweightPage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  return <BodyweightDetailView userId={userId} />;
}
