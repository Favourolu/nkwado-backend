import { VendorCategory } from '@prisma/client';
import prisma from '../utils/prisma';

export interface VendorMatch {
  vendorId: string;
  category: string;
  businessName: string;
  basePrice: number;
  reason: string;
}

interface MatchInput {
  budgetRange: string;
  guestCount: number | null;
  location: string | null;
  /** Vendor categories the customer actually wants matched. Empty/omitted matches every
   *  available category (previous behavior), capped at MAX_MATCHES. */
  categories?: string[];
}

const BUDGET_CEILING: Record<string, number> = {
  ZERO_TO_500K: 500_000,
  FROM_500K_TO_1M: 1_000_000,
  FROM_1M_TO_3M: 3_000_000,
  FROM_3M_TO_5M: 5_000_000,
  ABOVE_5M: Infinity,
};

const MAX_MATCHES = 5;

function parsePriceRange(priceRange: string | null): number | null {
  if (!priceRange) return null;
  const match = priceRange.match(/([\d,.]+)\s*(k|m)?/i);
  if (!match) return null;

  const numeric = parseFloat(match[1].replace(/,/g, ''));
  if (Number.isNaN(numeric)) return null;

  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') return numeric * 1_000;
  if (suffix === 'm') return numeric * 1_000_000;
  return numeric;
}

interface PriceableVendor {
  priceRange: string | null;
  listings: { basePrice: number }[];
}

/** Shared with the customize endpoint so a manually-selected vendor gets the same price estimate. */
export function estimateVendorBasePrice(vendor: PriceableVendor): number | null {
  const listingPrice = vendor.listings.length
    ? Math.min(...vendor.listings.map((l) => l.basePrice))
    : null;
  return listingPrice ?? parsePriceRange(vendor.priceRange);
}

/**
 * Rule-based stand-in for the spec's "call Claude API to match vendors" step.
 * Same input/output shape as a real AI matcher, so swapping this out for an
 * actual Claude API call later doesn't require changing any caller.
 */
export async function matchVendorsForRequest(input: MatchInput): Promise<VendorMatch[]> {
  const ceiling = BUDGET_CEILING[input.budgetRange] ?? Infinity;
  const categories = input.categories?.length ? (input.categories as VendorCategory[]) : null;

  const vendors = await prisma.vendor.findMany({
    where: {
      status: 'APPROVED',
      ...(categories ? { category: { in: categories } } : {}),
    },
    include: { listings: true },
  });

  const scored = vendors
    .map((vendor) => {
      const estimatedPrice = estimateVendorBasePrice(vendor);

      if (estimatedPrice === null || estimatedPrice > ceiling) return null;

      const locationMatch =
        !!input.location &&
        !!vendor.location &&
        vendor.location.toLowerCase().includes(input.location.toLowerCase());

      return {
        vendorId: vendor.id,
        category: vendor.category,
        businessName: vendor.businessName,
        basePrice: estimatedPrice,
        locationMatch,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // One vendor per category, preferring location match then lowest price.
  const byCategory = new Map<string, (typeof scored)[number]>();
  for (const candidate of scored) {
    const existing = byCategory.get(candidate.category);
    if (!existing) {
      byCategory.set(candidate.category, candidate);
      continue;
    }
    const candidateBetter =
      (candidate.locationMatch && !existing.locationMatch) ||
      (candidate.locationMatch === existing.locationMatch &&
        candidate.basePrice < existing.basePrice);
    if (candidateBetter) byCategory.set(candidate.category, candidate);
  }

  // When the customer explicitly picked categories, try to return one match per category
  // instead of capping at MAX_MATCHES (that cap only exists to keep open-ended matching sane).
  const resultLimit = categories ? categories.length : MAX_MATCHES;

  return Array.from(byCategory.values())
    .sort((a, b) => (a.locationMatch === b.locationMatch ? a.basePrice - b.basePrice : a.locationMatch ? -1 : 1))
    .slice(0, resultLimit)
    .map((v) => ({
      vendorId: v.vendorId,
      category: v.category,
      businessName: v.businessName,
      basePrice: v.basePrice,
      reason: v.locationMatch
        ? 'Approved vendor in your area, within your budget'
        : 'Approved vendor within your budget',
    }));
}
