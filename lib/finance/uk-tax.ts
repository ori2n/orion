/**
 * UK Tax Calculator — England/Wales rules (2024/25 tax year).
 *
 * All values in GBP. The main export is `calculateUKTakeHomePay()` which
 * accepts gross annual compensation (base + bonus) and returns a detailed
 * breakdown of tax, NI, and net income.
 *
 * Designed to be easy to update when HMRC rules change — all thresholds
 * are constants at the top of this file.
 *
 * Usage:
 *   const result = calculateUKTakeHomePay(150_000);
 *   // result = { gross, incomeTax, nationalInsurance, totalDeductions, netMonthly, netAnnual, ... }
 */

// ─── Tax Year 2024/25 Constants ─────────────────────────────────────

/** Personal Allowance: income you don't pay tax on */
const PERSONAL_ALLOWANCE = 12_570;

/** Personal Allowance taper threshold — starts reducing above this */
const TAPER_THRESHOLD = 100_000;

/** At this income, Personal Allowance reaches £0 */
const TAPER_MAX_INCOME = 125_140;

/** Taper rate: £1 PA lost per £2 earned above threshold */
const TAPER_RATE = 1 / 2;

// Income Tax bands (on taxable income after Personal Allowance)
const BASIC_RATE_BAND_MAX  = 50_270;   // 20%
const HIGHER_RATE_BAND_MAX = 125_140;  // 40%
const ADDITIONAL_RATE_THRESHOLD = 125_140; // 45% above this

const BASIC_RATE     = 0.20;
const HIGHER_RATE    = 0.40;
const ADDITIONAL_RATE = 0.45;

// National Insurance (employee, Class 1, annualised — 2024/25)
const NI_PRIMARY_THRESHOLD = 12_570;   // 0% up to here
const NI_UPPER_EARNINGS_LIMIT = 50_270; // 8% between PT and UEL
const NI_RATE_MAIN    = 0.08;          // 8% on earnings between PT and UEL
const NI_RATE_HIGHER  = 0.02;          // 2% on earnings above UEL

// ─── Public Types ───────────────────────────────────────────────────

export interface UKTaxBreakdown {
  /** Total gross compensation */
  gross: number;
  /** Income tax due */
  incomeTax: number;
  /** Employee National Insurance due */
  nationalInsurance: number;
  /** Total deductions (tax + NI) */
  totalDeductions: number;
  /** Net annual income after tax & NI */
  netAnnual: number;
  /** Net monthly take-home pay (netAnnual / 12) */
  netMonthly: number;
  /** Effective overall tax + NI rate */
  effectiveRate: number;
  /** Personal allowance actually received */
  personalAllowanceUsed: number;
}

// ─── Income Tax ─────────────────────────────────────────────────────

/**
 * Compute the Personal Allowance after applying the taper.
 *
 * The allowance is reduced by £1 for every £2 earned above £100,000,
 * reaching £0 when income ≥ £125,140.
 */
function computePersonalAllowance(grossIncome: number): number {
  if (grossIncome <= TAPER_THRESHOLD) {
    return PERSONAL_ALLOWANCE;
  }

  if (grossIncome >= TAPER_MAX_INCOME) {
    return 0;
  }

  const excess = grossIncome - TAPER_THRESHOLD;
  const reduction = Math.ceil(excess * TAPER_RATE); // round up per HMRC rules
  return Math.max(0, PERSONAL_ALLOWANCE - reduction);
}

/**
 * Compute income tax on taxable income using the progressive band system.
 *
 *   taxableIncome = gross - personalAllowance
 *   20% on first slice up to £50,270
 *   40% on slice from £50,271 → £125,140
 *   45% on anything above £125,140
 */
function computeIncomeTax(grossIncome: number, personalAllowance: number): number {
  const taxableIncome = Math.max(0, grossIncome - personalAllowance);

  if (taxableIncome <= 0) return 0;

  // Basic rate band: 20% up to £50,270
  const basicSlice = Math.min(taxableIncome, BASIC_RATE_BAND_MAX);
  const basicTax = basicSlice * BASIC_RATE;

  if (taxableIncome <= BASIC_RATE_BAND_MAX) {
    return Math.round(basicTax);
  }

  // Higher rate band: 40% from £50,271 → £125,140
  const remainingAfterBasic = taxableIncome - basicSlice;
  const higherSlice = Math.min(remainingAfterBasic, HIGHER_RATE_BAND_MAX - BASIC_RATE_BAND_MAX);
  const higherTax = higherSlice * HIGHER_RATE;

  if (taxableIncome <= HIGHER_RATE_BAND_MAX) {
    return Math.round(basicTax + higherTax);
  }

  // Additional rate: 45% above £125,140
  const additionalSlice = taxableIncome - (BASIC_RATE_BAND_MAX - 0) - (HIGHER_RATE_BAND_MAX - BASIC_RATE_BAND_MAX);
  const additionalTax = additionalSlice * ADDITIONAL_RATE;

  return Math.round(basicTax + higherTax + additionalTax);
}

// ─── National Insurance ─────────────────────────────────────────────

/**
 * Compute employee Class 1 National Insurance for the year.
 *
 *   0%  on earnings up to £12,570 (Primary Threshold)
 *   8%  on earnings between £12,570 and £50,270
 *   2%  on earnings above £50,270
 *
 * NI is calculated on gross compensation (same as income tax base).
 */
function computeNationalInsurance(grossIncome: number): number {
  if (grossIncome <= NI_PRIMARY_THRESHOLD) return 0;

  // Earnings between PT and UEL at 8%
  const mainBand = Math.min(grossIncome, NI_UPPER_EARNINGS_LIMIT) - NI_PRIMARY_THRESHOLD;
  const mainNI = mainBand * NI_RATE_MAIN;

  if (grossIncome <= NI_UPPER_EARNINGS_LIMIT) {
    return Math.round(mainNI);
  }

  // Earnings above UEL at 2%
  const higherBand = grossIncome - NI_UPPER_EARNINGS_LIMIT;
  const higherNI = higherBand * NI_RATE_HIGHER;

  return Math.round(mainNI + higherNI);
}

// ─── Main Export ────────────────────────────────────────────────────

/**
 * Calculate UK take-home pay from gross annual compensation.
 *
 * @param grossIncome  Total gross compensation (base salary + bonus) in GBP.
 * @returns A `UKTaxBreakdown` with all deduction and net pay figures.
 */
export function calculateUKTakeHomePay(grossIncome: number): UKTaxBreakdown {
  // Validate
  if (grossIncome < 0) grossIncome = 0;
  if (!isFinite(grossIncome)) grossIncome = 0;
  const gross = Math.round(grossIncome);

  // 1. Personal Allowance (with taper)
  const personalAllowanceUsed = computePersonalAllowance(gross);

  // 2. Income Tax
  const incomeTax = computeIncomeTax(gross, personalAllowanceUsed);

  // 3. National Insurance
  const nationalInsurance = computeNationalInsurance(gross);

  // 4. Totals
  const totalDeductions = incomeTax + nationalInsurance;
  const netAnnual = gross - totalDeductions;
  const netMonthly = Math.round((netAnnual / 12) * 100) / 100;

  // 5. Effective rate
  const effectiveRate = gross > 0
    ? Math.round((totalDeductions / gross) * 10_000) / 100
    : 0;

  return {
    gross,
    incomeTax,
    nationalInsurance,
    totalDeductions,
    netAnnual,
    netMonthly,
    effectiveRate,
    personalAllowanceUsed,
  };
}
