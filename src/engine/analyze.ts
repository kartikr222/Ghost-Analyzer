import type {
  BusinessEvidenceInputs,
  DiagnosticAnalysisResult,
  DisappearancePointAnalysis,
  DisappearanceStageNode,
  EvidenceState,
  ExecutiveVerdict,
  GhostChainLink,
  GhostConcentrationType,
  GhostDiagnosis,
  GhostMapStage,
  ScorecardDimension,
  StopFixProveItem,
  UnknownEvidenceItem,
  WaterfallStep,
  WhyTrace,
} from './types';
import { clampNum, formatCount, formatCurrency, formatPct } from './formatters';
import { diagnoseGhosts } from './ghosts';
import { computeDerivedMetrics, countProvidedFields } from './math';
import { isMatchingSampleBusiness } from './presets';

function money(v: number | null | undefined, compact = true): string {
  return formatCurrency(v ?? null, { compact });
}

function why(id: string, partial: Omit<WhyTrace, 'id'>): WhyTrace {
  return { id, ...partial };
}

function buildGhostMap(ghosts: GhostDiagnosis[], d: DiagnosticAnalysisResult['derivedMetrics']): GhostMapStage[] {
  const byStage: { id: GhostMapStage['id']; name: string; shortName: string; order: number }[] = [
    { id: 'demand', name: 'Demand', shortName: 'Demand', order: 1 },
    { id: 'qualification', name: 'Qualification', shortName: 'Qual', order: 2 },
    { id: 'pipeline', name: 'Pipeline', shortName: 'Pipeline', order: 3 },
    { id: 'conversion', name: 'Conversion', shortName: 'Convert', order: 4 },
    { id: 'velocity', name: 'Velocity', shortName: 'Velocity', order: 5 },
    { id: 'revenue', name: 'Revenue', shortName: 'Revenue', order: 6 },
    { id: 'retention', name: 'Retention', shortName: 'Retain', order: 7 },
    { id: 'expansion', name: 'Expansion', shortName: 'Expand', order: 8 },
  ];

  const dollarFor = (id: GhostMapStage['id']): number | null => {
    if (id === 'demand') {
      return d.effectiveOpportunitiesPerMonth !== null && d.realizedNewArrFromCustomers !== null
        ? (d.annualOpportunitiesCreated ?? 0) > 0
          ? d.annualOpportunitiesCreated
          : null
        : d.annualOpportunitiesCreated;
    }
    if (id === 'qualification') return d.annualOpportunitiesCreated;
    if (id === 'pipeline') return d.crediblePipelineDollars;
    if (id === 'conversion') return d.realizedNewArrFromCustomers;
    if (id === 'velocity') return d.stalePipelineDollars;
    if (id === 'revenue') return d.realizedNetArrAddition;
    if (id === 'retention') return d.netRetentionDollars;
    if (id === 'expansion') return d.annualExpansionDollars;
    return null;
  };

  return byStage.map((stage) => {
    const stageGhosts = ghosts.filter((g) => g.stage === stage.id || (stage.id === 'conversion' && g.id === 'pricing_ghost'));
    const worst = stageGhosts.reduce<GhostDiagnosis | null>((acc, g) => {
      if (!acc) return g;
      return g.severityScore > acc.severityScore ? g : acc;
    }, null);
    const status = worst?.severityLevel ?? 'unverified';
    const evidenceState: EvidenceState = worst?.evidenceState ?? 'UNVERIFIED';
    const credibility =
      stage.id === 'pipeline'
        ? d.crediblePipelineRatio !== null
          ? d.crediblePipelineRatio * 100
          : null
        : stage.id === 'conversion'
          ? d.expectedWinsFromOpportunities && d.expectedWinsFromOpportunities > 0 && d.realizedNewArrFromCustomers !== null
            ? clampNum(
                ((d.expectedWinsFromOpportunities - Math.max(0, d.conversionRealizationGapDeals ?? 0)) /
                  d.expectedWinsFromOpportunities) *
                  100,
                0,
                100
              )
            : null
          : stage.id === 'retention'
            ? d.netRevenueRetentionPct
            : worst
              ? clampNum(100 - worst.severityScore, 0, 100)
              : null;
    return {
      id: stage.id,
      order: stage.order,
      name: stage.name,
      shortName: stage.shortName,
      credibilityPct: credibility,
      volumeLabel:
        stage.id === 'pipeline'
          ? `Credible ${money(d.crediblePipelineDollars)}`
          : stage.id === 'revenue'
            ? `Net addition ${money(d.realizedNetArrAddition)}`
            : stage.id === 'demand'
              ? `${formatCount(d.effectiveOpportunitiesPerMonth, 1)} opps / mo`
              : stage.id === 'qualification'
                ? `${formatCount(d.annualOpportunitiesCreated, 0)} opps / yr`
                : stage.id === 'conversion'
                  ? `New ARR ${money(d.realizedNewArrFromCustomers)}`
                  : stage.id === 'retention'
                    ? `NRR ${formatPct(d.netRevenueRetentionPct, 0)}`
                    : stage.id === 'expansion'
                      ? `Expansion ${money(d.annualExpansionDollars)}`
                      : stage.id === 'velocity'
                        ? `Stale ${money(d.stalePipelineDollars)}`
                        : '',
      dollarValue: dollarFor(stage.id),
      status,
      evidenceState,
      ghosts: stageGhosts,
      isDisappearancePoint: false,
      why: why(`why-stage-${stage.id}`, {
        title: `${stage.name} stage`,
        subtitle: 'Stage-level commercial credibility',
        subjectType: 'stage',
        evidenceState,
        observed: stageGhosts.map((g) => `${g.name}: ${g.supportingSignal}`),
        derived: [`Stage status: ${status}`, `Credibility: ${formatPct(credibility, 0)}`],
        commercialImplication: worst?.patternSummary ?? 'No Ghost is currently evidenced at this stage.',
        confidencePct: worst?.confidencePct ?? 40,
        evidenceStrength: worst && worst.confidencePct >= 70 ? 'HIGH' : worst && worst.confidencePct >= 50 ? 'MODERATE' : 'LIMITED',
        evidenceGap: 'Stage-level CRM snapshots are not loaded; the stage is inferred from entered rates.',
        whatWouldChangeThis: 'Deal-level evidence at this stage would replace inferred credibility with observed credibility.',
      }),
    };
  });
}

