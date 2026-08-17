import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import ManageDataView from '@/components/fitness/manage-data-view';

export const metadata: Metadata = {
  title: 'Manage Data — ORION Fitness',
};

export const dynamic = 'force-dynamic';

export default async function ManagePage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  return <ManageDataView userId={userId} />;
}
