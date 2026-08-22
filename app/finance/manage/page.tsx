import type { Metadata } from 'next';
import ManageDataView from '@/components/finance/manage-data-view';

export const metadata: Metadata = {
  title: 'Manage Data — ORION Finance',
};

export const dynamic = 'force-dynamic';

export default function ManageDataPage() {
  return <ManageDataView />;
}