function buildGhostChain(ghosts: GhostDiagnosis[]): GhostChainLink[] {
  const byId = new Map(ghosts.map((g) => [g.id, g]));
  const candidates: Array<{
    from: GhostDiagnosis['id'];
    to: GhostDiagnosis['id'];
    mechanism: string;
    impact: string;
  }> = [
    {
      from: 'qualification_ghost',
      to: 'pipeline_ghost',
      mechanism: 'Loose or incomplete qualification admits opportunities that arrive without an economic buyer or a real next step.',
      impact: 'Pipeline value inflates while credible pipeline does not.',
    },
    {
      from: 'pipeline_ghost',
      to: 'velocity_ghost',
      mechanism: 'Unverified and stale opportunities age in place. Cycle time lengthens because the working set is contaminated.',
      impact: 'Revenue spends longer as a maybe.',
    },
    {
      from: 'pipeline_ghost',
      to: 'conversion_ghost',
      mechanism: 'A less credible pipeline produces a lower-quality conversion set. Win rate is computed on a denominator that should have been smaller.',
      impact: 'Conversion looks like a sales skill problem when it is partly a pipeline composition problem.',
    },
    {
      from: 'velocity_ghost',
      to: 'conversion_ghost',
      mechanism: 'Aged deals lose championship, budget and urgency. No-decision rises as cycle time stretches.',
      impact: 'Late-stage leakage compounds the Conversion Ghost.',
    },
    {
      from: 'conversion_ghost',
      to: 'forecast_ghost',
      mechanism: 'If stated win rate does not match new logos, any weighted forecast using that win rate will overstate.',
      impact: 'Leadership sees a healthier future than closed revenue can defend.',
    },
    {
      from: 'pipeline_ghost',
      to: 'forecast_ghost',
      mechanism: 'Headline coverage is the input most forecast processes consume. If coverage is not credible, the forecast inherits the overstatement.',
      impact: 'Forecast accuracy cannot outrun pipeline hygiene.',
    },
    {
      from: 'forecast_ghost',
      to: 'attention_ghost',
      mechanism: 'A calm forecast number sets the emotional temperature of the revenue review.',
      impact: 'Management attention is allocated to a picture the evidence does not fully support.',
    },
    {
      from: 'retention_ghost',
      to: 'expansion_ghost',
      mechanism: 'Churn and contraction force expansion to do replacement work instead of compounding work.',
      impact: 'NRR stays below 100 even when an expansion motion exists.',
    },
    {
      from: 'measurement_ghost',
      to: 'forecast_ghost',
      mechanism: 'Irreconcilable inputs (win rate vs. new logos, coverage vs. pipeline/ARR) make the forecast internally un-auditable.',
      impact: 'Confidence in every downstream number is capped.',
    },
    {
      from: 'execution_ghost',
      to: 'pipeline_ghost',
      mechanism: 'Deals without a verified next step become stale pipeline. Execution manufactures the Pipeline Ghost.',
      impact: 'Hygiene is an operating choice, not a market condition.',
    },
    {
      from: 'pricing_ghost',
      to: 'conversion_ghost',
      mechanism: 'Discounting that does not lift win rate means conversion is failing for non-price reasons, while ASP still falls.',
      impact: 'The business pays for wins it is not receiving.',
    },
    {
      from: 'demand_ghost',
      to: 'qualification_ghost',
      mechanism: 'When demand is thin, qualification is pressured to admit more. When demand is ample, qualification quality is the real gate.',
      impact: 'The constraint moves one stage downstream of where teams usually look.',
    },
  ];

  const links: GhostChainLink[] = [];
  for (const c of candidates) {
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    if (!from.isActiveGhost && !to.isActiveGhost) continue;
    if (from.severityScore < 14 && to.severityScore < 14) continue;
    if (from.severityLevel === 'unverified' || to.severityLevel === 'unverified') continue;
    const strength = clampNum((from.severityScore + to.severityScore) / 2, 0, 96);
    if (strength < 18) continue;
    links.push({
      id: `${c.from}__${c.to}`,
      fromGhostId: c.from,
      fromGhostName: from.name,
      toGhostId: c.to,
      toGhostName: to.name,
      transmissionMechanism: c.mechanism,
      compoundImpactLabel: c.impact,
      evidenceStrengthPct: Math.round(strength),
      evidenceState: from.evidenceState === 'OBSERVED' && to.evidenceState === 'OBSERVED' ? 'INFERRED' : 'INFERRED',
    });
  }
  return links;
}

