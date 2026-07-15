import type { ApprenticeProfile } from "./types";

/**
 * The adaptive questionnaire. This is a representative subset of the fields
 * on ApprenticeProfile — enough to drive every demo program's rules plus a
 * realistic mix of sensitive/optional questions. Extending it is just
 * adding another entry here; the walk logic in BenefitsFeature.tsx doesn't
 * need to change.
 */

export type QuestionOption = { label: string; value: unknown };

export interface Question {
  id: keyof ApprenticeProfile;
  section: "Personal" | "Apprenticeship" | "Financial" | "Work & travel";
  prompt: string;
  helper?: string;
  sensitive?: boolean;
  type: "select" | "text" | "number";
  options?: QuestionOption[];
  /** Only ask this question if the predicate is true given answers so far. */
  condition?: (a: ApprenticeProfile) => boolean;
}

export const QUESTIONS: Question[] = [
  {
    id: "state",
    section: "Personal",
    prompt: "Which state or territory are you in?",
    type: "select",
    options: ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((s) => ({ label: s, value: s })),
  },
  {
    id: "residencyStatus",
    section: "Personal",
    prompt: "What's your residency status?",
    type: "select",
    options: [
      { label: "Australian citizen", value: "citizen" },
      { label: "Permanent resident", value: "permanent_resident" },
      { label: "Other visa", value: "other" },
    ],
  },
  {
    id: "livingArrangement",
    section: "Personal",
    prompt: "Where do you currently live?",
    type: "select",
    options: [
      { label: "With parents/family", value: "with_parents" },
      { label: "Independently", value: "independent" },
      { label: "Away from home for work or training", value: "away_for_work_or_training" },
    ],
  },
  {
    id: "hasDependentChildren",
    section: "Personal",
    prompt: "Do you have any dependent children?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "indigenousStatus",
    section: "Personal",
    prompt: "Are you Aboriginal or Torres Strait Islander?",
    helper: "This is optional. It helps us check programs with additional eligibility criteria.",
    sensitive: true,
    type: "select",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  },
  {
    id: "disabilityStatus",
    section: "Personal",
    prompt: "Do you have a disability or ongoing health condition affecting your work or training?",
    helper: "This is optional. It helps us check programs with additional eligibility criteria.",
    sensitive: true,
    type: "select",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  },
  {
    id: "occupation",
    section: "Apprenticeship",
    prompt: "What trade or occupation are you training in?",
    type: "text",
  },
  {
    id: "isRegisteredApprenticeship",
    section: "Apprenticeship",
    prompt: "Is your apprenticeship formally registered?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "employmentBasis",
    section: "Apprenticeship",
    prompt: "Is your apprenticeship full-time or part-time?",
    type: "select",
    options: [{ label: "Full-time", value: "full_time" }, { label: "Part-time", value: "part_time" }],
  },
  {
    id: "apprenticeshipYear",
    section: "Apprenticeship",
    prompt: "What year of your apprenticeship are you currently in?",
    type: "select",
    options: [1, 2, 3, 4].map((y) => ({ label: `Year ${y}`, value: y })),
  },
  {
    id: "isPriorityOccupation",
    section: "Apprenticeship",
    prompt: "Do you know if your occupation is on a current priority occupation list?",
    helper: "Not sure? Skip this — we'll flag it as something to confirm.",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "employerType",
    section: "Apprenticeship",
    prompt: "What type of employer do you work for?",
    type: "select",
    options: [
      { label: "Private business", value: "private" },
      { label: "Government", value: "government" },
      { label: "Group training organisation", value: "group_training_organisation" },
      { label: "Other", value: "other" },
    ],
  },
  {
    id: "incomeBand",
    section: "Financial",
    prompt: "Roughly, what's your gross income?",
    type: "select",
    options: [
      { label: "Under $25,000", value: "under_25k" },
      { label: "$25,000 – $45,000", value: "25k_45k" },
      { label: "$45,000 – $60,000", value: "45k_60k" },
      { label: "$60,000+", value: "60k_plus" },
    ],
  },
  {
    id: "receivesCentrelinkPayment",
    section: "Financial",
    prompt: "Do you currently receive a Centrelink payment?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "hasOptedOutOfAvailableLoanOrPayment",
    section: "Financial",
    prompt: "Have you previously opted out of an apprentice loan or support payment you were offered?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
    condition: (a) => a.isRegisteredApprenticeship === true,
  },
  {
    id: "employerPaysTools",
    section: "Work & travel",
    prompt: "Does your employer pay for your tools?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "employerPaysTravel",
    section: "Work & travel",
    prompt: "Does your employer pay for your travel?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "worksiteType",
    section: "Work & travel",
    prompt: "Do you work from a fixed workplace, or changing worksites?",
    type: "select",
    options: [{ label: "Fixed workplace", value: "fixed" }, { label: "Changing worksites", value: "changing" }],
  },
  {
    id: "ownsVehicle",
    section: "Work & travel",
    prompt: "Do you own a vehicle you use for work or training?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
  },
  {
    id: "livesAwayFromHomeForApprenticeship",
    section: "Work & travel",
    prompt: "Do you live away from home specifically because of your apprenticeship?",
    type: "select",
    options: [{ label: "Yes", value: true }, { label: "No", value: false }],
    condition: (a) => a.livingArrangement === "away_for_work_or_training",
  },
];

export function applicableQuestions(answers: ApprenticeProfile): Question[] {
  return QUESTIONS.filter((q) => !q.condition || q.condition(answers));
}
