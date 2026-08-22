/**
 * Category management and auto-categorisation for the ORION Finance module.
 *
 * Handles:
 * - Listing / creating / updating spending categories
 * - Matching transaction descriptions against category rules
 * - Auto-categorising imported transactions
 */
import { supabase } from '@/lib/supabase';
import type {
  TransactionCategory,
  CategoryRule,
  MatchType,
} from './types';

// ─── Default categories ──────────────────────────────────────

export const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: '🍽️', color: '#10b981' },
  { name: 'Transport', icon: '🚌', color: '#3b82f6' },
  { name: 'Shopping', icon: '🛍️', color: '#8b5cf6' },
  { name: 'Entertainment', icon: '🎬', color: '#f59e0b' },
  { name: 'Subscriptions', icon: '🔄', color: '#ec4899' },
  { name: 'Travel', icon: '✈️', color: '#06b6d4' },
  { name: 'Sport', icon: '⚽', color: '#14b8a6' },
  { name: 'Education', icon: '📚', color: '#6366f1' },
  { name: 'Health', icon: '💊', color: '#ef4444' },
  { name: 'Gifts', icon: '🎁', color: '#f472b6' },
  { name: 'Other', icon: '📦', color: '#6b7280' },
  { name: 'Income', icon: '💰', color: '#22c55e' },
  { name: 'Savings', icon: '🏦', color: '#0ea5e9' },
] as const;

// ─── Fetch categories ────────────────────────────────────────

/** List all categories for the current user, sorted by sort_order. */
export async function listCategories(): Promise<TransactionCategory[]> {
  const { data, error } = await supabase
    .from('transaction_categories')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Failed to list categories:', error);
    return [];
  }
  return (data ?? []) as TransactionCategory[];
}

/** Create a new spending category. */
export async function createCategory(
  name: string,
  icon?: string,
  color?: string,
): Promise<TransactionCategory | null> {
  const { data, error } = await supabase
    .from('transaction_categories')
    .insert({
      name,
      icon: icon ?? null,
      color: color ?? null,
      is_system: false,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create category:', error);
    return null;
  }
  return data as TransactionCategory;
}

/** Update a category's name, icon, or color. */
export async function updateCategory(
  id: string,
  updates: Partial<Pick<TransactionCategory, 'name' | 'icon' | 'color'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('transaction_categories')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error('Failed to update category:', error);
    return false;
  }
  return true;
}

/** Delete a non-system category. */
export async function deleteCategory(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('transaction_categories')
    .delete()
    .eq('id', id)
    .eq('is_system', false);

  if (error) {
    console.error('Failed to delete category:', error);
    return false;
  }
  return true;
}

// ─── Category rules ──────────────────────────────────────────

/** List all category rules for the current user. */
export async function listCategoryRules(): Promise<CategoryRule[]> {
  const { data, error } = await supabase
    .from('category_rules')
    .select('*')
    .order('priority', { ascending: false });

  if (error) {
    console.error('Failed to list category rules:', error);
    return [];
  }
  return (data ?? []) as CategoryRule[];
}

/** Create a new category rule. */
export async function createCategoryRule(
  categoryId: string,
  pattern: string,
  matchType: MatchType = 'contains',
  priority = 0,
): Promise<CategoryRule | null> {
  const { data, error } = await supabase
    .from('category_rules')
    .insert({
      category_id: categoryId,
      pattern,
      match_type: matchType,
      priority,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create category rule:', error);
    return null;
  }
  return data as CategoryRule;
}

/** Delete a category rule. */
export async function deleteCategoryRule(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('category_rules')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete category rule:', error);
    return false;
  }
  return true;
}

// ─── Auto-categorisation ─────────────────────────────────────

/**
 * Match a transaction description against the user's category rules.
 * Returns the matching category ID, or null if no rule matches.
 *
 * Rules are checked in priority order (highest first).
 * For the same priority, 'exact' > 'starts_with' > 'ends_with' > 'contains' > 'regex'.
 */
