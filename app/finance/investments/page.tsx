import type { Metadata } from 'next';
import InvestmentsView from '@/components/finance/investments-view';

export const metadata: Metadata = {
  title: 'Investments — ORION Finance',
};

export const dynamic = 'force-dynamic';

export default function InvestmentsPage() {
  return <InvestmentsView />;
}
