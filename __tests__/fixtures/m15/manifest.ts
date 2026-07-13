import { join } from "node:path";

/** Directory for M1.5 Phase 2 HTML fixtures (listing + detail pages). */
export const M15_FIXTURE_DIR = join(__dirname);

/** Minimum fixtures before CENTCOM/UKMTO parser work (Step 0). */
export const M15_REQUIRED_FIXTURES = [
  "centcom-press-releases-listing.html",
  "centcom-press-release-4015365.html",
  "ukmto-products-listing.html",
  "ukmto-advisory-003-26-update-002.html",
] as const;

/** Recommended extras — second release shape + warning (not advisory) product type. */
export const M15_OPTIONAL_FIXTURES = [
  "centcom-press-release-4538814.html",
  "ukmto-warning-038-26-attack.html",
] as const;

export type M15FixtureName =
  | (typeof M15_REQUIRED_FIXTURES)[number]
  | (typeof M15_OPTIONAL_FIXTURES)[number];

export const M15_ALL_FIXTURES: readonly M15FixtureName[] = [
  ...M15_REQUIRED_FIXTURES,
  ...M15_OPTIONAL_FIXTURES,
];
