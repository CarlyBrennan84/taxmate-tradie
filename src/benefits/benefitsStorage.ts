import type { ApprenticeProfile, BenefitsProfileData, SavedBenefit } from "./types";

/**
 * Local-storage persistence for the Benefits Finder, kept deliberately
 * separate from the main Supabase-backed AppData store. This holds
 * sensitive questionnaire answers (residency, health, income band, etc.) —
 * per the privacy requirements for this feature, it stays local-only for
 * this first version rather than syncing to any backend, and every field
 * in it must be user-deletable on demand.
 */

const STORAGE_KEY = "taxmate-benefits-profile";

const EMPTY: BenefitsProfileData = { answers: {}, savedBenefits: [] };

export function loadBenefitsProfile(): BenefitsProfileData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, answers: {}, savedBenefits: [] };
    const parsed = JSON.parse(raw) as Partial<BenefitsProfileData>;
    return {
      answers: parsed.answers || {},
      lastCheckedAt: parsed.lastCheckedAt,
      savedBenefits: Array.isArray(parsed.savedBenefits) ? parsed.savedBenefits : [],
    };
  } catch (e) {
    console.error("Failed to load benefits profile", e);
    return { ...EMPTY, answers: {}, savedBenefits: [] };
  }
}

function persist(data: BenefitsProfileData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save benefits profile", e);
  }
}

export function saveBenefitsAnswers(answers: ApprenticeProfile): BenefitsProfileData {
  const current = loadBenefitsProfile();
  const updated: BenefitsProfileData = { ...current, answers, lastCheckedAt: new Date().toISOString() };
  persist(updated);
  return updated;
}

export function saveBenefitPlanItem(item: SavedBenefit): BenefitsProfileData {
  const current = loadBenefitsProfile();
  const withoutExisting = current.savedBenefits.filter((b) => b.programId !== item.programId);
  const updated: BenefitsProfileData = { ...current, savedBenefits: [item, ...withoutExisting] };
  persist(updated);
  return updated;
}

export function removeBenefitPlanItem(programId: string): BenefitsProfileData {
  const current = loadBenefitsProfile();
  const updated: BenefitsProfileData = { ...current, savedBenefits: current.savedBenefits.filter((b) => b.programId !== programId) };
  persist(updated);
  return updated;
}

/** Clears one answer field — used by "delete this answer" affordances on
 *  sensitive questions, without wiping the whole profile. */
export function deleteBenefitsAnswer(field: keyof ApprenticeProfile): BenefitsProfileData {
  const current = loadBenefitsProfile();
  const answers = { ...current.answers };
  delete answers[field];
  const updated: BenefitsProfileData = { ...current, answers };
  persist(updated);
  return updated;
}

/** "Delete benefits profile" — wipes everything (answers + saved plan). */
export function deleteBenefitsProfile(): BenefitsProfileData {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to delete benefits profile", e);
  }
  return { answers: {}, savedBenefits: [] };
}

/** "Download my benefits data" — returns a JSON string ready to save as a file. */
export function exportBenefitsData(): string {
  return JSON.stringify(loadBenefitsProfile(), null, 2);
}