function buildDisappearance(
  inputs: BusinessEvidenceInputs,
  d: DiagnosticAnalysisResult['derivedMetrics']
): DisappearancePointAnalysis {
  const deal = inputs.averageDealSize;
  const leadsAnnual =
    inputs.qualifiedLeadsPerMonth !== null && deal !== null
      ? inputs.qualifiedLeadsPerMonth * 12 * deal
      : null;
  const qualifiedValue =
    d.annualOpportunitiesCreated !== null && deal !== null ? d.annualOpportunitiesCreated * deal : null;
  const expectedConversion = d.expectedWinsFromOpportunities !== null && deal !== null
    ? d.expectedWinsFromOpportunities * deal
    : null;
  const realized = d.realizedNewArrFromCustomers;
  const credible = d.crediblePipelineDollars;

  const nodes: DisappearanceStageNode[] = [
    {
      id: 'commercial_potential',
      label: 'Commercial Potential',
      stageOrder: 1,
      dollarAmount: leadsAnnual,
      credibilityRetentionPct: 100,
      dropFromPreviousDollars: null,
      dropFromPreviousPct: null,
      evidenceState: leadsAnnual !== null ? 'INFERRED' : 'UNVERIFIED',
      explanation: 'Annual qualified leads dollarized at average deal size — the theoretical ceiling if every qualified lead became a customer.',
      isPrimaryDisappearancePoint: false,
    },
    {
      id: 'qualified_opportunity',
      label: 'Qualified Opportunity',
      stageOrder: 2,
      dollarAmount: qualifiedValue,
      credibilityRetentionPct: leadsAnnual && qualifiedValue ? clampNum((qualifiedValue / leadsAnnual) * 100, 0, 100) : null,
      dropFromPreviousDollars: leadsAnnual !== null && qualifiedValue !== null ? Math.max(0, leadsAnnual - qualifiedValue) : null,
      dropFromPreviousPct: leadsAnnual && qualifiedValue ? clampNum((1 - qualifiedValue / leadsAnnual) * 100, 0, 100) : null,
      evidenceState: qualifiedValue !== null ? 'INFERRED' : 'UNVERIFIED',
      explanation: 'Annual opportunities × average deal size. This is admitted commercial work, not yet credible pipeline.',
      isPrimaryDisappearancePoint: false,
    },
    {
      id: 'credible_pipeline',
      label: 'Credible Pipeline',
      stageOrder: 3,
      dollarAmount: credible,
      credibilityRetentionPct: d.crediblePipelineRatio !== null ? d.crediblePipelineRatio * 100 : null,
      dropFromPreviousDollars:
        inputs.pipelineValue !== null && credible !== null ? Math.max(0, inputs.pipelineValue - credible) : null,
      dropFromPreviousPct:
        d.crediblePipelineRatio !== null ? clampNum((1 - d.crediblePipelineRatio) * 100, 0, 100) : null,
      evidenceState: credible !== null ? 'INFERRED' : 'UNVERIFIED',
      explanation: 'Current pipeline stock after removing stale value and haircutting for missing next steps and unidentified economic buyers. This is a stock, not an annual flow — labeled as such.',
      isPrimaryDisappearancePoint: false,
    },
    {
      id: 'expected_conversion',
      label: 'Expected Conversion',
      stageOrder: 4,
      dollarAmount: expectedConversion,
      credibilityRetentionPct:
        qualifiedValue && expectedConversion && qualifiedValue > 0
          ? clampNum((expectedConversion / qualifiedValue) * 100, 0, 100)
          : null,
      dropFromPreviousDollars:
        qualifiedValue !== null && expectedConversion !== null ? Math.max(0, qualifiedValue - expectedConversion) : null,
      dropFromPreviousPct:
        qualifiedValue && expectedConversion && qualifiedValue > 0
          ? clampNum((1 - expectedConversion / qualifiedValue) * 100, 0, 100)
          : null,
      evidenceState: expectedConversion !== null ? 'INFERRED' : 'UNVERIFIED',
      explanation: 'Annual opportunities × stated win rate × deal size. This is the conversion the system claims, not the conversion it has proven.',
      isPrimaryDisappearancePoint: false,
    },
    {
      id: 'realized_revenue',
      label: 'Realized New Revenue',
      stageOrder: 5,
      dollarAmount: realized,
      credibilityRetentionPct:
        expectedConversion && realized && expectedConversion > 0
          ? clampNum((realized / expectedConversion) * 100, 0, 100)
          : null,
      dropFromPreviousDollars:
        expectedConversion !== null && realized !== null ? expectedConversion - realized : null,
      dropFromPreviousPct:
        expectedConversion && realized !== null && expectedConversion > 0
          ? ((expectedConversion - realized) / expectedConversion) * 100
          : null,
      evidenceState: realized !== null ? 'OBSERVED' : 'UNVERIFIED',
      explanation: 'Observed new customers × average deal size. The only fully observed number in the chain.',
      isPrimaryDisappearancePoint: false,
    },
  ];

  let bestIdx = -1;
  let bestDrop = -Infinity;
  nodes.forEach((node, idx) => {
    if (idx === 0) return;
    if (node.id === 'credible_pipeline') {
      const drop = node.dropFromPreviousPct;
      if (drop !== null && drop > 18 && drop > bestDrop) {
        bestDrop = drop;
        bestIdx = idx;
      }
      return;
    }
    const drop = node.dropFromPreviousPct;
    if (drop !== null && drop > bestDrop) {
      bestDrop = drop;
      bestIdx = idx;
    }
  });

  if (bestIdx >= 0) nodes[bestIdx].isPrimaryDisappearancePoint = true;
  const primary = bestIdx >= 0 ? nodes[bestIdx] : null;
  const prior = bestIdx > 0 ? nodes[bestIdx - 1] : null;

  const found = primary !== null && (primary.dropFromPreviousPct ?? 0) >= 12;
  const headline = found && primary
    ? `Revenue Disappearance Point: ${primary.label}`
    : 'No single disappearance point can be defensibly named.';
  const narrative = found && primary && prior
    ? `The largest evidenced deterioration is between ${prior.label} and ${primary.label}. ${primary.explanation} Drop: ${money(primary.dropFromPreviousDollars)} (${formatPct(primary.dropFromPreviousPct, 0)}).`
    : 'Evidence is too incomplete, or deterioration is too evenly distributed, to name a single disappearance point without overclaiming.';

  return {
    found,
    stageId: primary?.id ?? 'none',
    stageName: primary?.label ?? 'Unverified',
    priorStageName: prior?.label ?? '',
    credibilityDropPct: primary?.dropFromPreviousPct ?? null,
    exposedDollars: primary?.dropFromPreviousDollars ?? null,
    headline,
    narrative,
    evidenceState: primary?.evidenceState ?? 'UNVERIFIED',
    nodes,
    why: why('why-disappearance', {
      title: 'Revenue Disappearance Point',
      subtitle: headline,
      subjectType: 'disappearance',
      evidenceState: primary?.evidenceState ?? 'UNVERIFIED',
      observed: [`Realized new revenue: ${money(realized)}`, `Stated pipeline: ${money(inputs.pipelineValue)}`],
      derived: nodes.map((n) => `${n.label}: ${money(n.dollarAmount)} (${n.evidenceState})`),
      commercialImplication: narrative,
      confidencePct: found ? 72 : 38,
      evidenceStrength: found ? 'MODERATE' : 'LIMITED',
      evidenceGap: 'Commercial Potential dollarizes leads at deal size — a modeled ceiling, not an observed funnel. Credible Pipeline is a stock; other nodes are annual flows. Units are labeled, not mixed silently.',
      whatWouldChangeThis: 'Stage-conversion evidence (lead → opp → close) from CRM would replace modeled drop-offs with observed drop-offs.',
    }),
  };
}

