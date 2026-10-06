import type { BusinessEvidenceInputs, DiagnosticAnalysisResult } from './types';
import { clampNum, safeDivide, safeNum, safePct } from './formatters';

export type DerivedMetrics = DiagnosticAnalysisResult['derivedMetrics'];

function n(v: number | null | undefined): number | null {
  return safeNum(v);
}

function dollars(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 100) / 100;
}

export function computeDerivedMetrics(inputs: BusinessEvidenceInputs): DerivedMetrics {
  const arr = n(inputs.annualRevenue);
  const growthTarget = n(inputs.growthTargetPct);
  const deal = n(inputs.averageDealSize);
  const newCustomers = n(inputs.newCustomersPerYear);
  const leads = n(inputs.qualifiedLeadsPerMonth);
  const l2o = safePct(inputs.leadToOpportunityPct);
  const enteredOpps = n(inputs.opportunitiesPerMonth);
  const pipeline = n(inputs.pipelineValue);
  const coverage = n(inputs.pipelineCoverage);
  const stale = safePct(inputs.stalePipelinePct);
  const nextStep = safePct(inputs.verifiedNextStepPct);
  const buyer = safePct(inputs.economicBuyerPct);
  const win = safePct(inputs.winRatePct);
  const discount = safePct(inputs.discountPct);
  const churn = safePct(inputs.annualChurnPct);
  const contraction = safePct(inputs.contractionPct);
  const expansion = safePct(inputs.expansionPct);

  const targetEndingArr =
    arr !== null && growthTarget !== null ? arr * (1 + growthTarget / 100) : null;
  const targetNetNewArr =
    arr !== null && targetEndingArr !== null ? targetEndingArr - arr : null;

  const grossRetentionPct = churn !== null ? clampNum(100 - churn, 0, 100) : null;
  const netRevenueRetentionPct =
    churn !== null && contraction !== null && expansion !== null
      ? clampNum(100 - churn - contraction + expansion, 0, 200)
      : churn !== null && expansion !== null
        ? clampNum(100 - churn + expansion, 0, 200)
        : null;

  const annualChurnDollars = dollars(
    arr !== null && churn !== null ? arr * (churn / 100) : null
  );
  const annualContractionDollars = dollars(
    arr !== null && contraction !== null ? arr * (contraction / 100) : null
  );
  const annualExpansionDollars = dollars(
    arr !== null && expansion !== null ? arr * (expansion / 100) : null
  );
  const netRetentionDollars = dollars(
    arr !== null && netRevenueRetentionPct !== null
      ? arr * (netRevenueRetentionPct / 100)
      : null
  );

  const grossNewArrRequiredForTarget =
    targetEndingArr !== null && netRetentionDollars !== null
      ? Math.max(0, targetEndingArr - netRetentionDollars)
      : targetNetNewArr;

  const inferredOpportunitiesPerMonth =
    leads !== null && l2o !== null ? leads * (l2o / 100) : null;
  const effectiveOpportunitiesPerMonth =
    enteredOpps !== null ? enteredOpps : inferredOpportunitiesPerMonth;
  const annualOpportunitiesCreated =
    effectiveOpportunitiesPerMonth !== null ? effectiveOpportunitiesPerMonth * 12 : null;
  const expectedWinsFromOpportunities =
    annualOpportunitiesCreated !== null && win !== null
      ? annualOpportunitiesCreated * (win / 100)
      : null;
  const realizedNewArrFromCustomers = dollars(
    newCustomers !== null && deal !== null ? newCustomers * deal : null
  );
  const conversionRealizationGapDeals =
    expectedWinsFromOpportunities !== null && newCustomers !== null
      ? expectedWinsFromOpportunities - newCustomers
      : null;
  const conversionRealizationGapDollars = dollars(
    conversionRealizationGapDeals !== null && deal !== null
      ? conversionRealizationGapDeals * deal
      : null
  );

  const impliedListDealSize =
    deal !== null && discount !== null && discount < 100
      ? deal / (1 - discount / 100)
      : deal !== null && (discount === null || discount === 0)
        ? deal
        : null;
  const annualDiscountLeakageDollars =
    impliedListDealSize !== null && deal !== null && newCustomers !== null
      ? Math.max(0, newCustomers * (impliedListDealSize - deal))
      : impliedListDealSize !== null && deal !== null && expectedWinsFromOpportunities !== null
        ? Math.max(0, expectedWinsFromOpportunities * (impliedListDealSize - deal))
        : null;

  const stalePipelineDollars = dollars(
    pipeline !== null && stale !== null ? pipeline * (stale / 100) : null
  );
  const unverifiedNextStepDollars = dollars(
    pipeline !== null && nextStep !== null ? pipeline * (1 - nextStep / 100) : null
  );
  const missingEconomicBuyerDollars = dollars(
    pipeline !== null && buyer !== null ? pipeline * (1 - buyer / 100) : null
  );

  const credibilityHaircut =
    nextStep === null && buyer === null
      ? null
      : clampNum(
          1 -
            0.5 * (1 - (nextStep ?? 100) / 100) -
            0.35 * (1 - (buyer ?? 100) / 100),
          0.12,
          1
        );
  const nonStalePipeline =
    pipeline !== null ? pipeline * (1 - (stale ?? 0) / 100) : null;
  const crediblePipelineDollars = dollars(
    nonStalePipeline !== null && credibilityHaircut !== null
      ? nonStalePipeline * credibilityHaircut
      : nonStalePipeline
  );
  const crediblePipelineRatio =
    pipeline !== null && pipeline > 0 && crediblePipelineDollars !== null
      ? crediblePipelineDollars / pipeline
      : null;

  const impliedQuotaFromCoverage =
    pipeline !== null && coverage !== null && coverage > 0 ? pipeline / coverage : null;
  const headlineCoverage =
    coverage !== null
      ? coverage
      : arr !== null && arr > 0 && pipeline !== null
        ? pipeline / arr
        : null;
  const credibleCoverage =
    coverage !== null && crediblePipelineRatio !== null
      ? coverage * crediblePipelineRatio
      : arr !== null && arr > 0 && crediblePipelineDollars !== null
        ? crediblePipelineDollars / arr
        : impliedQuotaFromCoverage !== null &&
            impliedQuotaFromCoverage > 0 &&
            crediblePipelineDollars !== null
          ? crediblePipelineDollars / impliedQuotaFromCoverage
          : null;

  const realizedNetArrAddition = dollars(
    realizedNewArrFromCustomers !== null ||
      annualExpansionDollars !== null ||
      annualChurnDollars !== null
      ? (realizedNewArrFromCustomers ?? 0) +
        (annualExpansionDollars ?? 0) -
        (annualChurnDollars ?? 0) -
        (annualContractionDollars ?? 0)
      : null
  );
  const realizedGrowthPct = safeDivide(realizedNetArrAddition, arr);
  const realizedGrowthPctPoints =
    realizedGrowthPct !== null ? realizedGrowthPct * 100 : null;
  const growthTargetShortfallDollars =
    targetNetNewArr !== null && realizedNetArrAddition !== null
      ? targetNetNewArr - realizedNetArrAddition
      : null;

  return {
    targetNetNewArr,
    targetEndingArr,
    grossRetentionPct,
    netRevenueRetentionPct,
    annualChurnDollars,
    annualContractionDollars,
    annualExpansionDollars,
    netRetentionDollars,
    grossNewArrRequiredForTarget,
    inferredOpportunitiesPerMonth,
    effectiveOpportunitiesPerMonth,
    annualOpportunitiesCreated,
    expectedWinsFromOpportunities,
    realizedNewArrFromCustomers,
    conversionRealizationGapDeals,
    conversionRealizationGapDollars,
    impliedListDealSize,
    annualDiscountLeakageDollars,
    stalePipelineDollars,
    unverifiedNextStepDollars,
    missingEconomicBuyerDollars,
    crediblePipelineDollars,
    crediblePipelineRatio,
    impliedQuotaFromCoverage,
    headlineCoverage,
    credibleCoverage,
    realizedNetArrAddition,
    realizedGrowthPct: realizedGrowthPctPoints,
    growthTargetShortfallDollars,
  };
}

