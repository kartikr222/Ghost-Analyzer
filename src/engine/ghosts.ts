import type {
  BusinessEvidenceInputs,
  EvidenceState,
  GhostDiagnosis,
  GhostId,
  GhostSeverityLevel,
  WhyTrace,
} from './types';
import { clampNum, formatCount, formatCurrency, formatPct } from './formatters';
import {
  confidenceFromEvidence,
  severityFromScore,
  type DerivedMetrics,
} from './math';

function money(v: number | null): string {
  return formatCurrency(v, { compact: true });
}

function why(partial: Omit<WhyTrace, 'id'> & { id?: string }, id: string): WhyTrace {
  return { ...partial, id };
}

function stateFrom(signals: number, needed: number, inferred: boolean): EvidenceState {
  if (signals === 0) return 'UNVERIFIED';
  if (inferred && signals < needed) return 'INFERRED';
  if (signals >= needed) return 'OBSERVED';
  return 'INFERRED';
}

function evidenceLabel(pct: number): WhyTrace['evidenceStrength'] {
  if (pct >= 80) return 'HIGH';
  if (pct >= 58) return 'MODERATE';
  if (pct >= 32) return 'LIMITED';
  return 'INSUFFICIENT';
}

function pack(args: {
  id: GhostId;
  name: string;
  stage: GhostDiagnosis['stage'];
  stageLabel: string;
  score: number;
  exposure: number | null;
  confidence: number;
  evidenceState: EvidenceState;
  supportingSignal: string;
  patternSummary: string;
  mechanism: string;
  upstream: GhostId[];
  downstream: GhostId[];
  why: WhyTrace;
}): GhostDiagnosis {
  const level: GhostSeverityLevel =
    args.evidenceState === 'UNVERIFIED' && args.score < 14
      ? 'unverified'
      : severityFromScore(args.score);
  const isHealthy = level === 'healthy';
  return {
    id: args.id,
    name: args.name,
    stage: args.stage,
    stageLabel: args.stageLabel,
    severityScore: clampNum(args.score, 0, 100),
    severityLevel: level,
    isHealthy,
    isActiveGhost: !isHealthy && level !== 'unverified',
    economicExposure: args.exposure,
    confidencePct: clampNum(args.confidence, 0, 96),
    evidenceState: args.evidenceState,
    supportingSignal: args.supportingSignal,
    patternSummary: args.patternSummary,
    mechanism: args.mechanism,
    upstreamGhostIds: args.upstream,
    downstreamGhostIds: args.downstream,
    why: args.why,
  };
}