function buildWaterfall(
  inputs: BusinessEvidenceInputs,
  d: DiagnosticAnalysisResult['derivedMetrics']
): WaterfallStep[] {
  const deal = inputs.averageDealSize;
  const qualified =
    d.annualOpportunitiesCreated !== null && deal !== null ? d.annualOpportunitiesCreated * deal : null;
  const expected =
    d.expectedWinsFromOpportunities !== null && deal !== null ? d.expectedWinsFromOpportunities * deal : null;
  const realized = d.realizedNewArrFromCustomers;
  const retained = d.netRetentionDollars;
  const ending = retained !== null && realized !== null ? retained + realized : d.realizedNetArrAddition !== null && inputs.annualRevenue !== null
    ? inputs.annualRevenue + d.realizedNetArrAddition
    : null;

  const mkWhy = (id: string, title: string, formula: string, amount: number | null, state: EvidenceState): WhyTrace =>
    why(id, {
      title,
      subtitle: formula,
      subjectType: 'waterfall',
      evidenceState: state,
      observed: [],
      derived: [formula, `Amount: ${money(amount)}`],
      commercialImplication: 'This step is arithmetic on entered evidence. It is not a benchmark and not a promise.',
      confidencePct: amount === null ? 20 : state === 'OBSERVED' ? 88 : 70,
      evidenceStrength: amount === null ? 'INSUFFICIENT' : state === 'OBSERVED' ? 'HIGH' : 'MODERATE',
      evidenceGap: amount === null ? 'A required input for this step was not entered.' : 'Deal-level mix is unknown; averages are used.',
      whatWouldChangeThis: 'Replacing average deal size with segment ASPs would recast every dollar in this waterfall.',
    });

  const commercialPotential = d.grossNewArrRequiredForTarget;
  const steps: WaterfallStep[] = [
    {
      id: 'commercial_potential',
      label: 'Commercial Potential',
      sublabel: 'New ARR required after retention to hit the growth target',
      amount: commercialPotential,
      deltaFromPrior: null,
      stepType: 'anchor',
      evidenceState: commercialPotential !== null ? 'INFERRED' : 'UNVERIFIED',
      formulaText: 'targetEndingARR − (currentARR × NRR)',
      provenanceNote: 'INFERRED from growth target and retention rates. Not an observed funnel value.',
      why: mkWhy('why-wf-potential', 'Commercial Potential', 'targetEndingARR − (currentARR × NRR)', commercialPotential, commercialPotential !== null ? 'INFERRED' : 'UNVERIFIED'),
    },
    {
      id: 'qualified_opportunity',
      label: 'Qualified Opportunity',
      sublabel: 'Annual opportunities × average deal size',
      amount: qualified,
      deltaFromPrior: commercialPotential !== null && qualified !== null ? qualified - commercialPotential : null,
      stepType: 'anchor',
      evidenceState: qualified !== null ? 'INFERRED' : 'UNVERIFIED',
      formulaText: 'opportunitiesPerMonth × 12 × averageDealSize',
      provenanceNote: 'INFERRED. Opportunities are observed if entered, otherwise inferred from leads × lead-to-opportunity.',
      why: mkWhy('why-wf-qual', 'Qualified Opportunity', 'annualOpps × averageDealSize', qualified, qualified !== null ? 'INFERRED' : 'UNVERIFIED'),
    },
    {
      id: 'credible_pipeline',
      label: 'Credible Pipeline',
      sublabel: 'Current pipeline stock after credibility haircuts (stock, not flow)',
      amount: d.crediblePipelineDollars,
      deltaFromPrior: inputs.pipelineValue !== null && d.crediblePipelineDollars !== null ? d.crediblePipelineDollars - inputs.pipelineValue : null,
      stepType: 'erosion',
      evidenceState: d.crediblePipelineDollars !== null ? 'INFERRED' : 'UNVERIFIED',
      formulaText: 'pipeline × (1 − stale%) × (1 − 0.5×missingNextStep − 0.35×missingBuyer)',
      provenanceNote: 'INFERRED stock. Not comparable 1:1 with annual flow steps; shown because it is the inspectable commercial inventory.',
      why: mkWhy('why-wf-cred', 'Credible Pipeline', 'nonStalePipeline × credibilityHaircut', d.crediblePipelineDollars, d.crediblePipelineDollars !== null ? 'INFERRED' : 'UNVERIFIED'),
    },
    {
      id: 'expected_conversion',
      label: 'Expected Conversion',
      sublabel: 'What stated win rate would produce from annual opportunities',
      amount: expected,
      deltaFromPrior: qualified !== null && expected !== null ? expected - qualified : null,
      stepType: 'erosion',
      evidenceState: expected !== null ? 'INFERRED' : 'UNVERIFIED',
      formulaText: 'annualOpportunities × winRate × averageDealSize',
      provenanceNote: 'INFERRED from stated win rate. Not observed closed revenue.',
      why: mkWhy('why-wf-exp', 'Expected Conversion', 'annualOpps × winRate × dealSize', expected, expected !== null ? 'INFERRED' : 'UNVERIFIED'),
    },
    {
      id: 'realized_new',
      label: 'Realized New Revenue',
      sublabel: 'Observed new customers × average deal size',
      amount: realized,
      deltaFromPrior: expected !== null && realized !== null ? realized - expected : null,
      stepType: 'realized',
      evidenceState: realized !== null ? 'OBSERVED' : 'UNVERIFIED',
      formulaText: 'newCustomersPerYear × averageDealSize',
      provenanceNote: 'OBSERVED arithmetic on entered inputs. Still an average, not a ledger.',
      why: mkWhy('why-wf-real', 'Realized New Revenue', 'newCustomers × dealSize', realized, realized !== null ? 'OBSERVED' : 'UNVERIFIED'),
    },
    {
      id: 'ending_arr',
      label: 'Modeled Ending ARR',
      sublabel: 'Installed-base NRR + realized new revenue',
      amount: ending,
      deltaFromPrior: inputs.annualRevenue !== null && ending !== null ? ending - inputs.annualRevenue : null,
      stepType: 'net_outcome',
      evidenceState: ending !== null ? 'INFERRED' : 'UNVERIFIED',
      formulaText: '(currentARR × NRR) + realizedNewARR',
      provenanceNote: 'INFERRED 12-month run of current rates. Not a forecast and not a promise.',
      why: mkWhy('why-wf-end', 'Modeled Ending ARR', '(ARR × NRR) + newARR', ending, ending !== null ? 'INFERRED' : 'UNVERIFIED'),
    },
  ];
  return steps;
}

