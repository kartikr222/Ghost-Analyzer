import { describe, expect, it } from 'vitest';
import { analyzeBusiness } from './analyze';
import { defaultControlsFromInputs, simulateCounterfactual } from './counterfactual';
import { computeDerivedMetrics } from './math';
import { EMPTY_BUSINESS_INPUTS, HEALTHY_CONTROL_INPUTS, SAMPLE_BUSINESS_INPUTS } from './presets';
import type { BusinessEvidenceInputs } from './types';

function assertFiniteNumber(value: number | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  expect(Number.isFinite(value), `${label} should be finite, got ${value}`).toBe(true);
}

function walkFinite(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    expect(Number.isFinite(obj), `${path} is not finite: ${obj}`).toBe(true);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkFinite(item, `${path}[${i}]`));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) walkFinite(v, `${path}.${k}`);
  }
}

describe('Ghost Analyzer diagnostic engine', () => {
  it('computes sample-business derived metrics without inventing numbers', () => {
    const d = computeDerivedMetrics(SAMPLE_BUSINESS_INPUTS);
    expect(d.inferredOpportunitiesPerMonth).toBeCloseTo(30.8, 5);
    expect(d.annualOpportunitiesCreated).toBeCloseTo(369.6, 5);
    expect(d.expectedWinsFromOpportunities).toBeCloseTo(85.008, 3);
    expect(d.realizedNewArrFromCustomers).toBe(3_300_000);
    expect(d.annualChurnDollars).toBe(1_320_000);
    expect(d.annualContractionDollars).toBe(600_000);
    expect(d.annualExpansionDollars).toBe(840_000);
    expect(d.netRevenueRetentionPct).toBe(91);
    expect(d.realizedNetArrAddition).toBe(2_220_000);
    expect(d.realizedGrowthPct).toBeCloseTo(18.5, 5);
    expect(d.targetNetNewArr).toBe(3_000_000);
    expect(d.growthTargetShortfallDollars).toBe(780_000);
    expect(d.stalePipelineDollars).toBe(1_800_000);
    expect(d.conversionRealizationGapDeals).toBeCloseTo(30.008, 3);
  });

  it('does not manufacture a Demand Ghost when sample demand can fund the target', () => {
    const result = analyzeBusiness(SAMPLE_BUSINESS_INPUTS);
    const demand = result.ghosts.find((g) => g.id === 'demand_ghost');
    expect(demand).toBeDefined();
    expect(demand?.isHealthy).toBe(true);
    expect(demand?.isActiveGhost).toBe(false);
  });

  it('identifies pipeline, conversion and retention as active on the sample business', () => {
    const result = analyzeBusiness(SAMPLE_BUSINESS_INPUTS);
    expect(result.isSampleData).toBe(true);
    const pipeline = result.ghosts.find((g) => g.id === 'pipeline_ghost');
    const conversion = result.ghosts.find((g) => g.id === 'conversion_ghost');
    const retention = result.ghosts.find((g) => g.id === 'retention_ghost');
    expect(pipeline?.isActiveGhost).toBe(true);
    expect(conversion?.isActiveGhost).toBe(true);
    expect(retention?.isActiveGhost).toBe(true);
    expect(retention?.economicExposure).toBe(1_320_000);
    expect(result.ghostChainLinks.length).toBeGreaterThan(0);
    expect(result.disappearancePoint.nodes.length).toBe(5);
    expect(result.waterfall.length).toBeGreaterThanOrEqual(5);
    expect(result.unknowns.some((u) => u.id === 'age_distribution')).toBe(true);
    expect(result.unknowns.some((u) => u.status === 'CONTRADICTION')).toBe(true);
    walkFinite(result);
  });

  it('keeps healthy control inputs healthy on retention, pricing and demand', () => {
    const result = analyzeBusiness(HEALTHY_CONTROL_INPUTS);
    const retention = result.ghosts.find((g) => g.id === 'retention_ghost');
    const pricing = result.ghosts.find((g) => g.id === 'pricing_ghost');
    const demand = result.ghosts.find((g) => g.id === 'demand_ghost');
    expect(retention?.isHealthy).toBe(true);
    expect(pricing?.isHealthy).toBe(true);
    expect(demand?.isHealthy).toBe(true);
  });

  it('handles empty inputs without NaN or invented exposure', () => {
    const result = analyzeBusiness(EMPTY_BUSINESS_INPUTS);
    walkFinite(result);
    expect(result.verdict.concentrationType).toBe('INSUFFICIENT EVIDENCE');
    expect(result.derivedMetrics.realizedNewArrFromCustomers).toBeNull();
    result.ghosts.forEach((g) => {
      assertFiniteNumber(g.severityScore, g.id);
      assertFiniteNumber(g.confidencePct, `${g.id}.confidence`);
    });
  });

  it('survives extreme edge cases without NaN or Infinity', () => {
    const extremes: BusinessEvidenceInputs[] = [
      { ...SAMPLE_BUSINESS_INPUTS, annualRevenue: 0, pipelineValue: 0, activeCustomers: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, winRatePct: 0, newCustomersPerYear: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, winRatePct: 100 },
      { ...SAMPLE_BUSINESS_INPUTS, annualChurnPct: 0, contractionPct: 0, expansionPct: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, annualChurnPct: 100, expansionPct: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, stalePipelinePct: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, stalePipelinePct: 100 },
      { ...SAMPLE_BUSINESS_INPUTS, discountPct: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, discountPct: 100, averageDealSize: 60_000 },
      { ...SAMPLE_BUSINESS_INPUTS, qualifiedLeadsPerMonth: 0, leadToOpportunityPct: 0 },
      { ...SAMPLE_BUSINESS_INPUTS, pipelineCoverage: 0, pipelineValue: 0 },
    ];
    for (const input of extremes) {
      const result = analyzeBusiness(input);
      walkFinite(result);
      const cf = simulateCounterfactual(input, result, defaultControlsFromInputs(input));
      walkFinite(cf);
    }
  });

  it('does not treat modeled counterfactual as observed', () => {
    const result = analyzeBusiness(SAMPLE_BUSINESS_INPUTS);
    const controls = defaultControlsFromInputs(SAMPLE_BUSINESS_INPUTS);
    controls.winRatePct = 28;
    controls.annualChurnPct = 8;
    const cf = simulateCounterfactual(SAMPLE_BUSINESS_INPUTS, result, controls);
    expect(cf.ifHighestLeverageFixed.narrative).toContain('MODELED SCENARIO');
    expect(cf.leverSensitivityRanking).toHaveLength(7);
    expect(cf.leverSensitivityRanking.every((l) => l.rank >= 1)).toBe(true);
    walkFinite(cf);
  });

  it('labels every ghost with a Why trace', () => {
    const result = analyzeBusiness(SAMPLE_BUSINESS_INPUTS);
    expect(result.ghosts).toHaveLength(12);
    for (const g of result.ghosts) {
      expect(g.why.observed.length).toBeGreaterThan(0);
      expect(g.why.derived.length).toBeGreaterThan(0);
      expect(g.why.whatWouldChangeThis.length).toBeGreaterThan(10);
      expect(['OBSERVED', 'INFERRED', 'MODELED', 'UNVERIFIED']).toContain(g.evidenceState);
    }
  });
});
