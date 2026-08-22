/**
 * Financial insights for the ORION Finance module.
 *
 * Analyses the user's financial data and surfaces useful observations
 * rather than simply displaying graphs. Insights are data-driven and
 * never imply certainty — they present calculations, trends, and scenarios.
 */
import type { FinancialInsight } from './types';
import { calculateNetWorth, compareSpendingToAverage, buildProjectionScenarios, getMonthlyRecurringTotal, getMilestoneLabel, MILESTONE_AMOUNTS } from './calculations';
import { getMonthSpending, getMonthIncome, getSpendingByCategory } from './transactions';
import { currentYearMonth, yearMonthAgo, fmtCurrency, fmtPercent } from './format';

let insightCounter = 0;
function makeId(): string {
  return `insight-${++insightCounter}`;
}

/**
 * Generate all active insights for the current user.
 * Returns insights sorted by priority (most important first).
 */
export async function generateInsights(): Promise<FinancialInsight[]> {
  const insights: FinancialInsight[] = [];

  // Run all analyses in parallel
  const [spendingComparison, projection, netWorth, currentSpending, recurringTotal, categories] =
    await Promise.all([
      compareSpendingToAverage().catch(() => null),
      buildProjectionScenarios().catch(() => null),
      calculateNetWorth().catch(() => null),
      getMonthSpending(currentYearMonth()).catch(() => 0),
      getMonthlyRecurringTotal().catch(() => 0),
      getSpendingByCategory(currentYearMonth()).catch(() => []),
    ]);

  // ─── Spending insights ───────────────────────────────────

  if (spendingComparison) {
    const { currentMonth, average, difference } = spendingComparison;

    if (difference > 0 && average > 0) {
      insights.push({
        id: makeId(),
        type: 'spending',
        title: 'Spending above average',
        body: `Spending this month is ${fmtCurrency(difference)} above your recent average of ${fmtCurrency(average)}.`,
        value: difference,
        icon: '📈',
        priority: 1,
      });
    } else if (difference < -10 && average > 0) {
      insights.push({
        id: makeId(),
        type: 'spending',
        title: 'Spending below average',
        body: `Spending this month is ${fmtCurrency(Math.abs(difference))} below your recent average. Nice work.`,
        value: difference,
        icon: '📉',
        priority: 3,
      });
    }
  }

  // Top spending category
  if (categories.length > 0) {
    const top = categories[0];
    const total = categories.reduce((s: number, c: { total: number }) => s + c.total, 0);
    if (total > 0) {
      const pct = (top.total / total) * 100;
      insights.push({
        id: makeId(),
        type: 'spending',
        title: 'Largest spending category',
        body: `${top.categoryName} accounts for ${fmtPercent(pct / 100)} of spending this month (${fmtCurrency(top.total)}).`,
        value: top.total,
        icon: '🏷️',
        priority: 2,
      });
    }
  }

  // Recurring spending
  if (recurringTotal > 0) {
    insights.push({
      id: makeId(),
      type: 'spending',
      title: 'Monthly recurring costs',
      body: `You have approximately ${fmtCurrency(recurringTotal)} in recurring monthly spending.`,
      value: recurringTotal,
      icon: '🔄',
      priority: 2,
    });
  }

  // ─── Investment / goal insights ──────────────────────────

  if (projection) {
    const { goal, scenarios, currentAge, yearsRemaining, monthlyInvestment } = projection;
    const baseScenario = scenarios.find((s) => s.name === 'base');

    if (baseScenario) {
      if (baseScenario.isAhead) {
        insights.push({
          id: makeId(),
          type: 'investing',
          title: 'Ahead of target',
          body: `Based on current assumptions, your projected portfolio of ${fmtCurrency(baseScenario.projectedPortfolio)} exceeds your ${fmtCurrency(goal.target_amount)} goal.`,
          value: baseScenario.projectedPortfolio,
          icon: '🎯',
          priority: 1,
        });
      } else if (yearsRemaining && yearsRemaining > 0) {
        const diff = baseScenario.difference;
        insights.push({
          id: makeId(),
          type: 'investing',
          title: 'Gap to goal',
          body: `Your projected portfolio is ${fmtCurrency(Math.abs(diff))} ${diff > 0 ? 'short of' : 'ahead of'} your ${fmtCurrency(goal.target_amount)} target under base-case assumptions.`,
          value: diff,
          icon: '🎯',
          priority: 1,
        });

        // Impact of increasing monthly investment
        if (monthlyInvestment > 0) {
          const extraMonthly = 100;
          const extraFv =
            extraMonthly *
            ((Math.pow(1 + baseScenario.annualReturn / 12, (yearsRemaining ?? 0) * 12) - 1) /
              (baseScenario.annualReturn / 12));
          insights.push({
            id: makeId(),
            type: 'suggestion',
            title: 'Impact of investing more',
            body: `Increasing monthly investing by ${fmtCurrency(extraMonthly)} could add approximately ${fmtCurrency(extraFv)} to your projected age-${goal.target_age ?? 45} portfolio.`,
            value: extraFv,
            icon: '💡',
            priority: 4,
          });
        }
      }
    }
  }

  // ─── Milestone insights ──────────────────────────────────

  if (netWorth) {
    const nextAmount = MILESTONE_AMOUNTS.find((m) => m > netWorth.totalNetWorth);
    if (nextAmount) {
      const gap = nextAmount - netWorth.totalNetWorth;
      insights.push({
        id: makeId(),
        type: 'milestone',
        title: 'Next milestone',
        body: `Your portfolio is ${fmtCurrency(gap)} from the next milestone: ${getMilestoneLabel(nextAmount)}.`,
        value: gap,
        icon: '🏔️',
        priority: 3,
      });
    }
  }

  // ─── Saving insights ─────────────────────────────────────

  if (spendingComparison && netWorth) {
    const month = currentYearMonth();
    const income = await getMonthIncome(month);
    const saved = income - spendingComparison.currentMonth;
    if (saved > 0) {
      insights.push({
        id: makeId(),
        type: 'saving' as const,
        title: 'Monthly saving',
        body: `You saved ${fmtCurrency(saved)} this month after expenses.`,
        value: saved,
        icon: '🏦',
        priority: 3,
      });
    }
  }

  // Sort by priority
  return insights.sort((a, b) => a.priority - b.priority);
}