function buildUnknowns(inputs: BusinessEvidenceInputs, d: DiagnosticAnalysisResult['derivedMetrics']): UnknownEvidenceItem[] {
  const items: UnknownEvidenceItem[] = [];
  if (inputs.avgOpportunityAgeDays === null) {
    items.push({
      id: 'age_distribution',
      title: 'Opportunity age distribution is unavailable',
      category: 'Velocity',
      status: 'MISSING INPUT',
      currentImpactOnConfidence: 'The Velocity Ghost is scored from cycle time and stale share only. A stalled-population inside a tolerable average cycle cannot be seen.',
      whatWouldChangeDiagnosis: 'An aging histogram could elevate Velocity from watch to material, or collapse it if the tail is clean.',
      proofRequired: 'Count of open opportunities by 0–30 / 31–60 / 61–90 / 90+ day buckets, with value.',
    });
  }
  if (inputs.economicBuyerPct === null || (inputs.economicBuyerPct !== null && inputs.economicBuyerPct < 80)) {
    items.push({
      id: 'buyer_completeness',
      title: 'Economic-buyer identification is incomplete',
      category: 'Pipeline',
      status: inputs.economicBuyerPct === null ? 'MISSING INPUT' : 'STRUCTURAL BLIND SPOT',
      currentImpactOnConfidence: 'Credible pipeline applies a modeled haircut rather than an observed one.',
      whatWouldChangeDiagnosis: 'Buyer-role completeness above 80% would raise credible coverage and could recast the Pipeline Ghost as healthy.',
      proofRequired: 'Percent of pipeline value with a named economic buyer and a verified title.',
    });
  }
  if (inputs.discountPct !== null) {
    items.push({
      id: 'discount_concentration',
      title: 'Discount concentration is unknown',
      category: 'Pricing',
      status: 'STRUCTURAL BLIND SPOT',
      currentImpactOnConfidence: 'An average discount conceals whether leakage is broad or concentrated in a few large deals.',
      whatWouldChangeDiagnosis: 'A distribution showing discount above 25% on a small number of deals would localize the Pricing Ghost; a flat 12% across all deals would confirm it is systemic.',
      proofRequired: 'Discount histogram and discount by segment / deal size.',
    });
  }
  if (inputs.annualChurnPct !== null) {
    items.push({
      id: 'churn_segmentation',
      title: 'Churn is not segmented',
      category: 'Retention',
      status: 'STRUCTURAL BLIND SPOT',
      currentImpactOnConfidence: 'The Retention Ghost is visible in dollars and invisible in cause. Action cannot be targeted.',
      whatWouldChangeDiagnosis: 'Cohort or segment churn could move the Ghost from “installed base is leaking” to a specific motion to stop.',
      proofRequired: 'Logo and ARR churn by cohort, segment, and reason code for the last 12 months.',
    });
  }
  items.push({
    id: 'forecast_methodology',
    title: 'Forecast methodology is unverified',
    category: 'Forecast',
    status: 'STRUCTURAL BLIND SPOT',
    currentImpactOnConfidence: 'Accuracy is a trailing outcome. Without knowing whether the forecast is commit, weighted, or overlay, we cannot tell whether the Forecast Ghost is a process problem or a pipeline problem.',
    whatWouldChangeDiagnosis: 'A documented method plus forecast-vs-actual by category would separate process error from pipeline fiction.',
    proofRequired: 'Written forecast method and 12 months of category-level forecast vs. actual.',
  });
  if (inputs.crmConfidencePct === null || (inputs.crmConfidencePct !== null && inputs.crmConfidencePct < 85)) {
    items.push({
      id: 'crm_completeness',
      title: 'CRM completeness is uncertain',
      category: 'Measurement',
      status: inputs.crmConfidencePct === null ? 'MISSING INPUT' : 'STRUCTURAL BLIND SPOT',
      currentImpactOnConfidence: 'Every INFERRED number inherits a confidence ceiling from the system of record.',
      whatWouldChangeDiagnosis: 'A CRM completeness audit above 85% would raise confidence on Pipeline, Conversion and Forecast Ghosts together.',
      proofRequired: 'Percent of open opportunities with close date, amount, next step, owner and stage updated inside 14 days.',
    });
  }
  if (
    d.conversionRealizationGapDeals !== null &&
    d.expectedWinsFromOpportunities !== null &&
    d.expectedWinsFromOpportunities > 0 &&
    Math.abs(d.conversionRealizationGapDeals) / d.expectedWinsFromOpportunities > 0.2
  ) {
    items.push({
      id: 'win_vs_logos',
      title: 'Win rate and new-logo counts contradict each other',
      category: 'Measurement',
      status: 'CONTRADICTION',
      currentImpactOnConfidence: 'The Conversion Ghost and the Measurement Ghost are entangled. Treat win rate as a claim, not a fact.',
      whatWouldChangeDiagnosis: 'Reconciling the two numbers would either collapse the Conversion Ghost or confirm it.',
      proofRequired: 'CRM report of won opportunities in the same period as the new-customer count, with the same customer definition.',
    });
  }
  return items;
}

