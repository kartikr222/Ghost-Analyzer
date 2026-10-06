import type { BusinessEvidenceInputs } from './types';

/**
 * OFFICIAL SAMPLE BUSINESS — DEMONSTRATION DATA (Section 9)
 * Matches the exact specification required by the directive.
 */
export const SAMPLE_BUSINESS_INPUTS: BusinessEvidenceInputs = {
  annualRevenue: 12_000_000,
  growthTargetPct: 25,
  averageDealSize: 60_000,
  activeCustomers: 140,
  newCustomersPerYear: 55,

  qualifiedLeadsPerMonth: 140,
  leadToOpportunityPct: 22,
  opportunitiesPerMonth: null, // Inferred deterministically: 140 * 22% = 30.8 / month

  pipelineValue: 7_500_000,
  pipelineCoverage: 3.0,
  avgOpportunityAgeDays: null, // Intentionally unverified in sample to demonstrate Evidence Gaps
  stalePipelinePct: 24,
  verifiedNextStepPct: 68,
  economicBuyerPct: 62,

  winRatePct: 23,
  salesCycleDays: 108,
  noDecisionPct: 18,
  discountPct: 12,

  annualChurnPct: 11,
  contractionPct: 5,
  expansionPct: 7,

  forecastAccuracyPct: 72,
  crmConfidencePct: 68,
  reviewFrequency: 'biweekly',
  leadershipConfidence: 'moderate',
};

export const EMPTY_BUSINESS_INPUTS: BusinessEvidenceInputs = {
  annualRevenue: null,
  growthTargetPct: null,
  averageDealSize: null,
  activeCustomers: null,
  newCustomersPerYear: null,

  qualifiedLeadsPerMonth: null,
  leadToOpportunityPct: null,
  opportunitiesPerMonth: null,

  pipelineValue: null,
  pipelineCoverage: null,
  avgOpportunityAgeDays: null,
  stalePipelinePct: null,
  verifiedNextStepPct: null,
  economicBuyerPct: null,

  winRatePct: null,
  salesCycleDays: null,
  noDecisionPct: null,
  discountPct: null,

  annualChurnPct: null,
  contractionPct: null,
  expansionPct: null,

  forecastAccuracyPct: null,
  crmConfidencePct: null,
  reviewFrequency: 'monthly',
  leadershipConfidence: 'unverified',
};

export const HEALTHY_CONTROL_INPUTS: BusinessEvidenceInputs = {
  annualRevenue: 15_000_000,
  growthTargetPct: 20,
  averageDealSize: 50_000,
  activeCustomers: 300,
  newCustomersPerYear: 65,

  qualifiedLeadsPerMonth: 120,
  leadToOpportunityPct: 25,
  opportunitiesPerMonth: 30,

  pipelineValue: 10_500_000,
  pipelineCoverage: 3.5,
  avgOpportunityAgeDays: 42,
  stalePipelinePct: 7,
  verifiedNextStepPct: 89,
  economicBuyerPct: 86,

  winRatePct: 31,
  salesCycleDays: 68,
  noDecisionPct: 9,
  discountPct: 6,

  annualChurnPct: 4,
  contractionPct: 2,
  expansionPct: 14,

  forecastAccuracyPct: 91,
  crmConfidencePct: 90,
  reviewFrequency: 'weekly',
  leadershipConfidence: 'high',
};

export function isMatchingSampleBusiness(inputs: BusinessEvidenceInputs): boolean {
  return (
    inputs.annualRevenue === SAMPLE_BUSINESS_INPUTS.annualRevenue &&
    inputs.growthTargetPct === SAMPLE_BUSINESS_INPUTS.growthTargetPct &&
    inputs.averageDealSize === SAMPLE_BUSINESS_INPUTS.averageDealSize &&
    inputs.activeCustomers === SAMPLE_BUSINESS_INPUTS.activeCustomers &&
    inputs.newCustomersPerYear === SAMPLE_BUSINESS_INPUTS.newCustomersPerYear &&
    inputs.qualifiedLeadsPerMonth === SAMPLE_BUSINESS_INPUTS.qualifiedLeadsPerMonth &&
    inputs.leadToOpportunityPct === SAMPLE_BUSINESS_INPUTS.leadToOpportunityPct &&
    inputs.pipelineValue === SAMPLE_BUSINESS_INPUTS.pipelineValue &&
    inputs.pipelineCoverage === SAMPLE_BUSINESS_INPUTS.pipelineCoverage &&
    inputs.stalePipelinePct === SAMPLE_BUSINESS_INPUTS.stalePipelinePct &&
    inputs.economicBuyerPct === SAMPLE_BUSINESS_INPUTS.economicBuyerPct &&
    inputs.verifiedNextStepPct === SAMPLE_BUSINESS_INPUTS.verifiedNextStepPct &&
    inputs.winRatePct === SAMPLE_BUSINESS_INPUTS.winRatePct &&
    inputs.salesCycleDays === SAMPLE_BUSINESS_INPUTS.salesCycleDays &&
    inputs.noDecisionPct === SAMPLE_BUSINESS_INPUTS.noDecisionPct &&
    inputs.discountPct === SAMPLE_BUSINESS_INPUTS.discountPct &&
    inputs.annualChurnPct === SAMPLE_BUSINESS_INPUTS.annualChurnPct &&
    inputs.contractionPct === SAMPLE_BUSINESS_INPUTS.contractionPct &&
    inputs.expansionPct === SAMPLE_BUSINESS_INPUTS.expansionPct &&
    inputs.forecastAccuracyPct === SAMPLE_BUSINESS_INPUTS.forecastAccuracyPct &&
    inputs.crmConfidencePct === SAMPLE_BUSINESS_INPUTS.crmConfidencePct
  );
}
