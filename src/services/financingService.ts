import { randomUUID } from 'crypto';

/**
 * Rule-based stand-in for the real Parthian credit API, same approach as
 * vendorMatchingService.ts's rule-based stand-in for the Claude API - same input/output
 * shape a real Parthian integration would need, so swapping this out later doesn't require
 * changing any caller. See CLAUDE.md note 19: Parthian is the confirmed backing/payment
 * partner, but no API docs/credentials exist yet to build the real integration against.
 */

export interface FinancingPlan {
  planId: string;
  tenorMonths: number;
  feeRate: number; // flat fee over the tenor, illustrative only - not a real underwritten rate
  monthlyPayment: number;
  totalRepayable: number;
}

// Stand-in plan menu. A real integration would likely fetch this from Parthian per-request
// (rates can depend on their live underwriting), but the shape callers consume stays the same.
const PLAN_DEFINITIONS: { planId: string; tenorMonths: number; feeRate: number }[] = [
  { planId: '3_MONTH', tenorMonths: 3, feeRate: 0.05 },
  { planId: '6_MONTH', tenorMonths: 6, feeRate: 0.09 },
  { planId: '12_MONTH', tenorMonths: 12, feeRate: 0.15 },
];

function buildPlan(principalAmount: number, def: (typeof PLAN_DEFINITIONS)[number]): FinancingPlan {
  const totalRepayable = Math.round(principalAmount * (1 + def.feeRate) * 100) / 100;
  const monthlyPayment = Math.round((totalRepayable / def.tenorMonths) * 100) / 100;
  return {
    planId: def.planId,
    tenorMonths: def.tenorMonths,
    feeRate: def.feeRate,
    monthlyPayment,
    totalRepayable,
  };
}

export function getFinancingOptions(principalAmount: number): FinancingPlan[] {
  return PLAN_DEFINITIONS.map((def) => buildPlan(principalAmount, def));
}

/**
 * Recomputes a single plan server-side from its planId - the customer's chosen planId is
 * trusted, the resulting numbers are not (same principle as vendor pricing elsewhere:
 * never take client-supplied money math at face value).
 */
export function resolvePlan(principalAmount: number, planId: string): FinancingPlan | null {
  const def = PLAN_DEFINITIONS.find((p) => p.planId === planId);
  return def ? buildPlan(principalAmount, def) : null;
}

export interface ParthianSubmissionResult {
  parthianReferenceId: string;
}

/**
 * Stubbed submission to Parthian. A real implementation calls Parthian's loan-application
 * endpoint here and returns their reference ID; the resulting LoanApplication row always
 * starts (and stays) PENDING_REVIEW until POST /webhooks/parthian/loan-status reports a
 * decision - this stub deliberately does not fake an instant approval, so the async
 * webhook-driven flow is exercised the same way it will be in production.
 */
export async function submitToParthian(): Promise<ParthianSubmissionResult> {
  return { parthianReferenceId: `stub_${randomUUID()}` };
}
