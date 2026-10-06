import type { BusinessEvidenceInputs, CounterfactualControls } from './engine/types';
import { EMPTY_BUSINESS_INPUTS } from './engine/presets';

const KEY = 'kartik-clarity.ghost-analyzer.v2';

export interface PersistedState {
  inputs: BusinessEvidenceInputs;
  isSample: boolean;
  controls: CounterfactualControls | null;
  hasAnalyzed: boolean;
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || typeof parsed !== 'object' || !parsed.inputs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — investigation still runs in memory */
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function mergeInputs(partial: Partial<BusinessEvidenceInputs>): BusinessEvidenceInputs {
  return { ...EMPTY_BUSINESS_INPUTS, ...partial };
}
