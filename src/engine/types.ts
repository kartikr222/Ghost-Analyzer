export type EvidenceState = 'OBSERVED' | 'INFERRED' | 'MODELED' | 'UNVERIFIED';

export type GhostId =
  | 'demand_ghost'
  | 'qualification_ghost'
  | 'pipeline_ghost'
  | 'conversion_ghost'
  | 'velocity_ghost'
  | 'pricing_ghost'
  | 'retention_ghost'
  | 'expansion_ghost'
  | 'forecast_ghost'
  | 'measurement_ghost'
  | 'execution_ghost'
  | 'attention_ghost';

export type CommercialStageId =
  | 'demand'
  | 'qualification'
  | 'pipeline'
  | 'conversion'
  | 'velocity'
  | 'revenue'
  | 'retention'
  | 'expansion'
  | 'forecast'
  | 'attention';

export type GhostSeverityLevel =
  | 'critical'
  | 'material'
  | 'watch'
  | 'healthy'
  | 'unverified';

export type GhostConcentrationType =
  | 'DOMINANT GHOST'
  | 'INTERACTING GHOSTS'
  | 'SYSTEMIC FRICTION'
  | 'INSUFFICIENT EVIDENCE';

export type ReviewFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'ad_hoc';

export type LeadershipConfidence =
  | 'high'
  | 'moderate'
  | 'low'
  | 'unverified';

export interface BusinessEvidenceInputs {
  // 01. Business Baseline
  annualRevenue: number | null;
  growthTargetPct: number | null;
  averageDealSize: number | null;
  activeCustomers: number | null;
  newCustomersPerYear: number | null;

  // 02. Demand
  qualifiedLeadsPerMonth: number | null;
  leadToOpportunityPct: number | null;
  opportunitiesPerMonth: number | null;

  // 03. Pipeline
  pipelineValue: number | null;
  pipelineCoverage: number | null;
  avgOpportunityAgeDays: number | null;
  stalePipelinePct: number | null;
  verifiedNextStepPct: number | null;
  economicBuyerPct: number | null;

  // 04. Conversion & Pricing
  winRatePct: number | null;
  salesCycleDays: number | null;
  noDecisionPct: number | null;
  discountPct: number | null;

  // 05. Retention & Expansion
  annualChurnPct: number | null;
  contractionPct: number | null;
  expansionPct: number | null;

  // 06. Forecast & Management
  forecastAccuracyPct: number | null;
  crmConfidencePct: number | null;
  reviewFrequency: ReviewFrequency;
  leadershipConfidence: LeadershipConfidence;
}

export interface WhyTrace {
  id: string;
  title: string;
  subtitle: string;
  subjectType:
    | 'ghost'
    | 'stage'
    | 'waterfall'
    | 'verdict'
    | 'scorecard'
    | 'disappearance'
    | 'action';
  evidenceState: EvidenceState;
  observed: string[];
  derived: string[];
  commercialImplication: string;
  confidencePct: number;
  evidenceStrength: 'HIGH' | 'MODERATE' | 'LIMITED' | 'INSUFFICIENT';
  evidenceGap: string;
  whatWouldChangeThis: string;
  oneMoreDiscovery?: {
    headline: string;
    detail: string;
    linkedGhostId?: GhostId;
  };
}

export interface GhostDiagnosis {
  id: GhostId;
  name: string;
  stage: CommercialStageId;
  stageLabel: string;
  severityScore: number; // 0 - 100 deterministic composite
  severityLevel: GhostSeverityLevel;
  isHealthy: boolean;
  isActiveGhost: boolean;
  economicExposure: number | null; // Annualized $ exposure, null if unverified
  confidencePct: number;
  evidenceState: EvidenceState;
  supportingSignal: string;
  patternSummary: string;
  mechanism: string;
  upstreamGhostIds: GhostId[];
  downstreamGhostIds: GhostId[];
  why: WhyTrace;
}

export interface GhostMapStage {
  id: CommercialStageId;
  order: number;
  name: string;
  shortName: string;
  credibilityPct: number | null;
  volumeLabel: string;
  dollarValue: number | null;
  status: GhostSeverityLevel;
  evidenceState: EvidenceState;
  ghosts: GhostDiagnosis[];
  isDisappearancePoint: boolean;
  why: WhyTrace;
}

export interface GhostChainLink {
  id: string;
  fromGhostId: GhostId;
  fromGhostName: string;
  toGhostId: GhostId;
  toGhostName: string;
  transmissionMechanism: string;
  compoundImpactLabel: string;
  evidenceStrengthPct: number;
  evidenceState: EvidenceState;
}

export interface DisappearanceStageNode {
  id: string;
  label: string;
  stageOrder: number;
  dollarAmount: number | null;
  credibilityRetentionPct: number | null;
  dropFromPreviousDollars: number | null;
  dropFromPreviousPct: number | null;
  evidenceState: EvidenceState;
  explanation: string;
  isPrimaryDisappearancePoint: boolean;
}

export interface DisappearancePointAnalysis {
  found: boolean;
  stageId: string;
  stageName: string;
  priorStageName: string;
  credibilityDropPct: number | null;
  exposedDollars: number | null;
  headline: string;
  narrative: string;
  evidenceState: EvidenceState;
  nodes: DisappearanceStageNode[];
  why: WhyTrace;
}

export interface WaterfallStep {
  id: string;
  label: string;
  sublabel: string;
  amount: number | null;
  deltaFromPrior: number | null;
  stepType: 'anchor' | 'erosion' | 'realized' | 'net_outcome';
  evidenceState: EvidenceState;
  formulaText: string;
  provenanceNote: string;
  why: WhyTrace;
}

