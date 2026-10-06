# Ghost Analyzer™

**Kartik Clarity™ · Forensic Revenue Intelligence**

Ghost Analyzer™ detects hidden revenue loss from customers, deals, opportunities, and accounts that quietly disappear without being counted as churn. It reveals where revenue is going silent, estimates financial exposure, identifies the likely causes, and shows what to fix first.

Live: https://kartikr222.github.io/Ghost-Analyzer/

## What this is

Not a dashboard. A forensic investigation of the commercial system behind the metrics.

A **Revenue Ghost** is commercially plausible revenue that should exist, could exist, or once appeared likely to exist — and then becomes delayed, weakened, invisible, unmanaged, or unreliable.

The product moves the operator through:

**Curious → Investigating → Surprised → Concerned → Understanding → Testing → Convinced → Ready to act**

## What it does

- Progressive **evidence investigation** (not one giant form)
- Pattern-based **Ghost diagnoses** across 12 commercial dimensions
- **Ghost Map** of Demand → Expansion
- **Ghost Chain** (compound friction, only when evidence supports it)
- **Revenue Disappearance Point**
- Provenance-labeled **Revenue Waterfall**
- **WHY?** traces: Observed / Derived / Implication / Confidence / Evidence gap
- **What we still don’t know**
- **Counterfactual engine** (MODELED SCENARIO — NOT A FORECAST)
- **If nothing changes** vs **If we fix the highest-leverage Ghost**
- **STOP / FIX / PROVE**
- Printable executive report

Nothing leaves the browser. There is no backend, no authentication, and no API key.

## Local development

```bash
npm install
npm test
npm run dev
```

Production build (also syncs a GitHub Pages static bundle to `/` and `/docs`):

```bash
npm run build
```

## GitHub Pages

The site is a static single-page application.

- Official Kartik Clarity™ logo assets live in `public/assets/` and are copied into `assets/` on build.
- `base: './'` so the app works at `https://kartikr222.github.io/Ghost-Analyzer/`.
- `.nojekyll` is included so GitHub Pages does not process the bundle.

## Brand

Colors, logos, and visual language are taken from the official Kartik Clarity™ circle and rectangle logo assets. No generic dashboard palette.

Think. Focus. Achieve.
