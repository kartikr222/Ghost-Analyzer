import { useEffect, useMemo, useState } from 'react';
import { analyzeBusiness } from './engine/analyze';
import {
  defaultControlsFromInputs,
  simulateCounterfactual,
} from './engine/counterfactual';
import { formatCurrency, formatPct } from './engine/formatters';
import { EMPTY_BUSINESS_INPUTS, SAMPLE_BUSINESS_INPUTS } from './engine/presets';
import type {
  BusinessEvidenceInputs,
  CounterfactualControls,
  GhostDiagnosis,
  WhyTrace,
} from './engine/types';
import { clearState, loadState, saveState } from './storage';
import { KC_TOKENS } from './styles/tokens';

type ViewId =
  | 'briefing'
  | 'evidence'
  | 'verdict'
  | 'map'
  | 'chain'
  | 'disappear'
  | 'waterfall'
  | 'unknowns'
  | 'simulate'
  | 'decide'
  | 'report';

const EVIDENCE_STEPS: Array<{
  id: string;
  title: string;
  blurb: string;
  fields: Array<{
    key: keyof BusinessEvidenceInputs;
    label: string;
    hint: string;
    kind: 'money' | 'pct' | 'number' | 'days' | 'select';
    options?: Array<{ value: string; label: string }>;
  }>;
}> = [
  {
    id: 'baseline',
    title: 'Business baseline',
    blurb: 'The commercial object under investigation — not a spreadsheet, the size of the system.',
    fields: [
      { key: 'annualRevenue', label: 'Annual revenue', hint: 'Current ARR / run-rate', kind: 'money' },
      { key: 'growthTargetPct', label: 'Growth target', hint: 'Percent for the next 12 months', kind: 'pct' },
      { key: 'averageDealSize', label: 'Average deal size', hint: 'Realized ASP, not list', kind: 'money' },
      { key: 'activeCustomers', label: 'Active customers', hint: 'Logos currently paying', kind: 'number' },
      { key: 'newCustomersPerYear', label: 'New customers / year', hint: 'Observed new logos, last 12 months', kind: 'number' },
    ],
  },
  {
    id: 'demand',
    title: 'Demand',
    blurb: 'What enters the commercial system. Leave a field blank if you do not actually track it.',
    fields: [
      { key: 'qualifiedLeadsPerMonth', label: 'Qualified leads / month', hint: 'SQL or equivalent', kind: 'number' },
      { key: 'leadToOpportunityPct', label: 'Lead → opportunity', hint: 'Percent', kind: 'pct' },
      { key: 'opportunitiesPerMonth', label: 'Opportunities / month', hint: 'Leave blank to infer from leads × rate', kind: 'number' },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    blurb: 'Headline value is not credibility. These fields let the engine distinguish the two.',
    fields: [
      { key: 'pipelineValue', label: 'Pipeline value', hint: 'Open pipeline, current', kind: 'money' },
      { key: 'pipelineCoverage', label: 'Pipeline coverage', hint: 'Multiple, as you define it', kind: 'number' },
      { key: 'avgOpportunityAgeDays', label: 'Average opportunity age', hint: 'Days — leave blank if unknown', kind: 'days' },
      { key: 'stalePipelinePct', label: 'Stale pipeline', hint: 'Percent of value with no meaningful movement', kind: 'pct' },
      { key: 'verifiedNextStepPct', label: 'Verified next step', hint: 'Percent of value with a dated next step', kind: 'pct' },
      { key: 'economicBuyerPct', label: 'Economic buyer identified', hint: 'Percent of value', kind: 'pct' },
    ],
  },
  {
    id: 'conversion',
    title: 'Conversion & pricing',
    blurb: 'Whether admitted work becomes revenue, and at what realized price.',
    fields: [
      { key: 'winRatePct', label: 'Win rate', hint: 'Closed-won / closed opportunities', kind: 'pct' },
      { key: 'salesCycleDays', label: 'Average sales cycle', hint: 'Days', kind: 'days' },
      { key: 'noDecisionPct', label: 'No-decision', hint: 'Percent of opportunities', kind: 'pct' },
      { key: 'discountPct', label: 'Average discount', hint: 'Off list or off target price', kind: 'pct' },
    ],
  },
  {
    id: 'retention',
    title: 'Retention & expansion',
    blurb: 'The installed base is a second commercial system. It can quietly tax every new logo.',
    fields: [
      { key: 'annualChurnPct', label: 'Annual churn', hint: 'Logo or ARR churn — be consistent', kind: 'pct' },
      { key: 'contractionPct', label: 'Contraction', hint: 'Percent of ARR', kind: 'pct' },
      { key: 'expansionPct', label: 'Expansion', hint: 'Percent of ARR', kind: 'pct' },
    ],
  },
  {
    id: 'forecast',
    title: 'Forecast & management',
    blurb: 'What leadership believes, how often they look, and whether the system of record is trusted.',
    fields: [
      { key: 'forecastAccuracyPct', label: 'Forecast accuracy', hint: 'Trailing accuracy, percent', kind: 'pct' },
      { key: 'crmConfidencePct', label: 'CRM / data confidence', hint: 'Internal trust, percent', kind: 'pct' },
      {
        key: 'reviewFrequency',
        label: 'Revenue review frequency',
        hint: 'Operating cadence',
        kind: 'select',
        options: [
          { value: 'weekly', label: 'Weekly' },
          { value: 'biweekly', label: 'Biweekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'quarterly', label: 'Quarterly' },
          { value: 'ad_hoc', label: 'Ad hoc' },
        ],
      },
      {
        key: 'leadershipConfidence',
        label: 'Leadership confidence',
        hint: 'How sure is the room?',
        kind: 'select',
        options: [
          { value: 'high', label: 'High' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'low', label: 'Low' },
          { value: 'unverified', label: 'Unverified' },
        ],
      },
    ],
  },
];

const VIEWS: Array<{ id: ViewId; n: string; label: string }> = [
  { id: 'briefing', n: '00', label: 'Briefing' },
  { id: 'evidence', n: '01', label: 'Evidence' },
  { id: 'verdict', n: '02', label: 'Verdict' },
  { id: 'map', n: '03', label: 'Ghost Map' },
  { id: 'chain', n: '04', label: 'Ghost Chain' },
  { id: 'disappear', n: '05', label: 'Disappearance' },
  { id: 'waterfall', n: '06', label: 'Waterfall' },
  { id: 'unknowns', n: '07', label: 'Unknowns' },
  { id: 'simulate', n: '08', label: 'Counterfactual' },
  { id: 'decide', n: '09', label: 'Stop / Fix / Prove' },
  { id: 'report', n: '10', label: 'Report' },
];

function money(v: number | null | undefined): string {
  return formatCurrency(v ?? null, { compact: true });
}

function WhyBlock({ trace, open, onToggle }: { trace: WhyTrace; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button type="button" className="why-btn" onClick={onToggle}>
        {open ? 'Hide WHY' : 'WHY?'}
      </button>
      {open && (
        <div className="why-panel">
          <div className="tiny" style={{ marginBottom: 8 }}>
            Evidence state · {trace.evidenceState} · confidence {trace.confidencePct}% · {trace.evidenceStrength}
          </div>
          <div className="why-grid">
            <div>
              <h4>Observed</h4>
              <ul>
                {trace.observed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Derived</h4>
              <ul>
                {trace.derived.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Commercial implication</h4>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {trace.commercialImplication}
              </p>
            </div>
            <div>
              <h4>Evidence gap</h4>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {trace.evidenceGap}
              </p>
            </div>
          </div>
          <h4 style={{ marginTop: 12 }}>What would change this?</h4>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {trace.whatWouldChangeThis}
          </p>
          {trace.oneMoreDiscovery && (
            <div className="discovery">
              <strong>{trace.oneMoreDiscovery.headline}</strong>
              <span className="muted">{trace.oneMoreDiscovery.detail}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: (typeof EVIDENCE_STEPS)[number]['fields'][number];
  value: BusinessEvidenceInputs[keyof BusinessEvidenceInputs];
  onChange: (val: BusinessEvidenceInputs[keyof BusinessEvidenceInputs]) => void;
}) {
  if (field.kind === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value as BusinessEvidenceInputs[typeof field.key])}
      >
        {field.options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  const numeric = typeof value === 'number' ? value : '';
  return (
    <input
      type="number"
      inputMode="decimal"
      placeholder="Leave blank if unknown"
      value={numeric}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') onChange(null);
        else {
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : null);
        }
      }}
    />
  );
}

export function App() {
  const persisted = loadState();
  const [inputs, setInputs] = useState<BusinessEvidenceInputs>(
    persisted?.inputs ?? SAMPLE_BUSINESS_INPUTS
  );
  const [isSample, setIsSample] = useState(persisted?.isSample ?? true);
  const [hasAnalyzed, setHasAnalyzed] = useState(persisted?.hasAnalyzed ?? true);
  const [view, setView] = useState<ViewId>(
    persisted?.hasAnalyzed ? 'verdict' : 'briefing'
  );
  const [step, setStep] = useState(0);
  const [selectedGhost, setSelectedGhost] = useState<GhostDiagnosis['id'] | null>(null);
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [controls, setControls] = useState<CounterfactualControls>(
    persisted?.controls ??
      defaultControlsFromInputs(persisted?.inputs ?? SAMPLE_BUSINESS_INPUTS)
  );

  const analysis = useMemo(() => analyzeBusiness(inputs), [inputs]);
  const counterfactual = useMemo(
    () => simulateCounterfactual(inputs, analysis, controls),
    [inputs, analysis, controls]
  );

  useEffect(() => {
    saveState({ inputs, isSample, controls, hasAnalyzed });
  }, [inputs, isSample, controls, hasAnalyzed]);

  const selected =
    analysis.ghosts.find((g) => g.id === selectedGhost) ??
    analysis.dominantGhost ??
    analysis.ghosts[0];

  function patch<K extends keyof BusinessEvidenceInputs>(key: K, val: BusinessEvidenceInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: val }));
    setIsSample(false);
  }

  function loadSample() {
    setInputs(SAMPLE_BUSINESS_INPUTS);
    setIsSample(true);
    setHasAnalyzed(true);
    setControls(defaultControlsFromInputs(SAMPLE_BUSINESS_INPUTS));
    setView('verdict');
    setSelectedGhost(null);
    setOpenWhy(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetAll() {
    setInputs(EMPTY_BUSINESS_INPUTS);
    setIsSample(false);
    setHasAnalyzed(false);
    setControls(defaultControlsFromInputs(EMPTY_BUSINESS_INPUTS));
    setView('briefing');
    setStep(0);
    setSelectedGhost(null);
    setOpenWhy(null);
    clearState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function runInvestigation() {
    setHasAnalyzed(true);
    setView('verdict');
    setControls(defaultControlsFromInputs(inputs));
    setSelectedGhost(null);
    setOpenWhy(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function go(id: ViewId) {
    if (id !== 'briefing' && id !== 'evidence' && !hasAnalyzed) {
      setView('evidence');
      return;
    }
    setView(id);
  }

  const completeness = Math.round(analysis.evidenceCompletenessPct);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" onClick={(e) => { e.preventDefault(); go('briefing'); }}>
          <span className="brand-mark">
            <img src={KC_TOKENS.logos.circle} alt="Kartik Clarity™ official circle logo" />
          </span>
          <span className="brand-name">
            Ghost Analyzer™
            <small>Kartik Clarity™ · Forensic Revenue Intelligence</small>
          </span>
        </a>
        <div className="top-actions">
          {isSample && (
            <span className="sample-pill">Sample business — demonstration data</span>
          )}
          <button type="button" className="btn" onClick={resetAll}>
            Reset
          </button>
          <button type="button" className="btn btn-ice" onClick={loadSample}>
            Load sample business
          </button>
          <button type="button" className="btn btn-primary" onClick={runInvestigation}>
            Investigate →
          </button>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Investigation sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`nav-btn ${view === v.id ? 'active' : ''}`}
            onClick={() => go(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="shell">
        <aside className="rail">
          <h2>Investigation</h2>
          <p>Every answer should open a better question. Nothing here is decorative.</p>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`nav-btn ${view === v.id ? 'active' : ''}`}
              onClick={() => go(v.id)}
            >
              <b>{v.n}</b>
              {v.label}
            </button>
          ))}
          <div className="rail-note">
            Evidence stays in this browser. Completeness {completeness}%. Ghosts are scored from patterns, not from averaging metrics.
          </div>
        </aside>

        <main className="canvas">
          {view === 'briefing' && (
            <>
              <div className="hero-grid">
                <div>
                  <div className="kicker">Kartik Clarity™ · Ghost Analyzer™</div>
                  <h1 className="page-title">Where did the revenue go?</h1>
                  <p className="lede">
                    A Revenue Ghost is commercially plausible revenue that should exist, could exist, or once appeared likely to exist — and then becomes delayed, weakened, invisible, or unmanaged. This is not a dashboard. It is a forensic reading of the commercial system behind the metrics.
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-primary" onClick={loadSample}>
                      Investigate the sample business →
                    </button>
                    <button type="button" className="btn" onClick={() => setView('evidence')}>
                      Enter our evidence
                    </button>
                  </div>
                  <p className="tiny" style={{ marginTop: 14 }}>
                    Sample business is demonstration data, not a client. Load it to see the methodology work on a complete evidence set.
                  </p>
                </div>
                <div className="logo-lockup">
                  <div className="frame">
                    <img src={KC_TOKENS.logos.rectangle} alt="Kartik Clarity™ official rectangle logo" />
                  </div>
                </div>
              </div>
              <div className="grid-3">
                <article className="stat paper">
                  <span>The question</span>
                  <strong>Show me.</strong>
                  <small>Then: why, how much, what if we fix it, what else is connected, what proof is required.</small>
                </article>
                <article className="stat paper">
                  <span>The method</span>
                  <strong>Patterns, not scores.</strong>
                  <small>High pipeline + high stale + low next-steps is not the same diagnosis as low pipeline + high win rate.</small>
                </article>
                <article className="stat paper">
                  <span>The discipline</span>
                  <strong>Observed ≠ inferred.</strong>
                  <small>Modeled scenarios are never presented as fact. Uncertainty is a feature.</small>
                </article>
              </div>
            </>
          )}

          {view === 'evidence' && (
            <>
              <div className="kicker">01 · Evidence investigation</div>
              <h1 className="page-title">Feed the system evidence.</h1>
              <p className="lede">
                Six chambers. Blank means unknown — unknown is honest. Completeness {completeness}%.
              </p>
              <div className="progress-row">
                {EVIDENCE_STEPS.map((s, i) => (
                  <i key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''} />
                ))}
              </div>
              <section className="card">
                <div className="step-head">
                  <div>
                    <div className="kicker">
                      Chamber {String(step + 1).padStart(2, '0')} / {EVIDENCE_STEPS.length}
                    </div>
                    <h2 style={{ margin: '6px 0 4px', color: 'var(--navy)' }}>{EVIDENCE_STEPS[step].title}</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      {EVIDENCE_STEPS[step].blurb}
                    </p>
                  </div>
                  {isSample && <span className="sample-pill">Demonstration data</span>}
                </div>
                <div className="fields">
                  {EVIDENCE_STEPS[step].fields.map((field) => (
                    <label key={field.key} className="field">
                      <span>
                        {field.label}
                        <span className="hint"> — {field.hint}</span>
                      </span>
                      <FieldInput
                        field={field}
                        value={inputs[field.key]}
                        onChange={(val) => patch(field.key, val as never)}
                      />
                    </label>
                  ))}
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    Previous chamber
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {step < EVIDENCE_STEPS.length - 1 ? (
                      <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
                        Next chamber →
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={runInvestigation}>
                        Run investigation →
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {view === 'verdict' && hasAnalyzed && (
            <>
              <div className="kicker">02 · Executive verdict</div>
              <h1 className="page-title">{analysis.verdict.headline}</h1>
              {isSample && <div className="sample-pill" style={{ marginBottom: 16 }}>Sample business — demonstration data</div>}
              <div className="banner" style={{ ['--p' as string]: `${analysis.verdict.overallConfidencePct}%` }}>
                <div>
                  <div className="kicker" style={{ color: 'var(--ice)' }}>{analysis.verdict.concentrationType}</div>
                  <h2>{analysis.verdict.concentrationRationale}</h2>
                  <p>{analysis.verdict.whatIsHappening}</p>
                </div>
                <div className="confidence-ring" title="Overall evidence confidence">
                  <span>{analysis.verdict.overallConfidencePct}%</span>
                </div>
              </div>
              <div className="grid-2" style={{ marginTop: 16 }}>
                <article className="card">
                  <div className="kicker">Where</div>
                  <h3 style={{ color: 'var(--navy)' }}>{analysis.verdict.whereItIsHappening}</h3>
                  <p className="muted">{analysis.verdict.howStrongIsEvidence}</p>
                  <WhyBlock trace={analysis.verdict.why} open={openWhy === 'verdict'} onToggle={() => setOpenWhy(openWhy === 'verdict' ? null : 'verdict')} />
                </article>
                <article className="card">
                  <div className="kicker">Financial meaning</div>
                  <p>{analysis.verdict.financialMeaning}</p>
                  <p><strong>Do now:</strong> {analysis.verdict.whatManagementShouldDoNow}</p>
                </article>
              </div>
              <div className="grid-4" style={{ marginTop: 16 }}>
                <article className="stat">
                  <span>Modeled growth</span>
                  <strong>{formatPct(analysis.derivedMetrics.realizedGrowthPct, 1)}</strong>
                  <small>vs target {formatPct(inputs.growthTargetPct, 0)}</small>
                </article>
                <article className="stat">
                  <span>NRR</span>
                  <strong>{formatPct(analysis.derivedMetrics.netRevenueRetentionPct, 0)}</strong>
                  <small>Installed base</small>
                </article>
                <article className="stat">
                  <span>Credible pipeline</span>
                  <strong>{money(analysis.derivedMetrics.crediblePipelineDollars)}</strong>
                  <small>of {money(inputs.pipelineValue)} stated</small>
                </article>
                <article className="stat">
                  <span>Target shortfall</span>
                  <strong>{money(analysis.derivedMetrics.growthTargetShortfallDollars)}</strong>
                  <small>MODELED 12-month gap</small>
                </article>
              </div>
            </>
          )}

          {view === 'map' && hasAnalyzed && selected && (
            <>
              <div className="section-title">
                <div>
                  <div className="kicker">03 · Ghost Map</div>
                  <h2>Demand → Expansion. Select a Ghost.</h2>
                </div>
              </div>
              <div className="ghost-map">
                {analysis.ghostMapStages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    className={`ghost-node ${stage.isDisappearancePoint ? 'disappear' : ''} ${
                      selected.stage === stage.id ? 'selected' : ''
                    }`}
                    onClick={() => {
                      const g = stage.ghosts[0] ?? analysis.ghosts.find((x) => x.stage === stage.id);
                      if (g) setSelectedGhost(g.id);
                    }}
                  >
                    <span className="stage">{stage.shortName}</span>
                    <strong>{stage.name}</strong>
                    <span className={`sev ${stage.status}`}>{stage.status}</span>
                    <span className="vol">{stage.volumeLabel}</span>
                    {stage.isDisappearancePoint && <span className="tiny">Disappearance point</span>}
                  </button>
                ))}
              </div>
              <div className="legend">
                <span><i className="sev healthy">healthy</i> evidence supports health</span>
                <span><i className="sev watch">watch</i> friction, not yet dominant</span>
                <span><i className="sev material">material</i> commercially significant</span>
                <span><i className="sev critical">critical</i> threatens the target</span>
              </div>
              <section className="card" style={{ marginTop: 16 }}>
                <div className="step-head">
                  <div>
                    <div className="kicker">{selected.stageLabel} · {selected.evidenceState}</div>
                    <h2 style={{ margin: '6px 0' }}>{selected.name}</h2>
                    <p className="muted">{selected.patternSummary}</p>
                  </div>
                  <span className={`sev ${selected.severityLevel}`}>{selected.severityLevel}</span>
                </div>
                <div className="grid-3">
                  <article className="stat paper">
                    <span>Exposure</span>
                    <strong>{money(selected.economicExposure)}</strong>
                    <small>Not additive across Ghosts</small>
                  </article>
                  <article className="stat paper">
                    <span>Confidence</span>
                    <strong>{selected.confidencePct}%</strong>
                    <small>{selected.evidenceState}</small>
                  </article>
                  <article className="stat paper">
                    <span>Supporting signal</span>
                    <strong style={{ fontSize: 14, fontWeight: 700 }}>{selected.supportingSignal}</strong>
                    <small>{selected.mechanism}</small>
                  </article>
                </div>
                <div style={{ marginTop: 12 }}>
                  <WhyBlock
                    trace={selected.why}
                    open={openWhy === selected.id}
                    onToggle={() => setOpenWhy(openWhy === selected.id ? null : selected.id)}
                  />
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {analysis.ghosts.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`btn ${g.id === selected.id ? 'btn-primary' : ''}`}
                      onClick={() => setSelectedGhost(g.id)}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {view === 'chain' && hasAnalyzed && (
            <>
              <div className="kicker">04 · Ghost Chain</div>
              <h1 className="page-title">Compound friction, not a list of problems.</h1>
              <p className="lede">
                Links are established only when both Ghosts are evidenced and a transmission mechanism is commercially defensible. {analysis.ghostChainLinks.length} link{analysis.ghostChainLinks.length === 1 ? '' : 's'} currently supported.
              </p>
              <div className="chain">
                {analysis.ghostChainLinks.length === 0 && (
                  <div className="card muted">No evidenced transmission between Ghosts. That is a finding: problems, if any, are not compounding in the data you entered.</div>
                )}
                {analysis.ghostChainLinks.map((link) => (
                  <article key={link.id} className="chain-link">
                    <div className="chain-from">
                      {link.fromGhostName}
                      <div className="tiny">{link.evidenceState} · strength {link.evidenceStrengthPct}%</div>
                    </div>
                    <div className="chain-arrow">↓</div>
                    <div className="chain-body">
                      <b>{link.toGhostName}</b>
                      {link.transmissionMechanism}
                      <div className="tiny" style={{ marginTop: 6 }}>{link.compoundImpactLabel}</div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {view === 'disappear' && hasAnalyzed && (
            <>
              <div className="kicker">05 · Revenue Disappearance Point</div>
              <h1 className="page-title">{analysis.disappearancePoint.headline}</h1>
              <p className="lede">{analysis.disappearancePoint.narrative}</p>
              <div className="waterfall">
                {analysis.disappearancePoint.nodes.map((node) => (
                  <div key={node.id} className={`wf-row ${node.isPrimaryDisappearancePoint ? 'primary' : ''}`}>
                    <div>
                      <strong>{node.label}</strong>
                      <div className="tiny">{node.evidenceState}{node.isPrimaryDisappearancePoint ? ' · PRIMARY' : ''}</div>
                    </div>
                    <div className="wf-bar-track">
                      <div
                        className="wf-bar"
                        style={{
                          width: `${Math.max(4, Math.min(100, node.credibilityRetentionPct ?? (node.dollarAmount ? 50 : 4)))}%`,
                        }}
                      />
                    </div>
                    <div className="wf-meta">
                      <b>{money(node.dollarAmount)}</b>
                      {node.dropFromPreviousPct !== null ? `Drop ${formatPct(node.dropFromPreviousPct, 0)}` : 'Anchor'}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <WhyBlock
                  trace={analysis.disappearancePoint.why}
                  open={openWhy === 'disappear'}
                  onToggle={() => setOpenWhy(openWhy === 'disappear' ? null : 'disappear')}
                />
              </div>
              <p className="tiny" style={{ marginTop: 12 }}>
                Credible Pipeline is a stock. Other nodes are annualized flows. They are shown together because that is how executives actually think — and they are labeled so they are not silently mixed.
              </p>
            </>
          )}

          {view === 'waterfall' && hasAnalyzed && (
            <>
              <div className="kicker">06 · Revenue waterfall</div>
              <h1 className="page-title">Every number has provenance.</h1>
              {analysis.waterfall.map((step) => (
                <article key={step.id} className="card">
                  <div className="step-head">
                    <div>
                      <div className="kicker">{step.evidenceState} · {step.stepType}</div>
                      <h3 style={{ margin: '6px 0', color: 'var(--navy)' }}>{step.label}</h3>
                      <p className="muted" style={{ margin: 0 }}>{step.sublabel}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)' }}>{money(step.amount)}</div>
                      <div className="tiny">{step.deltaFromPrior !== null ? `Δ ${money(step.deltaFromPrior)}` : 'Anchor'}</div>
                    </div>
                  </div>
                  <p className="tiny">{step.formulaText} — {step.provenanceNote}</p>
                  <WhyBlock
                    trace={step.why}
                    open={openWhy === step.id}
                    onToggle={() => setOpenWhy(openWhy === step.id ? null : step.id)}
                  />
                </article>
              ))}
            </>
          )}

          {view === 'unknowns' && hasAnalyzed && (
            <>
              <div className="kicker">07 · What we still don’t know</div>
              <h1 className="page-title">Uncertainty is part of the diagnosis.</h1>
              <p className="lede">Missing evidence is not poor performance. It is a confidence ceiling.</p>
              {analysis.unknowns.map((u) => (
                <article key={u.id} className="unknown">
                  <div className="tiny">{u.category} · {u.status}</div>
                  <h3>{u.title}</h3>
                  <p className="muted">{u.currentImpactOnConfidence}</p>
                  <p><strong>What would change the diagnosis:</strong> {u.whatWouldChangeDiagnosis}</p>
                  <p className="tiny">Proof required: {u.proofRequired}</p>
                </article>
              ))}
              <section className="card" style={{ marginTop: 16 }}>
                <h2 style={{ color: 'var(--navy)' }}>Executive scorecard</h2>
                <p className="tiny">Healthy dimensions remain visibly healthy. This is inverted Ghost severity, not a second invented model.</p>
                <table className="score-table">
                  <thead>
                    <tr>
                      <th>Dimension</th>
                      <th>Reading</th>
                      <th>Score</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.scorecard.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.name}</strong>
                          <div className="tiny">{row.evidenceState}</div>
                        </td>
                        <td>
                          {row.headlineMetric}
                          <div className="tiny">{row.summary}</div>
                        </td>
                        <td>
                          <span className={`sev ${row.status === 'HEALTHY' ? 'healthy' : row.status === 'WATCH' ? 'watch' : row.status === 'CRITICAL' ? 'critical' : 'material'}`}>
                            {row.status}
                          </span>
                        </td>
                        <td>
                          <div className="meter">
                            <i style={{ width: `${row.score ?? 0}%` }} />
                          </div>
                          <div className="tiny">{row.score === null ? 'UNVERIFIED' : `${row.score}/100`}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {view === 'simulate' && hasAnalyzed && (
            <>
              <div className="kicker">08 · Counterfactual revenue engine</div>
              <h1 className="page-title">What if we change the system?</h1>
              <p className="lede">
                MODELED SCENARIO — NOT A FORECAST. Levers move current-state arithmetic. They do not promise customers, close dates, or markets.
              </p>
              <section className="card">
                <div className="sliders">
                  {(
                    [
                      ['winRatePct', 'Win rate', 0, 80, '%'],
                      ['stalePipelinePct', 'Stale pipeline', 0, 100, '%'],
                      ['salesCycleDays', 'Sales cycle', 14, 400, 'd'],
                      ['annualChurnPct', 'Annual churn', 0, 80, '%'],
                      ['discountPct', 'Discount', 0, 80, '%'],
                      ['expansionPct', 'Expansion', 0, 60, '%'],
                      ['forecastAccuracyPct', 'Forecast accuracy', 0, 100, '%'],
                    ] as Array<[keyof CounterfactualControls, string, number, number, string]>
                  ).map(([key, label, min, max, unit]) => (
                    <div className="slider-row" key={key}>
                      <label>{label}</label>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={controls[key]}
                        onChange={(e) => setControls((c) => ({ ...c, [key]: Number(e.target.value) }))}
                      />
                      <strong>
                        {Math.round(controls[key])}
                        {unit}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="compare">
                  <article className="stat paper">
                    <span>Current state</span>
                    <strong>{money(counterfactual.currentEndingArr)}</strong>
                    <small>Modeled ending ARR</small>
                  </article>
                  <article className="stat paper">
                    <span>Counterfactual</span>
                    <strong>{money(counterfactual.modeledEndingArr)}</strong>
                    <small>Modeled ending ARR</small>
                  </article>
                  <article className="stat">
                    <span>Modeled difference</span>
                    <strong>{money(counterfactual.modeledArrDelta)}</strong>
                    <small>NOT A FORECAST</small>
                  </article>
                </div>
              </section>
              <div className="section-title"><h2>If nothing changes</h2></div>
              <section className="card">
                <p>{counterfactual.ifNothingChanges.narrative}</p>
                <div className="grid-3">
                  <article className="stat paper">
                    <span>Year 1 ending</span>
                    <strong>{money(counterfactual.ifNothingChanges.year1EndingArr)}</strong>
                  </article>
                  <article className="stat paper">
                    <span>Year 2 ending</span>
                    <strong>{money(counterfactual.ifNothingChanges.year2EndingArr)}</strong>
                  </article>
                  <article className="stat paper">
                    <span>24-mo target gap</span>
                    <strong>{money(counterfactual.ifNothingChanges.cumulativeTargetGap24Mo)}</strong>
                  </article>
                </div>
              </section>
              <div className="section-title"><h2>If we fix the highest-leverage Ghost</h2></div>
              <section className="card">
                <p>{counterfactual.ifHighestLeverageFixed.narrative}</p>
                <div className="grid-3">
                  <article className="stat paper">
                    <span>Ghost</span>
                    <strong style={{ fontSize: 18 }}>{counterfactual.ifHighestLeverageFixed.highestLeverageGhostName}</strong>
                  </article>
                  <article className="stat paper">
                    <span>Year-1 modeled delta</span>
                    <strong>{money(counterfactual.ifHighestLeverageFixed.year1RecoveredDelta)}</strong>
                  </article>
                  <article className="stat paper">
                    <span>Year-2 modeled delta</span>
                    <strong>{money(counterfactual.ifHighestLeverageFixed.year2RecoveredDelta)}</strong>
                  </article>
                </div>
              </section>
              {counterfactual.secondOrderEffects.length > 0 && (
                <>
                  <div className="section-title"><h2>Second-order effects</h2></div>
                  {counterfactual.secondOrderEffects.map((fx) => (
                    <article key={fx.id} className="unknown">
                      <div className="tiny">{fx.triggerLever} → {fx.affectedDimension}</div>
                      <h3>{fx.deltaLabel}</h3>
                      <p className="muted">{fx.mathematicalBasis}</p>
                      <p className="tiny">{fx.currentValueLabel} → {fx.modeledValueLabel}</p>
                    </article>
                  ))}
                </>
              )}
              <div className="section-title"><h2>Where improvement has leverage</h2></div>
              <section className="card">
                <table className="score-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Lever</th>
                      <th>Unit</th>
                      <th>Modeled year-1 ARR impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counterfactual.leverSensitivityRanking.map((row) => (
                      <tr key={row.leverId}>
                        <td>{row.rank}</td>
                        <td>
                          <strong>{row.label}</strong>
                          <div className="tiny">{row.rationale}</div>
                        </td>
                        <td>{row.unitImprovementLabel}</td>
                        <td>{money(row.modeledAnnualImpact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {view === 'decide' && hasAnalyzed && (
            <>
              <div className="kicker">09 · Management decision system</div>
              <h1 className="page-title">Stop. Fix. Prove.</h1>
              <p className="lede">
                Prioritized by commercial materiality × evidence confidence × leverage — not by which metric looks reddest.
              </p>
              <section className="card">
                {analysis.decisions.map((item) => (
                  <div key={item.id} className="decision">
                    <div className={item.category === 'STOP' ? 'tag-stop' : item.category === 'FIX' ? 'tag-fix' : 'tag-prove'}>
                      {item.category}
                    </div>
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted">{item.rationale}</p>
                      <div className="tiny">
                        {item.targetStage} · priority {item.priorityIndex} · modeled impact {money(item.modeledImpactDollars)}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}

          {view === 'report' && hasAnalyzed && (
            <>
              <div className="kicker">10 · Executive report</div>
              <h1 className="page-title">Ghost Analyzer™ · Investigation report</h1>
              {isSample && <div className="sample-pill" style={{ marginBottom: 12 }}>Sample business — demonstration data</div>}
              <p className="tiny">Use the browser print dialog for a PDF. This report is decision support based on evidence entered in this browser. It is not an audited financial statement.</p>
              <div style={{ margin: '12px 0' }}>
                <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                  Print / save PDF
                </button>
              </div>
              <section className="card">
                <img src={KC_TOKENS.logos.rectangle} alt="Kartik Clarity™" style={{ maxWidth: 360, marginBottom: 12 }} />
                <div className="kicker">Executive verdict</div>
                <h2 style={{ color: 'var(--navy)' }}>{analysis.verdict.headline}</h2>
                <p>{analysis.verdict.whatIsHappening}</p>
                <p><strong>Where:</strong> {analysis.verdict.whereItIsHappening}</p>
                <p><strong>Evidence:</strong> {analysis.verdict.howStrongIsEvidence}</p>
                <p><strong>Financial meaning:</strong> {analysis.verdict.financialMeaning}</p>
                <p><strong>Do now:</strong> {analysis.verdict.whatManagementShouldDoNow}</p>
              </section>
              <section className="card">
                <h3>Dominant Ghost</h3>
                <p>{analysis.dominantGhost ? `${analysis.dominantGhost.name} — ${analysis.dominantGhost.patternSummary}` : 'None named.'}</p>
                <h3>Revenue Disappearance Point</h3>
                <p>{analysis.disappearancePoint.narrative}</p>
                <h3>Ghost Chain</h3>
                <ul>
                  {analysis.ghostChainLinks.map((l) => (
                    <li key={l.id}>
                      {l.fromGhostName} → {l.toGhostName}: {l.compoundImpactLabel}
                    </li>
                  ))}
                </ul>
                <h3>If nothing changes</h3>
                <p>{counterfactual.ifNothingChanges.narrative}</p>
                <h3>If we fix the highest-leverage Ghost</h3>
                <p>{counterfactual.ifHighestLeverageFixed.narrative}</p>
                <h3>STOP / FIX / PROVE</h3>
                <ol>
                  {analysis.decisions.map((d) => (
                    <li key={d.id}>
                      <strong>{d.category}.</strong> {d.title}
                    </li>
                  ))}
                </ol>
                <h3>Next evidence to collect</h3>
                <ul>
                  {analysis.unknowns.map((u) => (
                    <li key={u.id}>
                      {u.title} — {u.proofRequired}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {!hasAnalyzed && view !== 'briefing' && view !== 'evidence' && (
            <section className="card">
              <h2>No investigation yet</h2>
              <p className="muted">Enter evidence or load the sample business first.</p>
              <button type="button" className="btn btn-primary" onClick={loadSample}>
                Load sample business
              </button>
            </section>
          )}
        </main>
      </div>

      <footer className="footer">
        <img src={KC_TOKENS.logos.circle} alt="" />
        <div>
          <strong>Kartik Clarity™</strong>
          <div>Think. Focus. Achieve. · Ghost Analyzer™</div>
        </div>
        <div className="push">Inputs never leave this browser.</div>
      </footer>
    </div>
  );
}