function buildScorecard(
  inputs: BusinessEvidenceInputs,
  d: DiagnosticAnalysisResult['derivedMetrics'],
  ghosts: GhostDiagnosis[]
): ScorecardDimension[] {
  const ghostScore = (id: GhostDiagnosis['id']): number | null => {
    const g = ghosts.find((x) => x.id === id);
    if (!g) return null;
    if (g.severityLevel === 'unverified') return null;
    return clampNum(100 - g.severityScore, 0, 100);
  };
  const statusOf = (score: number | null): ScorecardDimension['status'] => {
    if (score === null) return 'UNVERIFIED';
    if (score >= 78) return 'HEALTHY';
    if (score >= 62) return 'WATCH';
    if (score >= 42) return 'FRICTION';
    return 'CRITICAL';
  };
  const capturePieces = [
    ghostScore('pipeline_ghost'),
    ghostScore('conversion_ghost'),
    ghostScore('retention_ghost'),
    ghostScore('forecast_ghost'),
  ].filter((v): v is number => v !== null);
  const capture = capturePieces.length ? Math.round(capturePieces.reduce((a, b) => a + b, 0) / capturePieces.length) : null;

  const row = (
    id: string,
    name: string,
    score: number | null,
    headline: string,
    summary: string,
    state: EvidenceState
  ): ScorecardDimension => ({
    id,
    name,
    score,
    status: statusOf(score),
    evidenceState: state,
    headlineMetric: headline,
    summary,
    why: why(`why-score-${id}`, {
      title: name,
      subtitle: headline,
      subjectType: 'scorecard',
      evidenceState: state,
      observed: [headline],
      derived: [`Score: ${score === null ? 'UNVERIFIED' : `${score}/100`}`],
      commercialImplication: summary,
      confidencePct: score === null ? 20 : 70,
      evidenceStrength: score === null ? 'INSUFFICIENT' : 'MODERATE',
      evidenceGap: 'Scorecard dimensions are inverted Ghost severities, not a separate scoring model.',
      whatWouldChangeThis: 'Changing the underlying Ghost evidence changes this dimension immediately.',
    }),
  });

  return [
    row('capture', 'Revenue Capture Health', capture, `Modeled growth ${formatPct(d.realizedGrowthPct, 1)} vs target ${formatPct(inputs.growthTargetPct, 0)}`, 'Composite of pipeline, conversion, retention and forecast health. Not an average of vanity metrics.', capture === null ? 'UNVERIFIED' : 'INFERRED'),
    row('pipeline', 'Pipeline Evidence', ghostScore('pipeline_ghost'), `Credible coverage ${d.credibleCoverage !== null ? `${d.credibleCoverage.toFixed(2)}x` : 'UNVERIFIED'}`, ghosts.find((g) => g.id === 'pipeline_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'pipeline_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('conversion', 'Conversion Health', ghostScore('conversion_ghost'), `Win rate ${formatPct(inputs.winRatePct, 0)}`, ghosts.find((g) => g.id === 'conversion_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'conversion_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('velocity', 'Velocity Health', ghostScore('velocity_ghost'), `Cycle ${inputs.salesCycleDays !== null ? `${inputs.salesCycleDays} days` : 'UNVERIFIED'}`, ghosts.find((g) => g.id === 'velocity_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'velocity_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('pricing', 'Pricing Health', ghostScore('pricing_ghost'), `Discount ${formatPct(inputs.discountPct, 0)}`, ghosts.find((g) => g.id === 'pricing_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'pricing_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('retention', 'Retention Health', ghostScore('retention_ghost'), `NRR ${formatPct(d.netRevenueRetentionPct, 0)}`, ghosts.find((g) => g.id === 'retention_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'retention_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('expansion', 'Expansion Health', ghostScore('expansion_ghost'), `Expansion ${formatPct(inputs.expansionPct, 0)}`, ghosts.find((g) => g.id === 'expansion_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'expansion_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('forecast', 'Forecast Trust', ghostScore('forecast_ghost'), `Accuracy ${formatPct(inputs.forecastAccuracyPct, 0)}`, ghosts.find((g) => g.id === 'forecast_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'forecast_ghost')?.evidenceState ?? 'UNVERIFIED'),
    row('visibility', 'Management Visibility', ghostScore('attention_ghost'), `Leadership ${inputs.leadershipConfidence}`, ghosts.find((g) => g.id === 'attention_ghost')?.patternSummary ?? '', ghosts.find((g) => g.id === 'attention_ghost')?.evidenceState ?? 'UNVERIFIED'),
  ];
}

function buildDecisions(
  ghosts: GhostDiagnosis[],
  d: DiagnosticAnalysisResult['derivedMetrics']
): StopFixProveItem[] {
  const ranked = [...ghosts]
    .filter((g) => g.isActiveGhost)
    .sort((a, b) => {
      const aExp = a.economicExposure ?? 0;
      const bExp = b.economicExposure ?? 0;
      const aPri = aExp * (a.confidencePct / 100) * (a.severityScore / 100);
      const bPri = bExp * (b.confidencePct / 100) * (b.severityScore / 100);
      return bPri - aPri;
    });

  const items: StopFixProveItem[] = [];
  const top = ranked[0];
  if (top) {
    items.push({
      id: 'stop-headline-coverage',
      category: 'STOP',
      title:
        top.id === 'pipeline_ghost'
          ? 'Stop treating headline pipeline coverage as a steering number'
          : top.id === 'conversion_ghost'
            ? 'Stop briefing win rate as an observed fact until it reconciles with new logos'
            : top.id === 'retention_ghost'
              ? 'Stop planning growth as if the installed base is stable'
              : `Stop allocating attention away from ${top.name}`,
      rationale: top.patternSummary,
      targetStage: top.stageLabel,
      materialityScore: top.severityScore,
      confidenceScore: top.confidencePct,
      leverageScore: 78,
      priorityIndex: Math.round(top.severityScore * top.confidencePct * 0.78 / 100),
      modeledImpactDollars: top.economicExposure,
      why: top.why,
    });
  }
  if (ranked.find((g) => g.id === 'execution_ghost' && g.isActiveGhost) || ranked.find((g) => g.id === 'pipeline_ghost')) {
    items.push({
      id: 'fix-next-steps',
      category: 'FIX',
      title: 'Repair next-step and economic-buyer hygiene on the current pipeline before adding demand',
      rationale: 'Credible pipeline is the highest-leverage inspectable inventory. Demand added onto unclean pipeline becomes more uncredible pipeline.',
      targetStage: 'Pipeline',
      materialityScore: 70,
      confidenceScore: 74,
      leverageScore: 86,
      priorityIndex: 86,
      modeledImpactDollars: d.stalePipelineDollars,
      why: why('why-fix-hygiene', {
        title: 'Fix pipeline hygiene first',
        subtitle: 'Highest inspectable leverage',
        subjectType: 'action',
        evidenceState: 'INFERRED',
        observed: [],
        derived: [`Stale pipeline: ${money(d.stalePipelineDollars)}`, `Credible pipeline: ${money(d.crediblePipelineDollars)}`],
        commercialImplication: 'Hygiene is inside management control and compounds into forecast trust.',
        confidencePct: 74,
        evidenceStrength: 'MODERATE',
        evidenceGap: 'We cannot see which specific deals are stale.',
        whatWouldChangeThis: 'A clean aging report with owners would replace this operating instruction with a deal list.',
      }),
    });
  }
  const retention = ghosts.find((g) => g.id === 'retention_ghost');
  if (retention && retention.isActiveGhost) {
    items.push({
      id: 'fix-retention',
      category: 'FIX',
      title: 'Assign an owner to the installed-base leak before raising the new-logo target',
      rationale: retention.patternSummary,
      targetStage: 'Retention',
      materialityScore: retention.severityScore,
      confidenceScore: retention.confidencePct,
      leverageScore: 80,
      priorityIndex: Math.round(retention.severityScore * 0.8),
      modeledImpactDollars: retention.economicExposure,
      why: retention.why,
    });
  }
  items.push({
    id: 'prove-reconcile',
    category: 'PROVE',
    title: 'Prove that stated win rate and new-customer counts describe the same commercial motion',
    rationale: 'If they do not reconcile, conversion, forecast and demand diagnoses are all softer than they appear.',
    targetStage: 'Measurement',
    materialityScore: 64,
    confidenceScore: 80,
    leverageScore: 90,
    priorityIndex: 90,
    modeledImpactDollars: d.conversionRealizationGapDollars,
    why: why('why-prove-reconcile', {
      title: 'Reconcile conversion claims',
      subtitle: 'Proof required',
      subjectType: 'action',
      evidenceState: 'INFERRED',
      observed: [],
      derived: [`Realization gap: ${formatCount(d.conversionRealizationGapDeals, 1)} deals / ${money(d.conversionRealizationGapDollars)}`],
      commercialImplication: 'This is the gate on whether the Conversion Ghost is real.',
      confidencePct: 80,
      evidenceStrength: 'HIGH',
      evidenceGap: 'Customer definition may differ between CRM wins and reported new logos.',
      whatWouldChangeThis: 'A single reconciled report for the same period.',
    }),
  });
  items.push({
    id: 'prove-aging',
    category: 'PROVE',
    title: 'Collect opportunity age distribution and forecast-versus-actual by category',
    rationale: 'Two structural blind spots currently cap confidence on Velocity and Forecast Ghosts.',
    targetStage: 'Evidence',
    materialityScore: 50,
    confidenceScore: 88,
    leverageScore: 70,
    priorityIndex: 70,
    modeledImpactDollars: null,
    why: why('why-prove-aging', {
      title: 'Collect the missing evidence',
      subtitle: 'Proof required',
      subjectType: 'action',
      evidenceState: 'UNVERIFIED',
      observed: ['Average opportunity age: not entered', 'Forecast methodology: unverified'],
      derived: [],
      commercialImplication: 'These two artifacts would change more diagnoses than any additional vanity metric.',
      confidencePct: 88,
      evidenceStrength: 'HIGH',
      evidenceGap: 'The evidence does not exist in the current input set.',
      whatWouldChangeThis: 'Producing the artifacts.',
    }),
  });
  return items.sort((a, b) => b.priorityIndex - a.priorityIndex);
}

function buildVerdict(
  inputs: BusinessEvidenceInputs,
  d: DiagnosticAnalysisResult['derivedMetrics'],
  ghosts: GhostDiagnosis[],
  chain: GhostChainLink[],
  disappearance: DisappearancePointAnalysis,
  completeness: number
): { verdict: ExecutiveVerdict; dominant: GhostDiagnosis | null } {
  const active = ghosts.filter((g) => g.isActiveGhost);
  const material = active.filter((g) => g.severityLevel === 'material' || g.severityLevel === 'critical');
  const dollarGhosts = [...active].sort((a, b) => (b.economicExposure ?? 0) - (a.economicExposure ?? 0));
  const totalExposure = active.reduce((sum, g) => sum + Math.max(0, g.economicExposure ?? 0), 0);
  const dominant = dollarGhosts[0] && (dollarGhosts[0].economicExposure ?? 0) > 0 ? dollarGhosts[0] : material.sort((a, b) => b.severityScore - a.severityScore)[0] ?? null;

  let concentrationType: GhostConcentrationType;
  let concentrationRationale: string;
  if (completeness < 36) {
    concentrationType = 'INSUFFICIENT EVIDENCE';
    concentrationRationale = `Only ${formatPct(completeness, 0)} of relevant evidence is present. Naming a dominant Ghost would overclaim.`;
  } else if (dominant && totalExposure > 0 && (dominant.economicExposure ?? 0) / totalExposure >= 0.5 && material.length <= 2) {
    concentrationType = 'DOMINANT GHOST';
    concentrationRationale = `${dominant.name} carries ${formatPct(((dominant.economicExposure ?? 0) / totalExposure) * 100, 0)} of identified exposure.`;
  } else if (chain.length >= 2 && material.length >= 2 && material.length <= 4) {
    concentrationType = 'INTERACTING GHOSTS';
    concentrationRationale = `${material.length} material Ghosts are linked. The commercial system is producing compound friction, not a single broken metric.`;
  } else if (material.length >= 4) {
    concentrationType = 'SYSTEMIC FRICTION';
    concentrationRationale = `Material issues span ${new Set(material.map((g) => g.stage)).size} stages. This is a system, not a spot repair.`;
  } else if (dominant) {
    concentrationType = 'INTERACTING GHOSTS';
    concentrationRationale = `${dominant.name} is the heaviest Ghost, but it is not alone enough to call dominant.`;
  } else {
    concentrationType = 'INSUFFICIENT EVIDENCE';
    concentrationRationale = 'No Ghost is both material and well-evidenced.';
  }

  const nrr = d.netRevenueRetentionPct;
  const growth = d.realizedGrowthPct;
  const target = inputs.growthTargetPct;
  const whatIsHappening = [
    growth !== null && target !== null
      ? `Current rates imply ${formatPct(growth, 1)} growth against a ${formatPct(target, 0)} target.`
      : 'Growth versus target cannot be fully computed from the evidence entered.',
    nrr !== null ? `Installed-base NRR is ${formatPct(nrr, 0)}.` : '',
    disappearance.found ? disappearance.headline + '.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const where = disappearance.found
    ? `${disappearance.stageName}${dominant ? `, with ${dominant.name} as the heaviest evidenced Ghost` : ''}.`
    : dominant
      ? `${dominant.stageLabel} — ${dominant.name}.`
      : 'Location cannot be named without overclaiming.';

  const evidenceLine = `Evidence completeness ${formatPct(completeness, 0)}. Diagnoses are labeled OBSERVED, INFERRED, MODELED or UNVERIFIED. Nothing unlabeled is being treated as fact.`;

  const financial =
    d.growthTargetShortfallDollars !== null
      ? `Modeled 12-month shortfall versus target is ${money(d.growthTargetShortfallDollars)}. Identified Ghost exposure (not additive — Ghosts overlap) totals ${money(totalExposure)}. These are not the same number and must not be added together.`
      : `Identified Ghost exposure totals ${money(totalExposure || null)}. A target shortfall cannot be computed from the evidence entered.`;

  const action =
    concentrationType === 'INSUFFICIENT EVIDENCE'
      ? 'Collect the missing evidence named in What We Still Don’t Know before changing the operating plan.'
      : dominant?.id === 'pipeline_ghost'
        ? 'Inspect credible pipeline, not headline coverage. Assign owners to stale value and missing next steps this week.'
        : dominant?.id === 'retention_ghost'
          ? 'Put an owner on the installed-base leak. Do not raise the new-logo target until replacement work is explicit.'
          : dominant?.id === 'conversion_ghost'
            ? 'Reconcile win rate with new logos, then inspect no-decision. Do not add demand onto an unreconciled conversion claim.'
            : 'Act on the heaviest evidenced Ghost and the first link in the Ghost Chain — not on the longest list of metrics.';

  const headline =
    concentrationType === 'INSUFFICIENT EVIDENCE'
      ? 'The evidence is too thin to name where revenue is disappearing.'
      : dominant
        ? `${dominant.name} is where the commercial system is losing credibility.`
        : 'Friction is present, but no single Ghost dominates.';

  const overallConfidence = clampNum(
    completeness * 0.45 + (dominant ? dominant.confidencePct * 0.55 : 30),
    12,
    92
  );

  const recoverable = dominant?.economicExposure ?? null;

  return {
    dominant,
    verdict: {
      concentrationType,
      concentrationRationale,
      headline,
      whatIsHappening,
      whereItIsHappening: where,
      howStrongIsEvidence: evidenceLine,
      financialMeaning: financial,
      whatManagementShouldDoNow: action,
      totalIdentifiedExposure: totalExposure > 0 ? totalExposure : null,
      recoverableRevenuePotential: recoverable,
      overallConfidencePct: Math.round(overallConfidence),
      why: why('why-verdict', {
        title: 'Executive Verdict',
        subtitle: headline,
        subjectType: 'verdict',
        evidenceState: 'INFERRED',
        observed: [`Evidence completeness: ${formatPct(completeness, 0)}`],
        derived: [
          `Concentration: ${concentrationType}`,
          concentrationRationale,
          `Heaviest Ghost: ${dominant?.name ?? 'none'}`,
        ],
        commercialImplication: whatIsHappening,
        confidencePct: Math.round(overallConfidence),
        evidenceStrength: overallConfidence >= 70 ? 'MODERATE' : 'LIMITED',
        evidenceGap: 'Verdict is a reading of the Ghosts, not an independent data source.',
        whatWouldChangeThis: 'Material new evidence on the heaviest Ghost, or a reconciliation of win rate to new logos, would recast the verdict.',
      }),
    },
  };
}

export function analyzeBusiness(inputs: BusinessEvidenceInputs): DiagnosticAnalysisResult {
  const derivedMetrics = computeDerivedMetrics(inputs);
  const counts = countProvidedFields(inputs);
  const ghosts = diagnoseGhosts(inputs, derivedMetrics);
  const ghostChainLinks = buildGhostChain(ghosts);
  const disappearancePoint = buildDisappearance(inputs, derivedMetrics);
  const ghostMapStages = buildGhostMap(ghosts, derivedMetrics).map((stage) => ({
    ...stage,
    isDisappearancePoint:
      (disappearancePoint.stageId === 'credible_pipeline' && stage.id === 'pipeline') ||
      (disappearancePoint.stageId === 'expected_conversion' && stage.id === 'conversion') ||
      (disappearancePoint.stageId === 'realized_revenue' && stage.id === 'revenue') ||
      (disappearancePoint.stageId === 'qualified_opportunity' && stage.id === 'qualification') ||
      (disappearancePoint.stageId === 'commercial_potential' && stage.id === 'demand'),
  }));
  const waterfall = buildWaterfall(inputs, derivedMetrics);
  const unknowns = buildUnknowns(inputs, derivedMetrics);
  const scorecard = buildScorecard(inputs, derivedMetrics, ghosts);
  const { verdict, dominant } = buildVerdict(
    inputs,
    derivedMetrics,
    ghosts,
    ghostChainLinks,
    disappearancePoint,
    counts.completenessPct
  );
  const decisions = buildDecisions(ghosts, derivedMetrics);

  const inferredCount = ghosts.filter((g) => g.evidenceState === 'INFERRED').length;
  const unverifiedCount = ghosts.filter((g) => g.evidenceState === 'UNVERIFIED').length;

  return {
    inputs,
    isSampleData: isMatchingSampleBusiness(inputs),
    evidenceCompletenessPct: counts.completenessPct,
    observedCount: counts.observed,
    inferredCount,
    unverifiedCount,
    derivedMetrics,
    verdict,
    ghosts,
    dominantGhost: dominant,
    ghostMapStages,
    ghostChainLinks,
    disappearancePoint,
    waterfall,
    unknowns,
    scorecard,
    decisions,
  };
}
