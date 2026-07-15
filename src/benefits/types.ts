/**
 * Benefits Finder — data model.
 *
 * The rules engine (rulesEngine.ts) is the only thing allowed to decide a
 * MatchStatus. Nothing in the UI or AI layer should ever assign eligibility
 * directly — see rulesEngine.ts for why.
 */

export type Jurisdiction = "Commonwealth" | "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA";

export type MatchStatus =
  | "strong_match"
  | "possible_match"
  | "more_information_needed"
  | "employer_may_qualify"
  | "upcoming"
  | "not_matched"
  | "closed";

export type SupportType =
  | "payment"
  | "loan"
  | "concession"
  | "training_subsidy"
  | "allowance"
  | "reimbursement"
  | "service"
  | "employer_incentive";

export type RuleOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "between"
  | "contains"
  | "exists"
  | "date_before"
  | "date_after";

export interface EligibilityRule {
  id: string;
  /** Field name on ApprenticeProfile this rule reads. Kept as a plain string
   *  (not keyof ApprenticeProfile) so program records stay pure data — the
   *  eventual goal is these come from a CMS/admin source, not app code. */
  field: string;
  operator: RuleOperator;
  value?: unknown;
  /** If true, this rule failing/being unknown blocks a strong match. If
   *  false, it can be uncertain and the program still comes back "possible". */
  required: boolean;
  weight?: number;
  explanation: string;
  sourceReference?: string;
}

export interface EligibilityRuleGroup {
  type: "all" | "any";
  rules: EligibilityRule[];
}

export interface MilestoneRule {
  milestone: "commencement" | "6_months" | "12_months" | "18_months" | "24_months" | "36_months" | "completion";
  description: string;
  potentialPayment?: number;
}

export interface BenefitProgram {
  id: string;
  name: string;
  shortName?: string;
  description: string;
  administeringAgency: string;
  jurisdiction: Jurisdiction;
  supportType: SupportType;

  officialSourceUrl: string;
  applicationUrl?: string;

  effectiveFrom: string;
  effectiveTo?: string;
  lastVerifiedAt: string;
  nextReviewAt: string;

  active: boolean;
  supersededBy?: string;

  paymentAmountText?: string;
  maximumValue?: number;
  frequency?: string;
  taxable?: boolean;
  repayable?: boolean;

  apprenticeFacing: boolean;
  employerFacing: boolean;

  eligibilityRules: EligibilityRuleGroup[];
  exclusionRules?: EligibilityRuleGroup[];
  evidenceRequirements?: string[];
  applicationSteps?: string[];
  milestoneRules?: MilestoneRule[];

  tags: string[];

  /** True for every record shipped in this initial version — see
   *  sampleProgramData.ts. Must gate any "verify before applying" banner. */
  isPrototypeData: boolean;
  /** Free-text log of what changed between verifications, newest first. */
  changeNotes?: string[];
}

export interface BenefitAssessment {
  programId: string;
  status: MatchStatus;
  score: number;
  matchedRules: string[];
  unmatchedRules: string[];
  unknownRules: string[];
  explanation: string;
  missingInformation: string[];
  assessedAt: string;
  rulesVersion: string;
  /** Present when status is "closed" or the record is stale/out of window —
   *  the UI must surface this, not hide it behind a generic status. */
  freshnessWarning?: string;
}

/**
 * Questionnaire answer shape. Every field is optional — undefined means
 * "not yet asked / not yet answered", which the rules engine treats as
 * genuinely unknown (not as a failure). "prefer_not_to_say" is a distinct,
 * explicit answer for sensitive fields, also treated as unknown.
 */
export type YesNoPreferNot = "yes" | "no" | "prefer_not_to_say";
export type IncomeBand = "under_25k" | "25k_45k" | "45k_60k" | "60k_plus" | "prefer_not_to_say";

export interface ApprenticeProfile {
  // Personal details
  dateOfBirth?: string;
  age?: number;
  residencyStatus?: "citizen" | "permanent_resident" | "other" | "prefer_not_to_say";
  state?: Jurisdiction;
  postcode?: string;
  indigenousStatus?: YesNoPreferNot;
  disabilityStatus?: YesNoPreferNot;
  relationshipStatus?: "single" | "partnered" | "prefer_not_to_say";
  hasDependentChildren?: boolean;
  livingArrangement?: "with_parents" | "independent" | "away_for_work_or_training";
  paysRentOrBoard?: boolean;

  // Apprenticeship details
  occupation?: string;
  qualification?: string;
  commencementDate?: string;
  expectedCompletionDate?: string;
  employmentBasis?: "full_time" | "part_time";
  apprenticeshipYear?: 1 | 2 | 3 | 4;
  isRegisteredApprenticeship?: boolean;
  isPriorityOccupation?: boolean;
  employerType?: "private" | "government" | "group_training_organisation" | "other";
  employerSize?: "small" | "medium" | "large";
  isSchoolBasedApprenticeship?: boolean;
  isFirstApprenticeship?: boolean;
  hasRecommencedOrTransferred?: boolean;
  livesAwayFromHomeForApprenticeship?: boolean;
  hasPreviouslyReceivedApprenticeIncentivePayments?: boolean;

  // Financial circumstances
  incomeBand?: IncomeBand;
  incomeVaries?: boolean;
  partnerIncomeBand?: IncomeBand;
  receivesCentrelinkPayment?: boolean;
  hasConcessionCard?: boolean;
  receivesEmployerReimbursements?: boolean;
  employerPaysTools?: boolean;
  employerPaysTravel?: boolean;
  employerPaysAccommodation?: boolean;
  employerPaysTraining?: boolean;
  hasAppliedForApprenticeshipSupportLoan?: boolean;
  hasOptedOutOfAvailableLoanOrPayment?: boolean;

  // Work and travel
  worksiteType?: "fixed" | "changing";
  travelDistanceKm?: number;
  usesPublicTransport?: boolean;
  ownsVehicle?: boolean;
  accommodationPaidByEmployer?: boolean;
  carriesRequiredTools?: boolean;
  employerProvidesSecureToolStorage?: boolean;

  // Training and costs
  tuitionCoveredByFreeTAFE?: boolean;
  hasReceivedToolAllowance?: boolean;
}

export type PlanStatus =
  | "to_investigate"
  | "need_documents"
  | "ready_to_apply"
  | "applied"
  | "awaiting_outcome"
  | "received"
  | "not_proceeding"
  | "no_longer_eligible";

export interface SavedBenefit {
  programId: string;
  status: PlanStatus;
  nextAction?: string;
  dueDate?: string;
  documentsNeeded?: string[];
  reminderDate?: string;
  notes?: string;
  savedAt: string;
}

export interface BenefitsProfileData {
  answers: ApprenticeProfile;
  lastCheckedAt?: string;
  savedBenefits: SavedBenefit[];
}