export function diagnoseGhosts(
  inputs: BusinessEvidenceInputs,
  d: DerivedMetrics
): GhostDiagnosis[] {
  const ghosts: GhostDiagnosis[] = [];

  // ——— DEMAND ————————————————————————————————————————————————
  {
    const haveLeads = inputs.qualifiedLeadsPerMonth !== null;
    const haveL2o = inputs.leadToOpportunityPct !== null;
    const haveWin = inputs.winRatePct !== null;
    const haveDeal = inputs.averageDealSize !== null;
    const required = d.grossNewArrRequiredForTarget;
    const generatedOpps = d.annualOpportunitiesCreated;
    const supplied = [haveLeads, haveL2o, haveWin, haveDeal, required !== null].filter(Boolean).length;
    const demandCapacity =
      generatedOpps !== null && haveWin && haveDeal
        ? generatedOpps * ((inputs.winRatePct ?? 0) / 100) * (inputs.averageDealSize ?? 0)
        : null;
    const coverage = required !== null && required > 0 && demandCapacity !== null
      ? demandCapacity / required
      : generatedOpps !== null && required === null
        ? 1
        : null;
    let score = 0;
    let signal = 'Demand volume cannot be judged without leads, conversion and target.';
    let pattern = 'Insufficient evidence to determine whether demand can fund the commercial target.';
    if (coverage !== null) {
      if (coverage >= 1.2) {
        score = 4;
        signal = `Demand can theoretically fund ${formatPct(coverage * 100, 0)} of required new ARR at the stated win rate.`;
        pattern = 'Lead volume is not the constraint. The system has enough qualified demand to support the target if downstream conversion holds.';
      } else if (coverage >= 0.95) {
        score = 16;
        signal = `Demand covers only ${formatPct(coverage * 100, 0)} of required new ARR — no surplus.`;
        pattern = 'Demand is tight against the growth target. Any downstream leakage becomes immediately material.';
      } else if (coverage >= 0.7) {
        score = 38;
        signal = `Demand funds ${formatPct(coverage * 100, 0)} of required new ARR.`;
        pattern = 'Qualified demand is thinner than the growth target requires. The shortfall will appear as missed new logos even if conversion is perfect.';
      } else {
        score = 68;
        signal = `Demand funds only ${formatPct(coverage * 100, 0)} of required new ARR.`;
        pattern = 'The commercial target is not supported by current qualified demand. Growth is being asked of a funnel that cannot produce it.';
      }
    }
    const exposure =
      required !== null && demandCapacity !== null ? Math.max(0, required - demandCapacity) : null;
    const conf = confidenceFromEvidence(supplied, 5);
    ghosts.push(
      pack({
        id: 'demand_ghost',
        name: 'Demand Ghost',
        stage: 'demand',
        stageLabel: 'Demand',
        score,
        exposure: exposure !== null && exposure > 0 ? exposure : 0,
        confidence: conf,
        evidenceState: stateFrom(supplied, 4, !haveLeads),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Top-of-funnel qualified-lead volume versus the new ARR the growth target actually requires after retention.',
        upstream: [],
        downstream: ['qualification_ghost', 'pipeline_ghost'],
        why: why(
          {
            title: 'Demand Ghost',
            subtitle: 'Can current qualified demand fund the growth target?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 4, true),
            observed: [
              haveLeads ? `Qualified leads / month: ${formatCount(inputs.qualifiedLeadsPerMonth)}` : 'Qualified leads: not entered',
              haveL2o ? `Lead → opportunity: ${formatPct(inputs.leadToOpportunityPct, 0)}` : 'Lead → opportunity: not entered',
            ],
            derived: [
              `Inferred opportunities / month: ${formatCount(d.inferredOpportunitiesPerMonth, 1)}`,
              `Demand-funded new ARR at stated win rate: ${money(demandCapacity)}`,
              `New ARR required after retention to hit target: ${money(required)}`,
            ],
            commercialImplication:
              coverage !== null && coverage >= 1.15
                ? 'Demand is not where revenue is disappearing. Investigate downstream stages.'
                : 'The growth target is asking more of demand than the evidence can support.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: haveLeads ? 'Lead quality mix and source concentration are unknown.' : 'Qualified lead volume was not entered.',
            whatWouldChangeThis: 'A verified lead-to-opportunity rate by source, or a restated growth target, would recast demand sufficiency.',
            oneMoreDiscovery:
              coverage !== null && coverage >= 1.15
                ? {
                    headline: 'Demand is not the constraint.',
                    detail: 'If revenue is disappearing, it is disappearing after demand is created. The Ghost Map will show where credibility actually deteriorates.',
                  }
                : undefined,
          },
          'why-demand'
        ),
      })
    );
  }

  // ——— QUALIFICATION ——————————————————————————————————————————
  {
    const l2o = inputs.leadToOpportunityPct;
    const win = inputs.winRatePct;
    const noDec = inputs.noDecisionPct;
    const buyer = inputs.economicBuyerPct;
    const supplied = [l2o, win, noDec, buyer].filter((v) => v !== null).length;
    let score = 0;
    let signal = 'Qualification quality cannot be judged from volume alone.';
    let pattern = 'Insufficient paired evidence to determine whether qualification is leaking quality into the pipeline.';
    const looseQual = l2o !== null && l2o >= 20 && win !== null && win < 25 && noDec !== null && noDec >= 15;
    const tightQual = l2o !== null && l2o < 14 && d.annualOpportunitiesCreated !== null;
    if (looseQual) {
      score = 44;
      signal = `${formatPct(l2o, 0)} of leads become opportunities, yet win rate is ${formatPct(win, 0)} with ${formatPct(noDec, 0)} no-decision.`;
      pattern = 'Qualification is admitting volume the conversion system cannot close. The leak is quality, not quantity.';
    } else if (l2o !== null && l2o < 12) {
      score = 36;
      signal = `Only ${formatPct(l2o, 0)} of qualified leads become opportunities.`;
      pattern = 'Qualification is a constriction. Demand may exist above the opportunity line and never enter pipeline.';
    } else if (l2o !== null && buyer !== null && buyer < 65 && l2o >= 18) {
      score = 28;
      signal = `${formatPct(l2o, 0)} convert to opportunity while only ${formatPct(buyer, 0)} have an identified economic buyer.`;
      pattern = 'Opportunities are being created faster than economic-buyer qualification. Pipeline looks larger than it commercially is.';
    } else if (l2o !== null) {
      score = tightQual ? 18 : 8;
      signal = `Lead → opportunity is ${formatPct(l2o, 0)}.`;
      pattern = 'Qualification rate, taken alone, does not currently describe a dominant leak.';
    }
    const exposure =
      looseQual && d.annualOpportunitiesCreated !== null && inputs.averageDealSize !== null && noDec !== null
        ? d.annualOpportunitiesCreated * (noDec / 100) * inputs.averageDealSize * 0.35
        : 0;
    const conf = confidenceFromEvidence(supplied, 4);
    ghosts.push(
      pack({
        id: 'qualification_ghost',
        name: 'Qualification Ghost',
        stage: 'qualification',
        stageLabel: 'Qualification',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Relationship between lead-to-opportunity admission, economic-buyer identification, no-decision and win rate.',
        upstream: ['demand_ghost'],
        downstream: ['pipeline_ghost', 'conversion_ghost'],
        why: why(
          {
            title: 'Qualification Ghost',
            subtitle: 'Is the system admitting work it cannot commercially finish?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              l2o !== null ? `Lead → opportunity: ${formatPct(l2o, 0)}` : 'Lead → opportunity: not entered',
              win !== null ? `Win rate: ${formatPct(win, 0)}` : 'Win rate: not entered',
              noDec !== null ? `No-decision: ${formatPct(noDec, 0)}` : 'No-decision: not entered',
              buyer !== null ? `Economic buyer identified: ${formatPct(buyer, 0)}` : 'Economic buyer: not entered',
            ],
            derived: [
              `Annual opportunities created: ${formatCount(d.annualOpportunitiesCreated, 1)}`,
              `Modeled recoverable slice of no-decision (35% of no-decision dollarized): ${money(exposure)}`,
            ],
            commercialImplication: looseQual
              ? 'Raising lead volume will feed a qualification standard that already over-admits. Tighten entry criteria before adding demand.'
              : 'Qualification is not currently the primary disappearance point.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Opportunity disqualification reasons and MEDDPICC / buyer-role completeness are not in evidence.',
            whatWouldChangeThis: 'Win rate by qualification source, or a verified economic-buyer rate above 80%, would recast this Ghost.',
            oneMoreDiscovery: looseQual
              ? {
                  headline: 'There is another layer behind this Ghost.',
                  detail: 'Loose qualification is likely manufacturing the Pipeline Ghost and the Conversion Ghost downstream. Fixing win rate without fixing entry criteria will not hold.',
                  linkedGhostId: 'pipeline_ghost',
                }
              : undefined,
          },
          'why-qualification'
        ),
      })
    );
  }

  // ——— PIPELINE ———————————————————————————————————————————————
  {
    const stale = inputs.stalePipelinePct;
    const next = inputs.verifiedNextStepPct;
    const buyer = inputs.economicBuyerPct;
    const pipeline = inputs.pipelineValue;
    const supplied = [stale, next, buyer, pipeline, inputs.pipelineCoverage].filter((v) => v !== null).length;
    const friction =
      stale !== null || next !== null || buyer !== null
        ? 0.45 * (stale ?? 0) + 0.3 * (100 - (next ?? 100)) + 0.25 * (100 - (buyer ?? 100))
        : null;
    let score = 0;
    let signal = 'Pipeline credibility cannot be judged without aging, next-step and buyer evidence.';
    let pattern = 'Headline pipeline value is not the same thing as commercially usable pipeline.';
    if (friction !== null) {
      if (friction >= 42) score = 72;
      else if (friction >= 28) score = 48;
      else if (friction >= 16) score = 22;
      else score = 6;
      signal = `Credibility friction index ${friction.toFixed(0)} — stale ${formatPct(stale, 0)}, verified next step ${formatPct(next, 0)}, economic buyer ${formatPct(buyer, 0)}.`;
      pattern =
        friction >= 28
          ? 'Headline coverage overstates inspectable pipeline. Stale value, missing next steps and unidentified buyers compound: the pipeline the forecast sees is larger than the pipeline that can close.'
          : 'Pipeline hygiene is not a dominant drag, though residual stale or unverified value still deserves inspection.';
    }
    const exposure =
      pipeline !== null && d.crediblePipelineDollars !== null
        ? Math.max(0, pipeline - d.crediblePipelineDollars)
        : d.stalePipelineDollars;
    const conf = confidenceFromEvidence(supplied, 5);
    ghosts.push(
      pack({
        id: 'pipeline_ghost',
        name: 'Pipeline Ghost',
        stage: 'pipeline',
        stageLabel: 'Pipeline',
        score,
        exposure: exposure ?? 0,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Joint pattern of stale share, verified next-step coverage and economic-buyer identification applied to stated pipeline value.',
        upstream: ['demand_ghost', 'qualification_ghost'],
        downstream: ['velocity_ghost', 'conversion_ghost', 'forecast_ghost'],
        why: why(
          {
            title: 'Pipeline Ghost',
            subtitle: 'How much of stated pipeline is commercially real?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              pipeline !== null ? `Pipeline value: ${money(pipeline)}` : 'Pipeline value: not entered',
              inputs.pipelineCoverage !== null ? `Stated coverage: ${inputs.pipelineCoverage.toFixed(1)}x` : 'Coverage: not entered',
              stale !== null ? `Stale pipeline: ${formatPct(stale, 0)}` : 'Stale pipeline: not entered',
              next !== null ? `Verified next step: ${formatPct(next, 0)}` : 'Verified next step: not entered',
              buyer !== null ? `Economic buyer identified: ${formatPct(buyer, 0)}` : 'Economic buyer: not entered',
            ],
            derived: [
              `Non-stale pipeline: ${money(pipeline !== null && stale !== null ? pipeline * (1 - stale / 100) : null)}`,
              `Credible pipeline (non-stale, haircut for next-step and buyer gaps): ${money(d.crediblePipelineDollars)}`,
              `Stated coverage: ${d.headlineCoverage !== null ? `${d.headlineCoverage.toFixed(2)}x` : 'UNVERIFIED'}`,
              `Credible coverage: ${d.credibleCoverage !== null ? `${d.credibleCoverage.toFixed(2)}x` : 'UNVERIFIED'}`,
              `Credibility gap (stated − credible): ${money(exposure)}`,
            ],
            commercialImplication:
              friction !== null && friction >= 28
                ? 'Management is steering using a pipeline larger than the evidence can defend. Forecast and coverage ratios inherit this overstatement.'
                : 'Pipeline credibility is not currently the primary commercial risk.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Opportunity-age distribution and stage-weighted pipeline are unavailable, so credibility is modeled from rates rather than deal-level evidence.',
            whatWouldChangeThis: 'A stage-weighted aging report or a verified-next-step rate above 85% with economic-buyer above 80% would collapse this Ghost.',
            oneMoreDiscovery:
              friction !== null && friction >= 28
                ? {
                    headline: 'This Ghost is feeding the Forecast Ghost.',
                    detail: 'If leadership reviews headline coverage, they are reviewing a number the evidence cannot fully support. Forecast confidence is downstream of pipeline credibility.',
                    linkedGhostId: 'forecast_ghost',
                  }
                : undefined,
          },
          'why-pipeline'
        ),
      })
    );
  }

  // ——— CONVERSION —————————————————————————————————————————————
  {
    const win = inputs.winRatePct;
    const noDec = inputs.noDecisionPct;
    const gap = d.conversionRealizationGapDeals;
    const supplied = [win, noDec, inputs.newCustomersPerYear, d.annualOpportunitiesCreated].filter((v) => v !== null).length;
    const realizationBreak =
      gap !== null && d.expectedWinsFromOpportunities !== null && d.expectedWinsFromOpportunities > 0
        ? Math.abs(gap) / d.expectedWinsFromOpportunities
        : null;
    let score = 0;
    let signal = 'Conversion cannot be diagnosed without win rate or observed new customers.';
    let pattern = 'Insufficient evidence.';
    if (win !== null) {
      const noDecPenalty = noDec !== null ? Math.max(0, noDec - 10) * 0.9 : 0;
      const winPenalty = Math.max(0, 28 - win) * 1.4;
      const realizationPenalty = realizationBreak !== null && realizationBreak > 0.2 ? 18 : 0;
      score = clampNum(winPenalty + noDecPenalty + realizationPenalty, 0, 100);
      signal = `Win rate ${formatPct(win, 0)}${noDec !== null ? `, no-decision ${formatPct(noDec, 0)}` : ''}${
        gap !== null ? `, expected wins ${formatCount(d.expectedWinsFromOpportunities, 1)} vs observed new customers ${formatCount(inputs.newCustomersPerYear)}` : ''
      }.`;
      if (realizationBreak !== null && realizationBreak > 0.25) {
        pattern = 'Stated win rate and observed new logos do not reconcile. Either conversion is weaker than reported, opportunity counts are inflated, or new-customer counting is incomplete — the Conversion Ghost and the Measurement Ghost are entangled.';
        score = Math.max(score, 46);
      } else if (win < 20 || (noDec !== null && noDec >= 20)) {
        pattern = 'Conversion is leaking. A material share of opportunities end without a decision or a win, so pipeline coverage cannot be read as future revenue.';
      } else if (win < 26) {
        pattern = 'Conversion is below a level that would make current pipeline coverage comfortable against the growth target. Small further deterioration becomes expensive.';
      } else {
        pattern = 'Conversion, on the evidence entered, is not the dominant leak.';
        score = Math.min(score, 12);
      }
    }
    const exposureFromNoDec =
      noDec !== null && d.annualOpportunitiesCreated !== null && inputs.averageDealSize !== null
        ? d.annualOpportunitiesCreated * (noDec / 100) * inputs.averageDealSize * 0.4
        : 0;
    const exposureFromGap =
      d.conversionRealizationGapDollars !== null && d.conversionRealizationGapDollars > 0
        ? d.conversionRealizationGapDollars
        : 0;
    const exposure = Math.max(exposureFromNoDec, exposureFromGap);
    const conf = confidenceFromEvidence(supplied, 4, realizationBreak !== null && realizationBreak > 0.25 ? 12 : 0);
    ghosts.push(
      pack({
        id: 'conversion_ghost',
        name: 'Conversion Ghost',
        stage: 'conversion',
        stageLabel: 'Conversion',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Win rate, no-decision rate, and reconciliation of expected wins against observed new customers.',
        upstream: ['qualification_ghost', 'pipeline_ghost', 'velocity_ghost'],
        downstream: ['forecast_ghost', 'measurement_ghost'],
        why: why(
          {
            title: 'Conversion Ghost',
            subtitle: 'Do opportunities become revenue at the rate the system claims?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              win !== null ? `Win rate: ${formatPct(win, 0)}` : 'Win rate: not entered',
              noDec !== null ? `No-decision: ${formatPct(noDec, 0)}` : 'No-decision: not entered',
              inputs.newCustomersPerYear !== null ? `New customers / year: ${formatCount(inputs.newCustomersPerYear)}` : 'New customers: not entered',
            ],
            derived: [
              `Expected wins from opportunities × win rate: ${formatCount(d.expectedWinsFromOpportunities, 1)}`,
              `Realization gap (expected wins − observed new logos): ${formatCount(gap, 1)}`,
              `Dollarized realization gap: ${money(d.conversionRealizationGapDollars)}`,
            ],
            commercialImplication:
              realizationBreak !== null && realizationBreak > 0.25
                ? 'Do not treat win rate as observed fact. The conversion claim is internally inconsistent with new-logo evidence.'
                : 'Conversion quality determines how much of the remaining credible pipeline can become ARR.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Win rate is not segmented by source, segment, or sales motion, so the Ghost is system-level rather than causal.',
            whatWouldChangeThis: 'A CRM-reconciled win rate that matches new-logo counts, or a no-decision rate below 10%, would recast conversion.',
            oneMoreDiscovery:
              realizationBreak !== null && realizationBreak > 0.25
                ? {
                    headline: 'The evidence supporting this conclusion is weaker than it initially appears.',
                    detail: 'Expected wins from the stated win rate do not match observed new customers. Treat the Conversion Ghost as a measurement problem until the two numbers reconcile.',
                    linkedGhostId: 'measurement_ghost',
                  }
                : undefined,
          },
          'why-conversion'
        ),
      })
    );
  }

  // ——— VELOCITY ———————————————————————————————————————————————
  {
    const cycle = inputs.salesCycleDays;
    const stale = inputs.stalePipelinePct;
    const age = inputs.avgOpportunityAgeDays;
    const supplied = [cycle, stale, age].filter((v) => v !== null).length;
    let score = 0;
    let signal = 'Velocity cannot be diagnosed without cycle time or aging.';
    let pattern = 'Insufficient evidence to locate a velocity leak.';
    const agingPastCycle = age !== null && cycle !== null && cycle > 0 && age > cycle * 1.15;
    if (cycle !== null) {
      const cyclePenalty = cycle > 90 ? (cycle - 90) * 0.35 : 0;
      const stalePenalty = stale !== null ? Math.max(0, stale - 10) * 0.7 : 0;
      const agePenalty = agingPastCycle && age !== null && cycle !== null ? ((age / cycle) - 1) * 40 : 0;
      score = clampNum(cyclePenalty + stalePenalty + agePenalty, 0, 100);
      signal = `Sales cycle ${cycle} days${stale !== null ? `, stale pipeline ${formatPct(stale, 0)}` : ''}${age !== null ? `, average opportunity age ${age} days` : ' (age distribution unverified)'}.`;
      if (agingPastCycle) {
        pattern = 'Opportunities are older than the stated cycle. The cycle number is an average that conceals a stalled population — velocity is degrading inside the pipeline.';
      } else if (cycle >= 100 && stale !== null && stale >= 20) {
        pattern = 'A long cycle combined with material stale share means revenue is spending longer as a maybe. Forecast timing will slip even if win rate holds.';
      } else if (cycle >= 90) {
        pattern = 'Cycle time is long enough that small stall rates become expensive. Without age distribution, this is a watch, not a conviction.';
        if (age === null) score = Math.min(score, 26);
      } else {
        pattern = 'Velocity, on available evidence, is not the dominant leak.';
        score = Math.min(score, 10);
      }
    } else if (stale !== null && stale >= 20) {
      score = 24;
      signal = `Stale pipeline is ${formatPct(stale, 0)} but sales cycle was not entered.`;
      pattern = 'Stale share suggests velocity friction, but cycle time is unverified so this Ghost cannot be fully scored.';
    }
    const exposure =
      d.stalePipelineDollars !== null && inputs.winRatePct !== null
        ? d.stalePipelineDollars * (inputs.winRatePct / 100)
        : d.stalePipelineDollars !== null
          ? d.stalePipelineDollars * 0.2
          : 0;
    const conf = confidenceFromEvidence(supplied, 3, age === null ? 14 : 0);
    ghosts.push(
      pack({
        id: 'velocity_ghost',
        name: 'Velocity Ghost',
        stage: 'velocity',
        stageLabel: 'Velocity',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 2, age === null),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Sales-cycle length interacting with stale pipeline share and, when present, average opportunity age.',
        upstream: ['pipeline_ghost'],
        downstream: ['conversion_ghost', 'forecast_ghost'],
        why: why(
          {
            title: 'Velocity Ghost',
            subtitle: 'Is revenue spending too long as a maybe?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 2, age === null),
            observed: [
              cycle !== null ? `Sales cycle: ${cycle} days` : 'Sales cycle: not entered',
              stale !== null ? `Stale pipeline: ${formatPct(stale, 0)}` : 'Stale pipeline: not entered',
              age !== null ? `Average opportunity age: ${age} days` : 'Average opportunity age: not entered',
            ],
            derived: [
              `Stale pipeline dollars: ${money(d.stalePipelineDollars)}`,
              `Modeled stalled-win exposure (stale × win rate): ${money(exposure)}`,
            ],
            commercialImplication:
              cycle !== null && cycle >= 100 && stale !== null && stale >= 20
                ? 'Even a correct win rate will deliver revenue later than the forecast implies. Timing risk is the commercial issue, not just volume.'
                : 'Velocity is not currently the primary disappearance point.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: age === null ? 'Opportunity age distribution is unavailable — a structural blind spot for velocity.' : 'Stage-level cycle time is unavailable.',
            whatWouldChangeThis: 'An aging histogram (0–30 / 31–60 / 61–90 / 90+) or a cycle below 80 days with stale below 10% would recast this Ghost.',
          },
          'why-velocity'
        ),
      })
    );
  }

  // ——— PRICING ————————————————————————————————————————————————
  {
    const discount = inputs.discountPct;
    const win = inputs.winRatePct;
    const supplied = [discount, win, inputs.averageDealSize, inputs.newCustomersPerYear].filter((v) => v !== null).length;
    let score = 0;
    let signal = 'Pricing pressure cannot be diagnosed without discount evidence.';
    let pattern = 'Insufficient evidence.';
    if (discount !== null) {
      if (discount >= 20 && win !== null && win < 22) {
        score = 62;
        signal = `Average discount ${formatPct(discount, 0)} with win rate ${formatPct(win, 0)}.`;
        pattern = 'Discounting is not buying conversion. Price is being given away and deals are still not closing — a Pricing Ghost with a Conversion Ghost inside it.';
      } else if (discount >= 18) {
        score = 44;
        signal = `Average discount ${formatPct(discount, 0)}.`;
        pattern = 'Discounting is material. Realized ASP is silently below list, so every coverage ratio denominated in list-like dollars overstates.';
      } else if (discount >= 10) {
        score = 20;
        signal = `Average discount ${formatPct(discount, 0)}.`;
        pattern = 'Discounting is present but not extreme. It is a quiet ASP leak, not currently a dominant Ghost.';
      } else {
        score = 5;
        signal = `Average discount ${formatPct(discount, 0)}.`;
        pattern = 'Pricing, on the evidence entered, is healthy.';
      }
    }
    const exposure = d.annualDiscountLeakageDollars ?? 0;
    const conf = confidenceFromEvidence(supplied, 4);
    ghosts.push(
      pack({
        id: 'pricing_ghost',
        name: 'Pricing Ghost',
        stage: 'conversion',
        stageLabel: 'Pricing',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 2, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Average discount versus realized deal size, read against win rate to distinguish bought-wins from wasted discount.',
        upstream: ['conversion_ghost'],
        downstream: ['forecast_ghost'],
        why: why(
          {
            title: 'Pricing Ghost',
            subtitle: 'Is discounting silently shrinking realized revenue?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 2, true),
            observed: [
              discount !== null ? `Average discount: ${formatPct(discount, 0)}` : 'Discount: not entered',
              inputs.averageDealSize !== null ? `Average deal size: ${money(inputs.averageDealSize)}` : 'Deal size: not entered',
              win !== null ? `Win rate: ${formatPct(win, 0)}` : 'Win rate: not entered',
            ],
            derived: [
              `Implied list deal size: ${money(d.impliedListDealSize)}`,
              `Annual discount leakage on observed new logos: ${money(d.annualDiscountLeakageDollars)}`,
            ],
            commercialImplication:
              discount !== null && discount >= 10
                ? 'Discount is a realized-revenue haircut. It does not appear as churn and will not appear in a retention report.'
                : 'Pricing is not currently where revenue is disappearing.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Discount concentration (who discounts, on which deals) is unknown — averages conceal pockets of severe discounting.',
            whatWouldChangeThis: 'Discount distribution by segment, or an average discount below 8% with stable win rate, would recast this Ghost.',
          },
          'why-pricing'
        ),
      })
    );
  }

  // ——— RETENTION ——————————————————————————————————————————————
  {
    const churn = inputs.annualChurnPct;
    const contraction = inputs.contractionPct;
    const expansion = inputs.expansionPct;
    const supplied = [churn, contraction, expansion, inputs.annualRevenue, inputs.activeCustomers].filter((v) => v !== null).length;
    let score = 0;
    let signal = 'Retention cannot be diagnosed without churn evidence.';
    let pattern = 'Insufficient evidence.';
    const nrr = d.netRevenueRetentionPct;
    if (churn !== null) {
      const churnScore = churn >= 15 ? 78 : churn >= 10 ? 52 : churn >= 6 ? 24 : 6;
      const nrrPenalty = nrr !== null && nrr < 100 ? 12 : 0;
      score = clampNum(churnScore + nrrPenalty, 0, 100);
      signal = `Annual churn ${formatPct(churn, 0)}${contraction !== null ? `, contraction ${formatPct(contraction, 0)}` : ''}${nrr !== null ? `, NRR ${formatPct(nrr, 0)}` : ''}.`;
      if (nrr !== null && nrr < 95) {
        pattern = 'The existing base is shrinking. New logos must outrun a leak in the installed base — a growth target built on new ARR alone will miss.';
      } else if (churn >= 10) {
        pattern = 'Churn is commercially material. It will not appear as a lost deal in the pipeline; it appears as silent ARR that will not renew.';
      } else {
        pattern = 'Retention, on the evidence entered, is not the dominant leak.';
      }
    }
    const exposure = d.annualChurnDollars ?? 0;
    const conf = confidenceFromEvidence(supplied, 5);
    ghosts.push(
      pack({
        id: 'retention_ghost',
        name: 'Retention Ghost',
        stage: 'retention',
        stageLabel: 'Retention',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Annual logo churn, contraction and the resulting net revenue retention of the installed base.',
        upstream: [],
        downstream: ['expansion_ghost', 'forecast_ghost'],
        why: why(
          {
            title: 'Retention Ghost',
            subtitle: 'Is installed-base revenue quietly leaving?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              churn !== null ? `Annual churn: ${formatPct(churn, 0)}` : 'Churn: not entered',
              contraction !== null ? `Contraction: ${formatPct(contraction, 0)}` : 'Contraction: not entered',
              expansion !== null ? `Expansion: ${formatPct(expansion, 0)}` : 'Expansion: not entered',
              inputs.annualRevenue !== null ? `Annual revenue: ${money(inputs.annualRevenue)}` : 'Annual revenue: not entered',
            ],
            derived: [
              `Gross retention: ${formatPct(d.grossRetentionPct, 0)}`,
              `Net revenue retention: ${formatPct(d.netRevenueRetentionPct, 0)}`,
              `Annual churn dollars: ${money(d.annualChurnDollars)}`,
              `Annual contraction dollars: ${money(d.annualContractionDollars)}`,
            ],
            commercialImplication:
              nrr !== null && nrr < 100
                ? 'Every point of NRR below 100 is ARR the growth target must replace with new logos before it can grow. Retention is a tax on acquisition.'
                : 'Retention is not currently consuming the growth target.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Churn is not segmented by cohort, segment, or reason — the Ghost is visible, the cause is not.',
            whatWouldChangeThis: 'Cohort-level churn below 6% or NRR at or above 100% would recast this Ghost.',
            oneMoreDiscovery:
              nrr !== null && nrr < 100
                ? {
                    headline: 'Fixing conversion alone may not recover the expected revenue.',
                    detail: 'A Retention Ghost sits on the installed base. New-logo gains are being asked to fund both growth and replacement. Downstream retention will absorb part of any conversion improvement.',
                    linkedGhostId: 'expansion_ghost',
                  }
                : undefined,
          },
          'why-retention'
        ),
      })
    );
  }

  // ——— EXPANSION ——————————————————————————————————————————————
  {
    const expansion = inputs.expansionPct;
    const churn = inputs.annualChurnPct;
    const contraction = inputs.contractionPct;
    const supplied = [expansion, churn, contraction, inputs.annualRevenue].filter((v) => v !== null).length;
    let score = 0;
    let signal = 'Expansion cannot be diagnosed without an expansion rate.';
    let pattern = 'Insufficient evidence.';
    const gapPct =
      expansion !== null && churn !== null
        ? churn + (contraction ?? 0) - expansion
        : null;
    if (expansion !== null) {
      if (gapPct !== null && gapPct > 8) {
        score = 40;
        signal = `Expansion ${formatPct(expansion, 0)} does not offset churn ${formatPct(churn, 0)}${contraction !== null ? ` + contraction ${formatPct(contraction, 0)}` : ''}.`;
        pattern = 'Expansion is present but too small to replace what the base is losing. This is not a missing motion; it is an underpowered one.';
      } else if (expansion < 5) {
        score = 22;
        signal = `Expansion is ${formatPct(expansion, 0)}.`;
        pattern = 'Expansion is thin. The business is relying on new logos for all net growth.';
      } else {
        score = 7;
        signal = `Expansion ${formatPct(expansion, 0)}${gapPct !== null && gapPct <= 0 ? ' covers installed-base leakage.' : '.'}`;
        pattern = 'Expansion, on the evidence entered, is not a dominant Ghost.';
      }
    }
    const exposure =
      gapPct !== null && gapPct > 0 && inputs.annualRevenue !== null
        ? inputs.annualRevenue * (gapPct / 100)
        : 0;
    const conf = confidenceFromEvidence(supplied, 4);
    ghosts.push(
      pack({
        id: 'expansion_ghost',
        name: 'Expansion Ghost',
        stage: 'expansion',
        stageLabel: 'Expansion',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Expansion rate read against churn and contraction — whether the installed base can fund its own replacement.',
        upstream: ['retention_ghost'],
        downstream: ['forecast_ghost'],
        why: why(
          {
            title: 'Expansion Ghost',
            subtitle: 'Is the installed base compounding, or only leaking more slowly?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              expansion !== null ? `Expansion: ${formatPct(expansion, 0)}` : 'Expansion: not entered',
              churn !== null ? `Churn: ${formatPct(churn, 0)}` : 'Churn: not entered',
              contraction !== null ? `Contraction: ${formatPct(contraction, 0)}` : 'Contraction: not entered',
            ],
            derived: [
              `Expansion dollars: ${money(d.annualExpansionDollars)}`,
              `Net installed-base gap (churn + contraction − expansion): ${formatPct(gapPct, 1)}`,
              `Dollarized installed-base gap: ${money(exposure)}`,
            ],
            commercialImplication:
              gapPct !== null && gapPct > 0
                ? 'Expansion is not carrying the base. Acquisition is doing two jobs.'
                : 'Expansion is not currently a leak.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Expansion is not split into upsell vs. price increase vs. seat growth, so the motion quality is unverified.',
            whatWouldChangeThis: 'Expansion that equals or exceeds churn + contraction, verified by account-level NRR, would recast this Ghost.',
          },
          'why-expansion'
        ),
      })
    );
  }

  // ——— FORECAST ———————————————————————————————————————————————
  {
    const acc = inputs.forecastAccuracyPct;
    const crm = inputs.crmConfidencePct;
    const supplied = [acc, crm, inputs.pipelineCoverage, inputs.stalePipelinePct].filter((v) => v !== null).length;
    const pipelineActiveFriction =
      (inputs.stalePipelinePct ?? 0) >= 18 || (inputs.verifiedNextStepPct ?? 100) < 75;
    let score = 0;
    let signal = 'Forecast trust cannot be diagnosed without accuracy evidence.';
    let pattern = 'Insufficient evidence.';
    if (acc !== null) {
      const accPenalty = acc >= 88 ? 4 : acc >= 80 ? 12 : acc >= 70 ? 28 : 54;
      const crmPenalty = crm !== null && crm < 75 ? (75 - crm) * 0.4 : 0;
      const inherited = pipelineActiveFriction ? 14 : 0;
      score = clampNum(accPenalty + crmPenalty + inherited, 0, 100);
      signal = `Forecast accuracy ${formatPct(acc, 0)}${crm !== null ? `, CRM/data confidence ${formatPct(crm, 0)}` : ''}.`;
      if (pipelineActiveFriction && acc < 80) {
        pattern = 'Leadership is looking at a forecast built on a pipeline whose credibility is already impaired. The Forecast Ghost is not an independent math error — it is inherited from pipeline hygiene.';
      } else if (acc < 70) {
        pattern = 'Forecast accuracy is low enough that plans, hiring and capacity are being set against an unreliable number.';
      } else if (acc < 82) {
        pattern = 'Forecast is usable but not trustworthy enough to be the only management instrument.';
      } else {
        pattern = 'Forecast, on the evidence entered, is not a dominant Ghost.';
        score = Math.min(score, 12);
      }
    }
    const exposure =
      inputs.pipelineValue !== null && acc !== null
        ? inputs.pipelineValue * ((100 - acc) / 100) * 0.35
        : 0;
    const conf = confidenceFromEvidence(supplied, 4);
    ghosts.push(
      pack({
        id: 'forecast_ghost',
        name: 'Forecast Ghost',
        stage: 'forecast',
        stageLabel: 'Forecast',
        score,
        exposure,
        confidence: conf,
        evidenceState: stateFrom(supplied, 2, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Historical forecast accuracy combined with CRM confidence and inherited pipeline-credibility risk.',
        upstream: ['pipeline_ghost', 'conversion_ghost', 'measurement_ghost'],
        downstream: ['attention_ghost'],
        why: why(
          {
            title: 'Forecast Ghost',
            subtitle: 'Is leadership seeing a healthier future than the evidence supports?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 2, true),
            observed: [
              acc !== null ? `Forecast accuracy: ${formatPct(acc, 0)}` : 'Forecast accuracy: not entered',
              crm !== null ? `CRM/data confidence: ${formatPct(crm, 0)}` : 'CRM confidence: not entered',
            ],
            derived: [
              `Inherited pipeline-credibility risk: ${pipelineActiveFriction ? 'YES — stale or unverified-next-step evidence is material' : 'NO'}`,
              `Modeled forecast-error band on pipeline: ${money(exposure)}`,
            ],
            commercialImplication:
              pipelineActiveFriction && acc !== null && acc < 80
                ? 'The forecast is not an independent opinion. It is a picture of a pipeline the evidence already discounts. Acting on headline coverage will overstate near-term revenue.'
                : 'Forecast is not currently the primary leak.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Forecast methodology (commit vs. weighted vs. manager overlay) is unverified.',
            whatWouldChangeThis: 'Trailing 12-month forecast-vs-actual at ≤10% error, with credible pipeline above 80% of stated pipeline, would recast this Ghost.',
            oneMoreDiscovery:
              pipelineActiveFriction && acc !== null && acc < 80
                ? {
                    headline: 'This Ghost is connected to another weakness upstream.',
                    detail: 'Forecast inaccuracy is partly a Pipeline Ghost in a suit. Improving forecast process without improving pipeline credibility will produce a more precise wrong number.',
                    linkedGhostId: 'pipeline_ghost',
                  }
                : undefined,
          },
          'why-forecast'
        ),
      })
    );
  }

  // ——— MEASUREMENT ————————————————————————————————————————————
  {
    const crm = inputs.crmConfidencePct;
    const gap = d.conversionRealizationGapDeals;
    const expected = d.expectedWinsFromOpportunities;
    const realizationBreak =
      gap !== null && expected !== null && expected > 0 ? Math.abs(gap) / expected : 0;
    const coverageContradiction =
      inputs.pipelineCoverage !== null &&
      inputs.pipelineValue !== null &&
      inputs.annualRevenue !== null &&
      inputs.annualRevenue > 0 &&
      Math.abs(inputs.pipelineCoverage - inputs.pipelineValue / inputs.annualRevenue) > 1.2;
    const supplied = [crm, inputs.winRatePct, inputs.newCustomersPerYear, inputs.opportunitiesPerMonth, inputs.qualifiedLeadsPerMonth].filter((v) => v !== null).length;
    let score = 8;
    let signal = 'Measurement integrity is inferred from reconciliations, not from a data-audit.';
    let pattern = 'No hard contradiction is visible, but CRM confidence still caps how strongly other Ghosts can be believed.';
    if (realizationBreak > 0.25) {
      score = 50;
      signal = `Expected wins (${formatCount(expected, 1)}) do not reconcile with observed new customers (${formatCount(inputs.newCustomersPerYear)}).`;
      pattern = 'Two numbers that should describe the same commercial motion do not agree. Until they reconcile, conversion and demand diagnoses are both softer than they look.';
    } else if (coverageContradiction) {
      score = 34;
      signal = `Stated coverage ${inputs.pipelineCoverage?.toFixed(1)}x does not match pipeline ÷ annual revenue (${(inputs.pipelineValue! / inputs.annualRevenue!).toFixed(2)}x).`;
      pattern = 'Coverage is being defined against a different denominator than annual revenue. That is not automatically wrong — but it is a Measurement Ghost until the denominator is explicit.';
    } else if (crm !== null && crm < 70) {
      score = 30;
      signal = `CRM/data confidence is ${formatPct(crm, 0)}.`;
      pattern = 'Operators do not fully trust the system of record. Every other Ghost inherits this ceiling.';
    } else if (crm !== null && crm < 80) {
      score = 16;
      signal = `CRM/data confidence is ${formatPct(crm, 0)}.`;
      pattern = 'Data confidence is moderate. Diagnoses should be treated as directional, not forensic-grade.';
    }
    const conf = confidenceFromEvidence(Math.max(supplied, 2), 5);
    ghosts.push(
      pack({
        id: 'measurement_ghost',
        name: 'Measurement Ghost',
        stage: 'forecast',
        stageLabel: 'Measurement',
        score,
        exposure: 0,
        confidence: conf,
        evidenceState: stateFrom(supplied, 3, true),
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Reconciliations between independent inputs (win rate vs. new logos, coverage vs. pipeline/ARR) plus stated CRM confidence.',
        upstream: ['conversion_ghost'],
        downstream: ['forecast_ghost', 'attention_ghost'],
        why: why(
          {
            title: 'Measurement Ghost',
            subtitle: 'Can the other Ghosts be believed at face value?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 3, true),
            observed: [
              crm !== null ? `CRM/data confidence: ${formatPct(crm, 0)}` : 'CRM confidence: not entered',
              inputs.pipelineCoverage !== null ? `Stated coverage: ${inputs.pipelineCoverage.toFixed(1)}x` : 'Coverage: not entered',
            ],
            derived: [
              `Win-rate vs. new-logo realization break: ${formatPct(realizationBreak * 100, 0)}`,
              coverageContradiction
                ? `Pipeline ÷ ARR = ${(inputs.pipelineValue! / inputs.annualRevenue!).toFixed(2)}x vs stated ${inputs.pipelineCoverage?.toFixed(1)}x`
                : 'No coverage-denominator contradiction detected',
            ],
            commercialImplication:
              realizationBreak > 0.25
                ? 'Do not brief the board on conversion until win rate and new-logo counts are reconciled. The Measurement Ghost is the gate on every other conclusion.'
                : 'Measurement is a confidence ceiling, not currently a dollar leak.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'No CRM completeness audit, duplicate-opportunity check, or close-date hygiene evidence was supplied.',
            whatWouldChangeThis: 'A reconciled win-rate to new-logo report and CRM confidence above 85% would recast this Ghost.',
          },
          'why-measurement'
        ),
      })
    );
  }

  // ——— EXECUTION ——————————————————————————————————————————————
  {
    const next = inputs.verifiedNextStepPct;
    const freq = inputs.reviewFrequency;
    const stale = inputs.stalePipelinePct;
    const freqScore = { weekly: 0, biweekly: 10, monthly: 28, quarterly: 48, ad_hoc: 70 }[freq];
    const nextPenalty = next !== null ? Math.max(0, 82 - next) * 0.7 : 12;
    const stalePenalty = stale !== null && stale >= 20 ? 10 : 0;
    const score = clampNum(freqScore * 0.6 + nextPenalty + stalePenalty, 0, 100);
    const supplied = [next, stale].filter((v) => v !== null).length + 1;
    const conf = confidenceFromEvidence(supplied, 3);
    const weak = (next !== null && next < 72) || freq === 'quarterly' || freq === 'ad_hoc';
    ghosts.push(
      pack({
        id: 'execution_ghost',
        name: 'Execution Ghost',
        stage: 'attention',
        stageLabel: 'Execution',
        score: weak ? score : Math.min(score, 12),
        exposure: d.unverifiedNextStepDollars ?? 0,
        confidence: conf,
        evidenceState: stateFrom(supplied, 2, false),
        supportingSignal: `Verified next step ${formatPct(next, 0)}; revenue reviews are ${freq.replace('_', '-')}.`,
        patternSummary: weak
          ? 'Deals are allowed to exist without a verified next step, and the review cadence is not tight enough to catch them. Execution is manufacturing stale pipeline.'
          : 'Execution cadence, on the evidence entered, is not a dominant Ghost.',
        mechanism: 'Verified next-step coverage interacting with revenue-review frequency and stale pipeline.',
        upstream: ['pipeline_ghost'],
        downstream: ['velocity_ghost', 'forecast_ghost'],
        why: why(
          {
            title: 'Execution Ghost',
            subtitle: 'Is the operating cadence creating invisible stall?',
            subjectType: 'ghost',
            evidenceState: stateFrom(supplied, 2, false),
            observed: [
              next !== null ? `Verified next step: ${formatPct(next, 0)}` : 'Verified next step: not entered',
              `Review frequency: ${freq.replace('_', '-')}`,
              stale !== null ? `Stale pipeline: ${formatPct(stale, 0)}` : 'Stale pipeline: not entered',
            ],
            derived: [`Pipeline dollars without a verified next step: ${money(d.unverifiedNextStepDollars)}`],
            commercialImplication: weak
              ? 'Next-step hygiene is an operating decision, not a market condition. This Ghost is inside management’s control.'
              : 'Execution is not currently the primary leak.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'Next-step quality (date, owner, economic-buyer involvement) is unknown — a checkbox next step is not evidence of progress.',
            whatWouldChangeThis: 'Verified next-step above 85% with weekly deal inspection would recast this Ghost.',
          },
          'why-execution'
        ),
      })
    );
  }

  // ——— ATTENTION ——————————————————————————————————————————————
  {
    const lead = inputs.leadershipConfidence;
    const freq = inputs.reviewFrequency;
    const acc = inputs.forecastAccuracyPct;
    const materialUpstream = ghosts.filter((g) => g.severityLevel === 'material' || g.severityLevel === 'critical');
    let score = 8;
    let pattern = 'Leadership attention, on the evidence entered, is not a dominant Ghost.';
    let signal = `Leadership confidence is ${lead}; reviews are ${freq.replace('_', '-')}.`;
    if (lead === 'high' && materialUpstream.length >= 2) {
      score = 46;
      pattern = 'Leadership confidence is high while multiple material Ghosts are visible in the evidence. This is a Management Attention Gap — the room is calmer than the commercial system.';
      signal = `Leadership confidence is high while ${materialUpstream.length} material Ghosts are active.`;
    } else if (lead === 'low' && (freq === 'quarterly' || freq === 'ad_hoc')) {
      score = 40;
      pattern = 'Low leadership confidence combined with rare reviews means issues can mature into revenue misses before they are inspected.';
    } else if (lead === 'moderate' && materialUpstream.length >= 2) {
      score = 22;
      pattern = 'Attention is present but not concentrated on the Ghosts the evidence actually supports. Moderate confidence with material pipeline or retention issues is a watch, not calm.';
    } else if (lead === 'unverified') {
      score = 0;
      pattern = 'Leadership confidence was not provided. Attention cannot be scored.';
      signal = 'Leadership confidence is unverified.';
    }
    const conf = lead === 'unverified' ? 20 : 70;
    ghosts.push(
      pack({
        id: 'attention_ghost',
        name: 'Attention Ghost',
        stage: 'attention',
        stageLabel: 'Attention',
        score: lead === 'unverified' ? 0 : score,
        exposure: 0,
        confidence: conf,
        evidenceState: lead === 'unverified' ? 'UNVERIFIED' : 'OBSERVED',
        supportingSignal: signal,
        patternSummary: pattern,
        mechanism: 'Leadership confidence and review cadence read against the Ghosts already evidenced in the commercial system.',
        upstream: ['forecast_ghost', 'pipeline_ghost', 'retention_ghost'],
        downstream: [],
        why: why(
          {
            title: 'Attention Ghost',
            subtitle: 'Is management looking at the same system the evidence describes?',
            subjectType: 'ghost',
            evidenceState: lead === 'unverified' ? 'UNVERIFIED' : 'OBSERVED',
            observed: [
              `Leadership confidence: ${lead}`,
              `Review frequency: ${freq.replace('_', '-')}`,
              acc !== null ? `Forecast accuracy: ${formatPct(acc, 0)}` : 'Forecast accuracy: not entered',
            ],
            derived: [
              `Material or critical Ghosts already evidenced: ${materialUpstream.map((g) => g.name).join(', ') || 'none'}`,
            ],
            commercialImplication:
              lead === 'high' && materialUpstream.length >= 2
                ? 'The most expensive Ghost may be the belief that the system is healthier than the evidence. Recalibrate the review, not the ambition.'
                : 'Attention is not currently the primary leak.',
            confidencePct: conf,
            evidenceStrength: evidenceLabel(conf),
            evidenceGap: 'We do not observe what leadership actually reviews (headline coverage vs. credible pipeline, logo churn vs. NRR).',
            whatWouldChangeThis: 'A review packet built on credible pipeline, NRR and reconciliation of win rate to new logos would recast this Ghost.',
          },
          'why-attention'
        ),
      })
    );
  }

  return ghosts;
}
