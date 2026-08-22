import type { Metadata } from 'next';
import SpendingView from '@/components/finance/spending-view';

export const metadata: Metadata = {
  title: 'Spending — ORION Finance',
};

export const dynamic = 'force-dynamic';

export default function SpendingPage() {
  return <SpendingView />;
}
