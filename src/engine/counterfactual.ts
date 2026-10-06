import type {
  BusinessEvidenceInputs,
  CounterfactualControls,
  CounterfactualResult,
  DiagnosticAnalysisResult,
  LeverSensitivityItem,
  SecondOrderEffect,
} from './types';
import { clampNum, safeNum } from './formatters';
import { computeDerivedMetrics } from './math';

export function defaultControlsFromInputs(inputs: BusinessEvidenceInputs): CounterfactualControls {
  return {
    winRatePct: inputs.winRatePct ?? 25,
    stalePipelinePct: inputs.stalePipelinePct ?? 15,
    salesCycleDays: inputs.salesCycleDays ?? 90,
    annualChurnPct: inputs.annualChurnPct ?? 8,
    discountPct: inputs.discountPct ?? 10,
    expansionPct: inputs.expansionPct ?? 6,
    forecastAccuracyPct: inputs.forecastAccuracyPct ?? 80,
  };
}

function finite(v: number | null | undefined, fallback = 0): number {
  const n = safeNum(v);
  return n === null ? fallback : n;
}

function modeledNewArr(
  inputs: BusinessEvidenceInputs,
  analysis: DiagnosticAnalysisResult,
  winRatePct: number,
  discountPct: number,
  cycleDays: number
): { newArr: number | null; dealSize: number | null; velocityMultiplier: number } {
  const baselineCycle = inputs.salesCycleDays;
  const baselineDiscount = inputs.discountPct;
  const deal = inputs.averageDealSize;
  const opps = analysis.derivedMetrics.annualOpportunitiesCreated;
  const observedNew = inputs.newCustomersPerYear;
  const expectedWins = analysis.derivedMetrics.expectedWinsFromOpportunities;

  const realization =
    observedNew !== null && expectedWins !== null && expectedWins > 0
      ? clampNum(observedNew / expectedWins, 0.35, 1.25)
      : 1;

  const modeledDeal =
    deal !== null && baselineDiscount !== null && baselineDiscount < 100
      ? deal * ((1 - discountPct / 100) / (1 - baselineDiscount / 100))
      : deal;

  const velocityMultiplier =
    baselineCycle !== null && baselineCycle > 0 && cycleDays > 0
      ? clampNum(baselineCycle / cycleDays, 0.7, 1.45)
      : 1;

  if (opps === null || winRatePct < 0 || modeledDeal === null) {
    return { newArr: null, dealSize: modeledDeal, velocityMultiplier };
  }
  const modeledWins = opps * (winRatePct / 100) * realization * velocityMultiplier;
  return { newArr: modeledWins * modeledDeal, dealSize: modeledDeal, velocityMultiplier };
}

function modeledRetention(arr: number | null, churn: number, expansion: number, contraction: number | null): number | null {
  if (arr === null) return null;
  const nrr = clampNum(100 - churn - (contraction ?? 0) + expansion, 0, 200);
  return arr * (nrr / 100);
}

function crediblePipelineFromStale(
  inputs: BusinessEvidenceInputs,
  stalePct: number
): number | null {
  const pipeline = inputs.pipelineValue;
  if (pipeline === null) return null;
  const next = inputs.verifiedNextStepPct;
  const buyer = inputs.economicBuyerPct;
  const haircut = clampNum(
    1 - 0.5 * (1 - (next ?? 100) / 100) - 0.35 * (1 - (buyer ?? 100) / 100),
    0.12,
    1
  );
  const nonStale = pipeline * (1 - clampNum(stalePct, 0, 100) / 100);
  return nonStale * haircut;
}

