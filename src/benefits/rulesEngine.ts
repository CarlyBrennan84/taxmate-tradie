import type {
  ApprenticeProfile,
  BenefitAssessment,
  BenefitProgram,
  EligibilityRule,
  EligibilityRuleGroup,
  MatchStatus,
} from "./types";

/**
 * Deterministic eligibility rules engine.
 *
 * This is the ONLY code allowed to decide a MatchStatus. The AI assistant
 * layer (built in a later phase) is only ever allowed to read the output of
 * assessProgram()/assessAllPrograms() and turn it into plain English — it
 * must never compute, override, or upgrade a status itself. Keeping that
 * boundary here (one pure, testable function) is what makes that guarantee
 * auditable.
 *
 * Bump RULES_VERSION whenever the *logic* below changes materially, so a
 * stored BenefitAssessment can be told apart from one produced by an older
 * version of this engine.
 */
export const RULES_VERSION = "1.0.0";

type RuleOutcome = "pass" | "fail" | "unknown";

interface GroupEvaluation {
  outcome: RuleOutcome;
  matched: EligibilityRule[];
  unmatched: EligibilityRule[];
  unknown: EligibilityRule[];
  /** True if this group contains at least one rule marked required — i.e.
   *  the group represents a condition the program treats as mandatory. */
  isMandatory: boolean;
}

function getFieldValue(profile: ApprenticeProfile, field: string): unknown {
  return (profile as unknown as Record<string, unknown>)[field];
}

/** "prefer_not_to_say" is a real, explicit answer — but for rule purposes
 *  it carries the same meaning as not having answered: we don't know. */
function isUnknownValue(v: unknown): boolean {
  return v === undefined || v === null || v === "prefer_not_to_say";
}

function evaluateRule(rule: EligibilityRule, profile: ApprenticeProfile): RuleOutcome {
  const raw = getFieldValue(profile, rule.field);

  if (rule.operator === "exists") {
    return isUnknownValue(raw) ? "fail" : "pass";
  }
  if (isUnknownValue(raw)) return "unknown";

  switch (rule.operator) {
    case "equals":
      return raw === rule.value ? "pass" : "fail";
    case "not_equals":
      return raw !== rule.value ? "pass" : "fail";
    case "in":
      return Array.isArray(rule.value) && (rule.value as unknown[]).includes(raw) ? "pass" : "fail";
    case "not_in":
      return Array.isArray(rule.value) && !(rule.value as unknown[]).includes(raw) ? "pass" : "fail";
    case "greater_than":
      return typeof raw === "number" && typeof rule.value === "number" && raw > rule.value ? "pass" : "fail";
    case "greater_than_or_equal":
      return typeof raw === "number" && typeof rule.value === "number" && raw >= rule.value ? "pass" : "fail";
    case "less_than":
      return typeof raw === "number" && typeof rule.value === "number" && raw < rule.value ? "pass" : "fail";
    case "less_than_or_equal":
      return typeof raw === "number" && typeof rule.value === "number" && raw <= rule.value ? "pass" : "fail";
    case "between": {
      if (!Array.isArray(rule.value) || rule.value.length !== 2 || typeof raw !== "number") return "fail";
      const [lo, hi] = rule.value as [number, number];
      return raw >= lo && raw <= hi ? "pass" : "fail";
    }
    case "contains":
      return typeof raw === "string" && typeof rule.value === "string" && raw.toLowerCase().includes(rule.value.toLowerCase())
        ? "pass"
        : "fail";
    // yyyy-mm-dd strings compare lexicographically the same as chronologically.
    case "date_before":
      return typeof raw === "string" && typeof rule.value === "string" && raw < rule.value ? "pass" : "fail";
    case "date_after":
      return typeof raw === "string" && typeof rule.value === "string" && raw > rule.value ? "pass" : "fail";
    default:
      return "unknown";
  }
}

function evaluateGroup(group: EligibilityRuleGroup, profile: ApprenticeProfile): GroupEvaluation {
  const matched: EligibilityRule[] = [];
  const unmatched: EligibilityRule[] = [];
  const unknown: EligibilityRule[] = [];

  for (const rule of group.rules) {
    const result = evaluateRule(rule, profile);
    if (result === "pass") matched.push(rule);
    else if (result === "fail") unmatched.push(rule);
    else unknown.push(rule);
  }

  let outcome: RuleOutcome;
  if (group.type === "all") {
    outcome = unmatched.length > 0 ? "fail" : unknown.length > 0 ? "unknown" : "pass";
  } else {
    outcome = matched.length > 0 ? "pass" : unknown.length > 0 ? "unknown" : "fail";
  }

  return { outcome, matched, unmatched, unknown, isMandatory: group.rules.some((r) => r.required) };
}

/** A rule is treated as a future-milestone gate (rather than a plain
 *  failure) when it compares a date/apprenticeship-year field forward in
 *  time. This lets a mandatory-but-not-yet-reached condition surface as
 *  "upcoming" instead of "not matched", without needing a separate schema
 *  field — it's inferred from the rule's own field/operator. */
function isMilestoneGateRule(rule: EligibilityRule): boolean {
  return rule.operator === "date_after" || (rule.field === "apprenticeshipYear" && (rule.operator === "greater_than_or_equal" || rule.operator === "greater_than"));
}

function isProgramClosed(program: BenefitProgram, todayISO: string): boolean {
  if (!program.active) return true;
  if (program.supersededBy) return true;
  if (program.effectiveTo && program.effectiveTo < todayISO) return true;
  return false;
}