export function matchCategory(
  description: string,
  rules: CategoryRule[],
): string | null {
  const lower = description.toLowerCase();

  // Sort by priority descending, then by match specificity
  const specificity: Record<MatchType, number> = {
    exact: 5,
    starts_with: 4,
    ends_with: 3,
    contains: 2,
    regex: 1,
  };

  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (specificity[b.match_type] ?? 0) - (specificity[a.match_type] ?? 0);
  });

  for (const rule of sorted) {
    if (matchesRule(lower, rule)) {
      return rule.category_id;
    }
  }
  return null;
}

function matchesRule(descriptionLower: string, rule: CategoryRule): boolean {
  const patternLower = rule.pattern.toLowerCase();

  switch (rule.match_type) {
    case 'exact':
      return descriptionLower === patternLower;
    case 'starts_with':
      return descriptionLower.startsWith(patternLower);
    case 'ends_with':
      return descriptionLower.endsWith(patternLower);
    case 'contains':
      return descriptionLower.includes(patternLower);
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(descriptionLower);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Auto-categorise a batch of transactions using existing rules.
 * Returns a map of transaction ID → category ID for matched transactions.
 */
export async function autoCategorise(
  transactions: Array<{ id: string; description: string | null }>,
): Promise<Map<string, string>> {
  const rules = await listCategoryRules();
  const categories = await listCategories();
  const result = new Map<string, string>();

  // Build a quick lookup for category names → IDs
  const nameToId = new Map<string, string>();
  for (const cat of categories) {
    nameToId.set(cat.name.toLowerCase(), cat.id);
  }

  for (const tx of transactions) {
    if (!tx.description) continue;

    // First try rule-based matching
    const ruleMatch = matchCategory(tx.description, rules);
    if (ruleMatch) {
      result.set(tx.id, ruleMatch);
      continue;
    }

    // Fall back to simple keyword matching for common patterns
    const desc = tx.description.toLowerCase();
    const keywordMatch = keywordCategoryMatch(desc, nameToId);
    if (keywordMatch) {
      result.set(tx.id, keywordMatch);
    }
  }

  return result;
}

/** Simple keyword-based category matching as a fallback. */
function keywordCategoryMatch(
  description: string,
  nameToId: Map<string, string>,
): string | null {
  const keywords: Record<string, string[]> = {
    food: ['tesco', 'sainsbury', 'asda', 'morrisons', 'aldi', 'lidl', 'coop', 'ocado', 'deliveroo', 'ubereats', 'just eat', 'mcdonald', 'starbucks', 'costa', 'greggs', 'prett', 'nando', 'wetherspoon', 'pub', 'restaurant', 'cafe', 'coffee'],
    transport: ['uber', 'bolt', 'lyft', 'trainline', 'national rail', 'tfl', 'oyster', 'petrol', 'shell', 'bp', 'esso', 'parking', 'ev charge', 'nth drive'],
    shopping: ['amazon', 'ebay', 'etsy', 'argos', 'john lewis', 'next', 'zara', 'h&m', 'primark', 'currys', 'apple store'],
    entertainment: ['netflix', 'spotify', 'disney', 'youtube', 'cinema', 'odeon', 'vue', 'apple music', 'hulu', 'hbo', 'prime video', 'audible'],
    subscriptions: ['subscription', 'monthly', 'annual', 'membership'],
    travel: ['airbnb', 'booking.com', 'ryanair', 'easyjet', 'ba ', 'british airways', 'hotel', 'hostel', 'expedia', 'skyscanner'],
    sport: ['gym', 'puregym', 'nuffield', 'fitness', 'parkrun', 'strava', 'decathlon', 'sports direct', 'nikke', 'adidas'],
    health: ['boots', 'pharmacy', 'nhs', 'doctor', 'dentist', 'optician', 'vitamin', 'supplement'],
  };

  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (description.includes(word)) {
        const catId = nameToId.get(category);
        if (catId) return catId;
      }
    }
  }
  return null;
}
