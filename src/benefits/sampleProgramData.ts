import type { BenefitProgram } from "./types";

/**
 * PROTOTYPE DATA — every record here is isPrototypeData: true.
 *
 * These are illustrative examples of the *shape* of real Australian
 * apprentice support programs, not a verified, current source of truth.
 * Dollar amounts are deliberately left as vague text rather than specific
 * numbers, and every officialSourceUrl points at the relevant agency's
 * general site rather than a deep page we can't keep verified. Real program
 * names, thresholds, and rules change — do not ship this file to production
 * without an actual research/verification pass against each agency's
 * current published rules (see the "Items requiring official program
 * research" note this feature ships with).
 */

export const SAMPLE_PROGRAMS: BenefitProgram[] = [
  {
    id: "demo-aasl",
    name: "Australian Apprenticeship Support Loan",
    shortName: "AASL",
    description:
      "A voluntary income-contingent loan available to some Australian Apprentices to help with costs during the early years of an apprenticeship.",
    administeringAgency: "Australian Government (Department administering Australian Apprenticeships)",
    jurisdiction: "Commonwealth",
    supportType: "loan",
    officialSourceUrl: "https://www.apprenticeships.gov.au",
    effectiveFrom: "2022-07-01",
    lastVerifiedAt: "2026-07-15",
    nextReviewAt: "2026-10-15",
    active: true,
    paymentAmountText: "Monthly loan instalments, subject to current annual and lifetime caps set by the program.",
    repayable: true,
    taxable: false,
    apprenticeFacing: true,
    employerFacing: false,
    isPrototypeData: true,
    eligibilityRules: [
      {
        type: "all",
        rules: [
          {
            id: "aasl-registered",
            field: "isRegisteredApprenticeship",
            operator: "equals",
            value: true,
            required: true,
            explanation: "you have a formally registered apprenticeship",
            sourceReference: "apprenticeships.gov.au",
          },
        ],
      },
      {
        type: "all",
        rules: [
          {
            id: "aasl-priority-occupation",
            field: "isPriorityOccupation",
            operator: "equals",
            value: true,
            required: true,
            explanation: "your occupation is on the current priority occupation list",
            sourceReference: "apprenticeships.gov.au",
          },
        ],
      },
    ],
    exclusionRules: [
      {
        type: "any",
        rules: [
          {
            id: "aasl-opted-out",
            field: "hasOptedOutOfAvailableLoanOrPayment",
            operator: "equals",
            value: true,
            required: false,
            explanation: "you previously opted out of this loan",
          },
        ],
      },
    ],
    evidenceRequirements: ["Proof of registered apprenticeship", "Identity verification"],
    applicationSteps: ["Check current priority occupation status", "Apply through the official Australian Apprenticeships portal"],
    tags: ["loan", "apprentice", "commonwealth"],
  },
  {
    id: "demo-aatsp",
    name: "Australian Apprentice Training Support Payment",
    shortName: "AATSP",
    description: "Milestone-based training support payments made at set points across an eligible full-time apprenticeship.",
    administeringAgency: "Australian Government (Department administering Australian Apprenticeships)",
    jurisdiction: "Commonwealth",
    supportType: "payment",
    officialSourceUrl: "https://www.apprenticeships.gov.au",
    effectiveFrom: "2025-07-01",
    lastVerifiedAt: "2026-06-20",
    nextReviewAt: "2026-07-01",
    active: true,
    paymentAmountText: "Set payments at defined milestones; current amounts depend on program settings at time of milestone.",
    repayable: false,
    taxable: true,
    apprenticeFacing: true,
    employerFacing: false,
    isPrototypeData: true,
    changeNotes: [
      "Arrangements for apprentice support payments are scheduled to change from 1 January 2027 — reconfirm details closer to that date.",
    ],
    eligibilityRules: [
      {
        type: "all",
        rules: [
          {
            id: "aatsp-registered",
            field: "isRegisteredApprenticeship",
            operator: "equals",
            value: true,
            required: true,
            explanation: "you have a formally registered apprenticeship",
          },
          {
            id: "aatsp-fulltime",
            field: "employmentBasis",
            operator: "equals",
            value: "full_time",
            required: true,
            explanation: "your apprenticeship is full-time",
          },
        ],
      },
      {
        type: "all",
        rules: [
          {
            id: "aatsp-year-milestone",
            field: "apprenticeshipYear",
            operator: "greater_than_or_equal",
            value: 2,
            required: true,
            explanation: "you've reached your second year of apprenticeship, where this payment tier applies",
          },
        ],
      },
    ],
    milestoneRules: [
      { milestone: "6_months", description: "Early milestone check-in — indicative only." },
      { milestone: "12_months", description: "First-year completion milestone — indicative only." },
      { milestone: "24_months", description: "Second-year milestone, where this payment tier applies — indicative only." },
    ],
    evidenceRequirements: ["Confirmation of current apprenticeship year from your RTO or employer"],
    tags: ["payment", "milestone", "apprentice", "commonwealth"],
  },
  {
    id: "demo-youth-allowance",
    name: "Youth Allowance for Australian Apprentices",
    shortName: "Youth Allowance",
    description: "An income-tested Services Australia payment some younger apprentices may be able to receive while training.",
    administeringAgency: "Services Australia",
    jurisdiction: "Commonwealth",
    supportType: "payment",
    officialSourceUrl: "https://www.servicesaustralia.gov.au",
    effectiveFrom: "2020-01-01",
    lastVerifiedAt: "2026-07-10",
    nextReviewAt: "2026-10-10",
    active: true,
    paymentAmountText: "Fortnightly payment, amount depends on age, living arrangements and income test settings at time of assessment.",
    repayable: false,
    taxable: true,
    apprenticeFacing: true,
    employerFacing: false,
    isPrototypeData: true,
    eligibilityRules: [
      {
        type: "all",
        rules: [
          {
            id: "ya-residency",
            field: "residencyStatus",
            operator: "in",
            value: ["citizen", "permanent_resident"],
            required: true,
            explanation: "you meet the residency requirement",
          },
          {
            id: "ya-income",
            field: "incomeBand",
            operator: "in",
            value: ["under_25k", "25k_45k"],
            required: true,
            explanation: "your income falls within the tested range for this payment",
          },
        ],
      },
      {
        type: "all",
        rules: [
          {
            id: "ya-away-from-home",
            field: "livingArrangement",
            operator: "equals",
            value: "away_for_work_or_training",
            required: false,
            weight: 1,
            explanation: "you live away from home for training, which may affect your payment rate",
          },
        ],
      },
    ],
    evidenceRequirements: ["Proof of income", "Proof of enrolment in an apprenticeship"],
    applicationSteps: ["Apply via Centrelink online through myGov"],
    tags: ["payment", "income-tested", "centrelink", "commonwealth"],
  },
  {
    id: "demo-vic-free-tafe",
    name: "Victoria Free TAFE for Priority Courses",
    shortName: "Free TAFE (VIC)",
    description: "Free or subsidised tuition for eligible priority courses delivered through Victorian TAFEs.",
    administeringAgency: "Department of Jobs, Skills, Industry and Regions (VIC)",
    jurisdiction: "VIC",
    supportType: "training_subsidy",
    officialSourceUrl: "https://www.vic.gov.au",
    effectiveFrom: "2019-01-01",
    lastVerifiedAt: "2026-06-01",
    nextReviewAt: "2026-12-01",
    active: true,
    paymentAmountText: "Full or subsidised tuition — course eligibility and fee-free status vary by course and year.",
    repayable: false,
    taxable: false,
    apprenticeFacing: true,
    employerFacing: false,
    isPrototypeData: true,
    eligibilityRules: [
      {
        type: "all",
        rules: [
          {
            id: "vic-tafe-state",
            field: "state",
            operator: "equals",
            value: "VIC",
            required: true,
            explanation: "you're training in Victoria",
          },
          {
            id: "vic-tafe-registered",
            field: "isRegisteredApprenticeship",
            operator: "equals",
            value: true,
            required: true,
            explanation: "you're enrolled in a registered apprenticeship or traineeship",
          },
        ],
      },
    ],
    evidenceRequirements: ["Enrolment confirmation from your TAFE or RTO", "Confirmation your specific course is on the current priority list"],
    tags: ["training", "state", "vic", "tafe"],
  },
  {
    id: "demo-employer-priority-incentive",
    name: "Australian Apprenticeships Incentive System — Priority Occupation Employer Incentive",
    shortName: "Employer Priority Incentive",
    description:
      "A hiring incentive paid to employers who take on an apprentice in a priority occupation. This payment may go to the employer rather than directly to the apprentice.",
    administeringAgency: "Australian Government (Department administering Australian Apprenticeships)",
    jurisdiction: "Commonwealth",
    supportType: "employer_incentive",
    officialSourceUrl: "https://www.apprenticeships.gov.au",
    effectiveFrom: "2022-07-01",
    lastVerifiedAt: "2026-06-15",
    nextReviewAt: "2026-12-15",
    active: true,
    paymentAmountText: "Incentive paid to the employer at defined milestones — amount depends on current program settings.",
    repayable: false,
    taxable: true,
    apprenticeFacing: false,
    employerFacing: true,
    isPrototypeData: true,
    eligibilityRules: [
      {
        type: "all",
        rules: [
          {
            id: "epi-registered",
            field: "isRegisteredApprenticeship",
            operator: "equals",
            value: true,
            required: true,
            explanation: "the apprenticeship is formally registered",
          },
          {
            id: "epi-priority-occupation",
            field: "isPriorityOccupation",
            operator: "equals",
            value: true,
            required: true,
            explanation: "the occupation is on the current priority occupation list",
          },
        ],
      },
    ],
    evidenceRequirements: ["Employer registration details", "Confirmation of priority occupation status"],
    tags: ["employer", "incentive", "priority-occupation", "commonwealth"],
  },
];