export interface UnknownEvidenceItem {
  id: string;
  title: string;
  category: string;
  status: 'MISSING INPUT' | 'STRUCTURAL BLIND SPOT' | 'CONTRADICTION';
  currentImpactOnConfidence: string;
  whatWouldChangeDiagnosis: string;
  proofRequired: string;
}

export interface ScorecardDimension {
  id: string;
  name: string;
  score: number | null; // 0 - 100, null if unverified
  status: 'HEALTHY' | 'WATCH' | 'FRICTION' | 'CRITICAL' | 'UNVERIFIED';
  evidenceState: EvidenceState;
  headlineMetric: string;
  summary: string;
  why: WhyTrace;
}

export interface StopFixProveItem {
  id: string;
  category: 'STOP' | 'FIX' | 'PROVE';
  title: string;
  rationale: string;
  targetStage: string;
  materialityScore: number; // 0-100
  confidenceScore: number; // 0-100
  leverageScore: number; // 0-100
  priorityIndex: number; // (materiality * confidence * leverage) normalized
  modeledImpactDollars: number | null;
  why: WhyTrace;
}

export interface ExecutiveVerdict {
  concentrationType: GhostConcentrationType;
  concentrationRationale: string;
  headline: string;
  whatIsHappening: string;
  whereItIsHappening: string;
  howStrongIsEvidence: string;
  financialMeaning: string;
  whatManagementShouldDoNow: string;
  totalIdentifiedExposure: number | null;
  recoverableRevenuePotential: number | null;
  overallConfidencePct: number;
  why: WhyTrace;
}

export interface CounterfactualControls {
  winRatePct: number;
  stalePipelinePct: number;
  salesCycleDays: number;
  annualChurnPct: number;
  discountPct: number;
  expansionPct: number;
  forecastAccuracyPct: number;
}

export interface SecondOrderEffect {
  id: string;
  triggerLever: string;
  affectedDimension: string;
  currentValueLabel: string;
  modeledValueLabel: string;
  deltaLabel: string;
  mathematicalBasis: string;
}

export interface LeverSensitivityItem {
  leverId: keyof CounterfactualControls;
  label: string;
  unitImprovementLabel: string;
  modeledAnnualImpact: number;
  rank: number;
  rationale: string;
}

export interface CounterfactualResult {
  controls: CounterfactualControls;
  baselineControls: CounterfactualControls;
  currentRealizedNewRevenue: number | null;
  modeledRealizedNewRevenue: number | null;
  currentNetRetentionDollars: number | null;
  modeledNetRetentionDollars: number | null;
  currentEndingArr: number | null;
  modeledEndingArr: number | null;
  modeledArrDelta: number | null;
  currentCrediblePipeline: number | null;
  modeledCrediblePipeline: number | null;
  crediblePipelineDelta: number | null;
  currentEffectiveDealSize: number | null;
  modeledEffectiveDealSize: number | null;
  discountRecoveryDollars: number | null;
  velocityCapacityMultiplier: number;
  forecastErrorReductionPct: number;
  secondOrderEffects: SecondOrderEffect[];
  leverSensitivityRanking: LeverSensitivityItem[];
  ifNothingChanges: {
    year1EndingArr: number | null;
    year2EndingArr: number | null;
    cumulativeTargetGap24Mo: number | null;
    cumulativeRetentionErosion24Mo: number | null;
    unresolvedPipelineDecay: number | null;
    narrative: string;
  };
  ifHighestLeverageFixed: {
    highestLeverageGhostName: string;
    leverChangedSummary: string;
    year1EndingArr: number | null;
    year2EndingArr: number | null;
    year1RecoveredDelta: number | null;
    year2RecoveredDelta: number | null;
    narrative: string;
  };
}

export interface DiagnosticAnalysisResult {
  inputs: BusinessEvidenceInputs;
  isSampleData: boolean;
  evidenceCompletenessPct: number;
  observedCount: number;
  inferredCount: number;
  unverifiedCount: number;
  derivedMetrics: {
    targetNetNewArr: number | null;
    targetEndingArr: number | null;
    grossRetentionPct: number | null;
    netRevenueRetentionPct: number | null;
    annualChurnDollars: number | null;
    annualContractionDollars: number | null;
    annualExpansionDollars: number | null;
    netRetentionDollars: number | null;
    grossNewArrRequiredForTarget: number | null;
    inferredOpportunitiesPerMonth: number | null;
    effectiveOpportunitiesPerMonth: number | null;
    annualOpportunitiesCreated: number | null;
    expectedWinsFromOpportunities: number | null;
    realizedNewArrFromCustomers: number | null;
    conversionRealizationGapDeals: number | null;
    conversionRealizationGapDollars: number | null;
    impliedListDealSize: number | null;
    annualDiscountLeakageDollars: number | null;
    stalePipelineDollars: number | null;
    unverifiedNextStepDollars: number | null;
    missingEconomicBuyerDollars: number | null;
    crediblePipelineDollars: number | null;
    crediblePipelineRatio: number | null;
    impliedQuotaFromCoverage: number | null;
    headlineCoverage: number | null;
    credibleCoverage: number | null;
    realizedNetArrAddition: number | null;
    realizedGrowthPct: number | null;
    growthTargetShortfallDollars: number | null;
  };
  verdict: ExecutiveVerdict;
  ghosts: GhostDiagnosis[];
  dominantGhost: GhostDiagnosis | null;
  ghostMapStages: GhostMapStage[];
  ghostChainLinks: GhostChainLink[];
  disappearancePoint: DisappearancePointAnalysis;
  waterfall: WaterfallStep[];
  unknowns: UnknownEvidenceItem[];
  scorecard: ScorecardDimension[];
  decisions: StopFixProveItem[];
}
