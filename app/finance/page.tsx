import type { Metadata } from 'next';
import FinanceOverview from '@/components/finance/finance-overview';

export const metadata: Metadata = {
  title: 'Finance — ORION',
};

export const dynamic = 'force-dynamic';

export default function FinanceDashboardPage() {
  return <FinanceOverview />;
}