function runOnce(
  inputs: BusinessEvidenceInputs,
  analysis: DiagnosticAnalysisResult,
  controls: CounterfactualControls
): {
  newArr: number | null;
  retention: number | null;
  ending: number | null;
  credible: number | null;
  dealSize: number | null;
  velocityMultiplier: number;
} {
  const arr = inputs.annualRevenue;
  const { newArr, dealSize, velocityMultiplier } = modeledNewArr(
    inputs,
    analysis,
    controls.winRatePct,
    controls.discountPct,
    controls.salesCycleDays
  );
  const retention = modeledRetention(arr, controls.annualChurnPct, controls.expansionPct, inputs.contractionPct);
  const ending = retention !== null && newArr !== null ? retention + newArr : null;
  const credible = crediblePipelineFromStale(inputs, controls.stalePipelinePct);
  return { newArr, retention, ending, credible, dealSize, velocityMultiplier };
}

function year2(endingY1: number | null, controls: CounterfactualControls, contraction: number | null, newArr: number | null): number | null {
  if (endingY1 === null || newArr === null) return null;
  const nrr = clampNum(100 - controls.annualChurnPct - (contraction ?? 0) + controls.expansionPct, 0, 200);
  return endingY1 * (nrr / 100) + newArr;
}

export function simulateCounterfactual(
  inputs: BusinessEvidenceInputs,
  analysis: DiagnosticAnalysisResult,
  controls: CounterfactualControls
): CounterfactualResult {
  const baseline = defaultControlsFromInputs(inputs);
  const current = runOnce(inputs, analysis, baseline);
  const modeled = runOnce(inputs, analysis, controls);

  const arr = inputs.annualRevenue;
  const target = inputs.growthTargetPct;
  const contraction = inputs.contractionPct;

  const y1Current = current.ending;
  const y2Current = year2(y1Current, baseline, contraction, current.newArr);

  const targetY1 = arr !== null && target !== null ? arr * (1 + target / 100) : null;
  const targetY2 = targetY1 !== null && target !== null ? targetY1 * (1 + target / 100) : null;
  const gap24 =
    targetY1 !== null && targetY2 !== null && y1Current !== null && y2Current !== null
      ? targetY1 - y1Current + (targetY2 - y2Current)
      : null;
  const retentionErosion24 =
    arr !== null
      ? Math.max(0, arr - finite(current.retention)) +
        (y1Current !== null ? Math.max(0, y1Current - finite(year2(y1Current, { ...baseline, expansionPct: 0, annualChurnPct: 0 }, 0, 0))) : 0)
      : null;

  const discountRecovery =
    current.dealSize !== null && modeled.dealSize !== null && inputs.newCustomersPerYear !== null
      ? (modeled.dealSize - current.dealSize) * inputs.newCustomersPerYear
      : null;

  const forecastErrorReductionPct = clampNum(
    controls.forecastAccuracyPct - baseline.forecastAccuracyPct,
    -100,
    100
  );

  const secondOrderEffects: SecondOrderEffect[] = [];
  if (controls.stalePipelinePct < baseline.stalePipelinePct - 0.4) {
    secondOrderEffects.push({
      id: 'stale-to-credible',
      triggerLever: 'Stale pipeline',
      affectedDimension: 'Credible pipeline',
      currentValueLabel: current.credible !== null ? `$${Math.round(current.credible).toLocaleString('en-US')}` : 'UNVERIFIED',
      modeledValueLabel: modeled.credible !== null ? `$${Math.round(modeled.credible).toLocaleString('en-US')}` : 'UNVERIFIED',
      deltaLabel:
        current.credible !== null && modeled.credible !== null
          ? `${modeled.credible - current.credible >= 0 ? '+' : ''}$${Math.round(modeled.credible - current.credible).toLocaleString('en-US')}`
          : 'UNVERIFIED',
      mathematicalBasis: 'Credible pipeline = non-stale pipeline × next-step/buyer haircut. Reducing stale increases the non-stale stock directly.',
    });
    const impliedForecast = clampNum(baseline.forecastAccuracyPct + (baseline.stalePipelinePct - controls.stalePipelinePct) * 0.25, 0, 99);
    secondOrderEffects.push({
      id: 'stale-to-forecast',
      triggerLever: 'Stale pipeline',
      affectedDimension: 'Inspectable forecast confidence',
      currentValueLabel: `${baseline.forecastAccuracyPct.toFixed(0)}% accuracy (stated)`,
      modeledValueLabel: `+${(impliedForecast - baseline.forecastAccuracyPct).toFixed(1)} pts modeled inspectability`,
      deltaLabel: 'MODELED second-order — not a forecast',
      mathematicalBasis: 'Each point of stale reduction is treated as 0.25 points of forecast inspectability. This is a modeled relationship, not an observed elasticity.',
    });
  }
  if (controls.salesCycleDays < baseline.salesCycleDays - 1) {
    secondOrderEffects.push({
      id: 'cycle-to-capacity',
      triggerLever: 'Sales cycle',
      affectedDimension: 'Annual conversion capacity',
      currentValueLabel: `×1.00 at ${baseline.salesCycleDays} days`,
      modeledValueLabel: `×${modeled.velocityMultiplier.toFixed(2)} at ${controls.salesCycleDays} days`,
      deltaLabel: `Capacity multiplier ${modeled.velocityMultiplier.toFixed(2)} (capped 1.45×)`,
      mathematicalBasis: 'Throughput multiplier = currentCycle / newCycle, clamped to 0.70–1.45 so cycle cuts cannot invent unbounded revenue.',
    });
  }
  if (controls.annualChurnPct < baseline.annualChurnPct - 0.2) {
    secondOrderEffects.push({
      id: 'churn-to-required-new',
      triggerLever: 'Annual churn',
      affectedDimension: 'New ARR required to hit target',
      currentValueLabel: analysis.derivedMetrics.grossNewArrRequiredForTarget !== null
        ? `$${Math.round(analysis.derivedMetrics.grossNewArrRequiredForTarget).toLocaleString('en-US')}`
        : 'UNVERIFIED',
      modeledValueLabel: 'Required new ARR falls as NRR rises',
      deltaLabel: 'Replacement burden declines',
      mathematicalBasis: 'grossNewARR required = targetEndingARR − (currentARR × NRR). Lower churn raises NRR and reduces the new-logo burden.',
    });
  }

  const unitShocks: Array<{ leverId: LeverSensitivityItem['leverId']; label: string; unit: string; shocked: CounterfactualControls }> = [
    { leverId: 'winRatePct', label: 'Win rate', unit: '+1 percentage point', shocked: { ...baseline, winRatePct: baseline.winRatePct + 1 } },
    { leverId: 'stalePipelinePct', label: 'Stale pipeline', unit: '−1 percentage point', shocked: { ...baseline, stalePipelinePct: Math.max(0, baseline.stalePipelinePct - 1) } },
    { leverId: 'salesCycleDays', label: 'Sales cycle', unit: '−7 days', shocked: { ...baseline, salesCycleDays: Math.max(14, baseline.salesCycleDays - 7) } },
    { leverId: 'annualChurnPct', label: 'Annual churn', unit: '−1 percentage point', shocked: { ...baseline, annualChurnPct: Math.max(0, baseline.annualChurnPct - 1) } },
    { leverId: 'discountPct', label: 'Discount', unit: '−1 percentage point', shocked: { ...baseline, discountPct: Math.max(0, baseline.discountPct - 1) } },
    { leverId: 'expansionPct', label: 'Expansion', unit: '+1 percentage point', shocked: { ...baseline, expansionPct: baseline.expansionPct + 1 } },
    { leverId: 'forecastAccuracyPct', label: 'Forecast accuracy', unit: '+1 percentage point', shocked: { ...baseline, forecastAccuracyPct: Math.min(100, baseline.forecastAccuracyPct + 1) } },
  ];

  const leverSensitivityRanking: LeverSensitivityItem[] = unitShocks
    .map((shock) => {
      const run = runOnce(inputs, analysis, shock.shocked);
      const delta =
        run.ending !== null && current.ending !== null ? run.ending - current.ending : 0;
      const rationale =
        shock.leverId === 'forecastAccuracyPct'
          ? 'Forecast accuracy does not change ARR in this model. It changes trust, not cash. Ranked last by design.'
          : shock.leverId === 'stalePipelinePct'
            ? 'Stale reduction improves credible pipeline stock; ARR impact is second-order via conversion capacity and is not fully dollarized here.'
            : 'Year-1 modeled ending ARR versus current-state ending ARR after a one-unit improvement.';
      return {
        leverId: shock.leverId,
        label: shock.label,
        unitImprovementLabel: shock.unit,
        modeledAnnualImpact: shock.leverId === 'forecastAccuracyPct' ? 0 : delta,
        rank: 0,
        rationale,
      };
    })
    .sort((a, b) => b.modeledAnnualImpact - a.modeledAnnualImpact)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  const dominant = analysis.dominantGhost;
  const highestFix = { ...baseline };
  let leverChangedSummary = 'No dominant Ghost is evidenced, so no single-lever fix is applied.';
  if (dominant) {
    switch (dominant.id) {
      case 'conversion_ghost':
      case 'qualification_ghost':
        highestFix.winRatePct = clampNum(baseline.winRatePct + 5, 0, 80);
        leverChangedSummary = `Win rate ${baseline.winRatePct.toFixed(0)}% → ${highestFix.winRatePct.toFixed(0)}% (MODELED, +5 pts).`;
        break;
      case 'pipeline_ghost':
      case 'execution_ghost':
        highestFix.stalePipelinePct = clampNum(baseline.stalePipelinePct - 10, 0, 100);
        leverChangedSummary = `Stale pipeline ${baseline.stalePipelinePct.toFixed(0)}% → ${highestFix.stalePipelinePct.toFixed(0)}% (MODELED, −10 pts).`;
        break;
      case 'velocity_ghost':
        highestFix.salesCycleDays = Math.round(clampNum(baseline.salesCycleDays * 0.85, 14, 400));
        leverChangedSummary = `Sales cycle ${baseline.salesCycleDays} → ${highestFix.salesCycleDays} days (MODELED, −15%).`;
        break;
      case 'retention_ghost':
        highestFix.annualChurnPct = clampNum(baseline.annualChurnPct - 3, 0, 100);
        leverChangedSummary = `Annual churn ${baseline.annualChurnPct.toFixed(0)}% → ${highestFix.annualChurnPct.toFixed(0)}% (MODELED, −3 pts).`;
        break;
      case 'expansion_ghost':
        highestFix.expansionPct = baseline.expansionPct + 3;
        leverChangedSummary = `Expansion ${baseline.expansionPct.toFixed(0)}% → ${highestFix.expansionPct.toFixed(0)}% (MODELED, +3 pts).`;
        break;
      case 'pricing_ghost':
        highestFix.discountPct = clampNum(baseline.discountPct - 4, 0, 100);
        leverChangedSummary = `Discount ${baseline.discountPct.toFixed(0)}% → ${highestFix.discountPct.toFixed(0)}% (MODELED, −4 pts).`;
        break;
      case 'forecast_ghost':
      case 'measurement_ghost':
      case 'attention_ghost':
        highestFix.forecastAccuracyPct = clampNum(baseline.forecastAccuracyPct + 8, 0, 99);
        leverChangedSummary = `Forecast accuracy ${baseline.forecastAccuracyPct.toFixed(0)}% → ${highestFix.forecastAccuracyPct.toFixed(0)}% (MODELED, +8 pts). This changes trust, not ARR.`;
        break;
      case 'demand_ghost':
        highestFix.winRatePct = clampNum(baseline.winRatePct + 3, 0, 80);
        leverChangedSummary = `Demand is the heaviest Ghost; the model does not invent leads. Win rate ${baseline.winRatePct.toFixed(0)}% → ${highestFix.winRatePct.toFixed(0)}% is applied as a conversion-side proxy only.`;
        break;
      default:
        break;
    }
  }
  const fixedRun = runOnce(inputs, analysis, highestFix);
  const fixedY1 = fixedRun.ending;
  const fixedY2 = year2(fixedY1, highestFix, contraction, fixedRun.newArr);

  const nothingNarrative = [
    y1Current !== null ? `If current rates persist, modeled ending ARR in 12 months is $${Math.round(y1Current).toLocaleString('en-US')}.` : 'Ending ARR cannot be modeled from the evidence entered.',
    targetY1 !== null && y1Current !== null
      ? `The growth target implies $${Math.round(targetY1).toLocaleString('en-US')}. Gap: $${Math.round(targetY1 - y1Current).toLocaleString('en-US')}.`
      : '',
    y2Current !== null ? `Compounded a second year at the same rates: $${Math.round(y2Current).toLocaleString('en-US')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const fixNarrative = [
    `MODELED SCENARIO — NOT A FORECAST. ${leverChangedSummary}`,
    fixedY1 !== null ? `Year-1 modeled ending ARR: $${Math.round(fixedY1).toLocaleString('en-US')}.` : '',
    y1Current !== null && fixedY1 !== null
      ? `Modeled difference versus current state: ${fixedY1 - y1Current >= 0 ? '+' : ''}$${Math.round(fixedY1 - y1Current).toLocaleString('en-US')}.`
      : '',
    'This is the arithmetic of one lever. Ghosts that sit downstream will still absorb part of the gain.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    controls,
    baselineControls: baseline,
    currentRealizedNewRevenue: current.newArr,
    modeledRealizedNewRevenue: modeled.newArr,
    currentNetRetentionDollars: current.retention,
    modeledNetRetentionDollars: modeled.retention,
    currentEndingArr: current.ending,
    modeledEndingArr: modeled.ending,
    modeledArrDelta:
      current.ending !== null && modeled.ending !== null ? modeled.ending - current.ending : null,
    currentCrediblePipeline: current.credible,
    modeledCrediblePipeline: modeled.credible,
    crediblePipelineDelta:
      current.credible !== null && modeled.credible !== null ? modeled.credible - current.credible : null,
    currentEffectiveDealSize: current.dealSize,
    modeledEffectiveDealSize: modeled.dealSize,
    discountRecoveryDollars: discountRecovery,
    velocityCapacityMultiplier: modeled.velocityMultiplier,
    forecastErrorReductionPct,
    secondOrderEffects,
    leverSensitivityRanking,
    ifNothingChanges: {
      year1EndingArr: y1Current,
      year2EndingArr: y2Current,
      cumulativeTargetGap24Mo: gap24,
      cumulativeRetentionErosion24Mo: retentionErosion24,
      unresolvedPipelineDecay: current.credible !== null && inputs.pipelineValue !== null ? inputs.pipelineValue - current.credible : null,
      narrative: nothingNarrative,
    },
    ifHighestLeverageFixed: {
      highestLeverageGhostName: dominant?.name ?? 'None identified',
      leverChangedSummary,
      year1EndingArr: fixedY1,
      year2EndingArr: fixedY2,
      year1RecoveredDelta:
        y1Current !== null && fixedY1 !== null ? fixedY1 - y1Current : null,
      year2RecoveredDelta:
        y2Current !== null && fixedY2 !== null ? fixedY2 - y2Current : null,
      narrative: fixNarrative,
    },
  };
}

export function emptyControls(): CounterfactualControls {
  return {
    winRatePct: 0,
    stalePipelinePct: 0,
    salesCycleDays: 90,
    annualChurnPct: 0,
    discountPct: 0,
    expansionPct: 0,
    forecastAccuracyPct: 0,
  };
}

export { computeDerivedMetrics };