function freshnessWarning(program: BenefitProgram, todayISO: string): string | undefined {
  if (program.nextReviewAt && program.nextReviewAt < todayISO) {
    return "Program details may have changed since this record was last checked. Verify the current rules before applying.";
  }
  if (program.effectiveFrom > todayISO) {
    return `This program is scheduled to take effect from ${program.effectiveFrom} and may not be assessable yet.`;
  }
  return undefined;
}

export function assessProgram(program: BenefitProgram, profile: ApprenticeProfile, now: Date = new Date()): BenefitAssessment {
  const assessedAt = now.toISOString();
  const todayISO = assessedAt.slice(0, 10);
  const warning = freshnessWarning(program, todayISO);

  if (isProgramClosed(program, todayISO)) {
    return {
      programId: program.id,
      status: "closed",
      score: 0,
      matchedRules: [],
      unmatchedRules: [],
      unknownRules: [],
      explanation: program.supersededBy
        ? `This program has been superseded by a newer scheme (${program.supersededBy}).`
        : "This program is not currently active.",
      missingInformation: [],
      assessedAt,
      rulesVersion: RULES_VERSION,
      freshnessWarning: warning,
    };
  }

  const groups = program.eligibilityRules.map((g) => evaluateGroup(g, profile));
  const exclusionGroups = (program.exclusionRules || []).map((g) => evaluateGroup(g, profile));

  const matchedRules = groups.flatMap((g) => g.matched.map((r) => r.id));
  const unmatchedRules = groups.flatMap((g) => g.unmatched.map((r) => r.id));
  const unknownRules = groups.flatMap((g) => g.unknown.map((r) => r.id));

  const totalRules = groups.reduce((s, g) => s + g.matched.length + g.unmatched.length + g.unknown.length, 0);
  const weightedMatched = groups.reduce((s, g) => s + g.matched.reduce((ws, r) => ws + (r.weight ?? 1), 0), 0);
  const totalWeight = groups.reduce(
    (s, g) => s + [...g.matched, ...g.unmatched, ...g.unknown].reduce((ws, r) => ws + (r.weight ?? 1), 0),
    0
  );
  const score = totalRules === 0 ? 0 : totalWeight === 0 ? 0 : Math.round((weightedMatched / totalWeight) * 100) / 100;

  const exclusionApplies = exclusionGroups.some((g) => g.outcome === "pass");
  const exclusionUncertain = exclusionGroups.some((g) => g.outcome === "unknown");

  const mandatoryGroups = groups.filter((g) => g.isMandatory);
  const optionalGroups = groups.filter((g) => !g.isMandatory);

  const failedMandatory = mandatoryGroups.filter((g) => g.outcome === "fail");
  const unknownMandatory = mandatoryGroups.filter((g) => g.outcome === "unknown");
  const uncertainOptional = optionalGroups.filter((g) => g.outcome !== "pass");

  const explanationParts: string[] = [];
  const missingInformation: string[] = [];
  for (const g of groups) {
    for (const r of g.matched) explanationParts.push(`Matched: ${r.explanation}`);
  }

  let status: MatchStatus;

  if (exclusionApplies) {
    status = "not_matched";
    const failed = exclusionGroups.find((g) => g.outcome === "pass");
    explanationParts.push(...(failed?.matched.map((r) => `Excluded: ${r.explanation}`) ?? []));
  } else if (failedMandatory.length > 0) {
    // A mandatory condition clearly fails — unless every failure is really
    // "not reached yet" (a future milestone), in which case this is a
    // scheduling gap, not a rejection.
    const allFailuresAreMilestoneGates = failedMandatory.every((g) => g.unmatched.every(isMilestoneGateRule));
    status = allFailuresAreMilestoneGates && program.milestoneRules && program.milestoneRules.length > 0 ? "upcoming" : "not_matched";
    for (const g of failedMandatory) for (const r of g.unmatched) explanationParts.push(`${status === "upcoming" ? "Not yet reached" : "Does not match"}: ${r.explanation}`);
  } else if (unknownMandatory.length > 0) {
    status = "more_information_needed";
    for (const g of unknownMandatory) for (const r of g.unknown) missingInformation.push(r.explanation);
  } else if (exclusionUncertain) {
    status = "possible_match";
    missingInformation.push("Whether an exclusion condition applies could not be confirmed from your answers yet.");
  } else if (uncertainOptional.length > 0) {
    status = "possible_match";
    for (const g of uncertainOptional) {
      for (const r of g.unknown) missingInformation.push(r.explanation);
      for (const r of g.unmatched) explanationParts.push(`Does not currently match: ${r.explanation}`);
    }
  } else {
    status = "strong_match";
  }

  // Employer-only programs get their own label rather than being presented
  // as something the apprentice personally qualifies for.
  if (program.employerFacing && !program.apprenticeFacing && (status === "strong_match" || status === "possible_match")) {
    status = "employer_may_qualify";
  }

  const explanation = explanationParts.length > 0 ? explanationParts.join(" ") : "Not enough information to assess this program yet.";

  return {
    programId: program.id,
    status,
    score,
    matchedRules,
    unmatchedRules,
    unknownRules,
    explanation,
    missingInformation,
    assessedAt,
    rulesVersion: RULES_VERSION,
    freshnessWarning: warning,
  };
}

export function assessAllPrograms(programs: BenefitProgram[], profile: ApprenticeProfile, now: Date = new Date()): BenefitAssessment[] {
  return programs.map((p) => assessProgram(p, profile, now));
}