export function countProvidedFields(inputs: BusinessEvidenceInputs): {
  observed: number;
  total: number;
  completenessPct: number;
} {
  const numericKeys: (keyof BusinessEvidenceInputs)[] = [
    'annualRevenue',
    'growthTargetPct',
    'averageDealSize',
    'activeCustomers',
    'newCustomersPerYear',
    'qualifiedLeadsPerMonth',
    'leadToOpportunityPct',
    'opportunitiesPerMonth',
    'pipelineValue',
    'pipelineCoverage',
    'avgOpportunityAgeDays',
    'stalePipelinePct',
    'verifiedNextStepPct',
    'economicBuyerPct',
    'winRatePct',
    'salesCycleDays',
    'noDecisionPct',
    'discountPct',
    'annualChurnPct',
    'contractionPct',
    'expansionPct',
    'forecastAccuracyPct',
    'crmConfidencePct',
  ];
  let observed = 0;
  for (const key of numericKeys) {
    const val = inputs[key];
    if (typeof val === 'number' && Number.isFinite(val)) observed += 1;
  }
  if (inputs.reviewFrequency !== 'ad_hoc') observed += 1;
  if (inputs.leadershipConfidence !== 'unverified') observed += 1;
  const total = numericKeys.length + 2;
  return {
    observed,
    total,
    completenessPct: clampNum((observed / total) * 100, 0, 100),
  };
}

export function severityFromScore(score: number): 'critical' | 'material' | 'watch' | 'healthy' {
  if (score >= 55) return 'critical';
  if (score >= 32) return 'material';
  if (score >= 14) return 'watch';
  return 'healthy';
}

export function confidenceFromEvidence(
  providedSignals: number,
  relevantSignals: number,
  contradictionPenalty = 0
): number {
  if (relevantSignals <= 0) return 0;
  const base = (providedSignals / relevantSignals) * 100;
  return clampNum(base - contradictionPenalty, 8, 96);
}
