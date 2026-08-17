import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import ManageDataView from '@/components/fitness/manage-data-view';

export const metadata: Metadata = {
  title: 'Manage Data — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function ManagePage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/login');
  return <ManageDataView userId={userId} />;
}
