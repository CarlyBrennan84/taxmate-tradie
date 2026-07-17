import React, { useMemo, useState } from "react";
import {
  Landmark, Sparkles, ChevronRight, ChevronLeft, ExternalLink, BookmarkPlus,
  Info, AlertTriangle, CheckCircle2, Building2, RotateCcw, Trash2, Download,
} from "lucide-react";
import { TEAL, GREEN, AMBER, darkInputCls, DarkField } from "../App";
import type { ApprenticeProfile, BenefitAssessment, BenefitProgram, MatchStatus } from "./types";
import { SAMPLE_PROGRAMS } from "./sampleProgramData";
import { assessAllPrograms } from "./rulesEngine";
import { applicableQuestions } from "./questions";
import {
  loadBenefitsProfile, saveBenefitsAnswers, saveBenefitPlanItem, deleteBenefitsProfile, exportBenefitsData,
} from "./benefitsStorage";

type View = "landing" | "questionnaire" | "results" | "detail";

const DARK_CARD = "#0D1B2E";
const DARK_CARD_BORDER = "rgba(255,255,255,0.08)";
const DARK_SURFACE = "#14233A";
const DARK_TEXT_SECONDARY = "#AEB9CB";
const DARK_TEXT_MUTED = "#79879C";
const RED = "#E5484D";

/** "Load Riley's example" — matches the demo profile spec exactly. Run
 *  through the same assessAllPrograms() as any real user's answers; nothing
 *  here pre-determines a result. */
const RILEY_DEMO: ApprenticeProfile = {
  state: "VIC",
  age: 18,
  occupation: "Apprentice plumber",
  employmentBasis: "full_time",
  isRegisteredApprenticeship: true,
  apprenticeshipYear: 1,
  livingArrangement: "with_parents",
  ownsVehicle: true,
  worksiteType: "changing",
  incomeBand: "under_25k",
  livesAwayFromHomeForApprenticeship: false,
  receivesCentrelinkPayment: false,
  employerPaysTools: false,
  employerPaysTravel: false,
};

const STATUS_META: Record<MatchStatus, { label: string; helper: string; tone: "teal" | "amber" | "grey" }> = {
  strong_match: { label: "Strong match", helper: "Likely match based on your answers", tone: "teal" },
  possible_match: { label: "Possible match", helper: "Worth checking", tone: "teal" },
  more_information_needed: { label: "More information needed", helper: "A few answers are still missing", tone: "amber" },
  employer_may_qualify: { label: "Employer may qualify", helper: "This may go to your employer, not you directly", tone: "amber" },
  upcoming: { label: "Upcoming milestone", helper: "You may meet this at a future milestone", tone: "grey" },
  not_matched: { label: "Not currently matched", helper: "This program does not appear to match your current answers", tone: "grey" },
  closed: { label: "Closed or superseded", helper: "This program is no longer active", tone: "grey" },
};

const GROUPS: { status: MatchStatus; title: string }[] = [
  { status: "strong_match", title: "Strong matches" },
  { status: "possible_match", title: "Possible matches" },
  { status: "more_information_needed", title: "More information needed" },
  { status: "employer_may_qualify", title: "Employer opportunities" },
  { status: "upcoming", title: "Upcoming opportunities" },
  { status: "not_matched", title: "Not currently matched" },
];

function DarkCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-2xl ${className}`} style={{ backgroundColor: DARK_CARD, border: `1px solid ${DARK_CARD_BORDER}`, ...style }}>
      {children}
    </div>
  );
}

function DarkSectionTitle({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      {eyebrow && <div className="text-[11px] font-semibold tracking-wide uppercase mb-1" style={{ color: TEAL }}>{eyebrow}</div>}
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {sub && <p className="text-xs mt-1 max-w-md" style={{ color: DARK_TEXT_MUTED }}>{sub}</p>}
    </div>
  );
}

function PrototypeBanner() {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: "rgba(199,127,26,0.15)", color: AMBER }}>
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>Prototype benefits data — verify schemes against official government sources before relying on this to apply.</span>
    </div>
  );
}

function StatusPill({ status }: { status: MatchStatus }) {
  const meta = STATUS_META[status];
  const tones: Record<string, { bg: string; color: string }> = {
    teal: { bg: "rgba(37,99,255,0.15)", color: TEAL },
    amber: { bg: "rgba(199,127,26,0.15)", color: AMBER },
    grey: { bg: "rgba(255,255,255,0.08)", color: DARK_TEXT_SECONDARY },
  };
  const t = tones[meta.tone];
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0" style={{ backgroundColor: t.bg, color: t.color }}>{meta.label}</span>;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function ProgramCard({
  program, assessment, onView, onSave, saved,
}: { program: BenefitProgram; assessment: BenefitAssessment; onView: () => void; onSave: () => void; saved: boolean }) {
  return (
    <DarkCard className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase mb-1" style={{ color: TEAL }}>{program.administeringAgency}</div>
          <h3 className="text-sm font-semibold text-white">{program.name}</h3>
        </div>
        <StatusPill status={assessment.status} />
      </div>
      <p className="text-xs leading-relaxed" style={{ color: DARK_TEXT_SECONDARY }}>{program.description}</p>
      {program.paymentAmountText && (
        <div className="text-xs font-medium" style={{ color: DARK_TEXT_SECONDARY }}>{program.paymentAmountText}</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {program.repayable && <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ backgroundColor: "rgba(199,127,26,0.15)", color: AMBER }}>Repayable loan</span>}
        {program.employerFacing && !program.apprenticeFacing && <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: DARK_TEXT_SECONDARY }}>Paid to employer</span>}
        {program.taxable && <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: DARK_TEXT_SECONDARY }}>Taxable</span>}
      </div>
      {assessment.explanation && (
        <p className="text-xs leading-relaxed" style={{ color: DARK_TEXT_MUTED }}>{assessment.explanation}</p>
      )}
      {assessment.missingInformation.length > 0 && (
        <div className="text-xs" style={{ color: AMBER }}>
          <span className="font-semibold">Still to confirm: </span>{assessment.missingInformation.join("; ")}
        </div>
      )}
      <div className="flex items-center justify-between pt-1 text-[11px]" style={{ color: DARK_TEXT_MUTED }}>
        <span>Last verified {fmtDate(program.lastVerifiedAt)}</span>
        {assessment.freshnessWarning && <span className="flex items-center gap-1 font-medium" style={{ color: AMBER }}><AlertTriangle size={11} />Verify before applying</span>}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onView} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition hover:bg-white/5" style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
          View details
        </button>
        <button onClick={onSave} disabled={saved} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          <BookmarkPlus size={13} />{saved ? "Saved" : "Save"}
        </button>
      </div>
    </DarkCard>
  );
}

export default function BenefitsFeature() {
  const [view, setView] = useState<View>("landing");
  const [profileData, setProfileData] = useState(() => loadBenefitsProfile());
  const [draftAnswers, setDraftAnswers] = useState<ApprenticeProfile>({});
  const [qIndex, setQIndex] = useState(0);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  const answers = profileData.answers;
  const hasAnswers = Object.keys(answers).length > 0;
  const assessments = useMemo(() => assessAllPrograms(SAMPLE_PROGRAMS, answers), [answers]);
  const programById = useMemo(() => new Map(SAMPLE_PROGRAMS.map((p) => [p.id, p])), []);

  const potentialMatches = assessments.filter((a) => ["strong_match", "possible_match", "employer_may_qualify", "upcoming"].includes(a.status)).length;
  const needsInfo = assessments.filter((a) => a.status === "more_information_needed").length;
  const recentlyChanged = SAMPLE_PROGRAMS.filter((p) => p.changeNotes && p.changeNotes.length > 0).length;
  const allQuestions = applicableQuestions(hasAnswers ? answers : {});
  const answeredCount = allQuestions.filter((q) => (answers as Record<string, unknown>)[q.id] !== undefined).length;
  const completeness = allQuestions.length ? Math.round((answeredCount / allQuestions.length) * 100) : 0;

  const startQuestionnaire = () => {
    setDraftAnswers(answers);
    setQIndex(0);
    setView("questionnaire");
  };

  const questions = applicableQuestions(draftAnswers);
  const currentQuestion = questions[qIndex];

  const finishQuestionnaire = (finalAnswers: ApprenticeProfile) => {
    const saved = saveBenefitsAnswers(finalAnswers);
    setProfileData(saved);
    setView("results");
  };

  const advance = (next: ApprenticeProfile) => {
    setDraftAnswers(next);
    const nextQuestions = applicableQuestions(next);
    if (qIndex + 1 < nextQuestions.length) setQIndex(qIndex + 1);
    else finishQuestionnaire(next);
  };

  const answerCurrent = (value: unknown) => advance({ ...draftAnswers, [currentQuestion.id]: value });
  const preferNotToSay = () => advance({ ...draftAnswers, [currentQuestion.id]: "prefer_not_to_say" });
  const skipCurrent = () => advance({ ...draftAnswers });
  const goBack = () => setQIndex((i) => Math.max(0, i - 1));

  const loadRiley = () => {
    const saved = saveBenefitsAnswers(RILEY_DEMO);
    setProfileData(saved);
    setView("results");
  };

  const savePlanItem = (programId: string) => {
    const updated = saveBenefitPlanItem({ programId, status: "to_investigate", savedAt: new Date().toISOString() });
    setProfileData(updated);
  };

  const resetProfile = () => {
    const cleared = deleteBenefitsProfile();
    setProfileData(cleared);
    setDraftAnswers({});
    setView("landing");
  };

  const downloadData = () => {
    const blob = new Blob([exportBenefitsData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "glovebox-benefits-data.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const savedProgramIds = new Set(profileData.savedBenefits.map((b) => b.programId));

  /* ---------------- Landing ---------------- */
  if (view === "landing") {
    return (
      <div className="space-y-4">
        <PrototypeBanner />
        <DarkCard className="p-6 space-y-4" style={{ background: `linear-gradient(135deg, ${TEAL} 0%, #1E4FBE 100%)`, border: "none" }}>
          <div className="flex items-center gap-2 text-white">
            <Sparkles size={18} />
            <h3 className="text-base font-semibold">Check my benefits</h3>
          </div>
          <p className="text-sm text-white/90 leading-relaxed">
            Answer a few questions and Glovebox will compare your circumstances against current Australian apprentice support programs.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={startQuestionnaire} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white transition hover:brightness-95" style={{ color: "#1E4FBE" }}>
              Start benefits check
            </button>
            {hasAnswers && (
              <button onClick={() => setView("results")} className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-white/60 text-white transition hover:bg-white/10">
                View saved results
              </button>
            )}
            <button onClick={loadRiley} className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-white/60 text-white transition hover:bg-white/10">
              Load Riley's example
            </button>
          </div>
        </DarkCard>

        {hasAnswers && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DarkCard className="p-4"><div className="text-[11px] font-medium" style={{ color: DARK_TEXT_MUTED }}>Last checked</div><div className="text-sm font-bold mt-1 text-white">{fmtDate(profileData.lastCheckedAt)}</div></DarkCard>
            <DarkCard className="p-4"><div className="text-[11px] font-medium" style={{ color: DARK_TEXT_MUTED }}>Potential matches</div><div className="text-lg font-bold tabular mt-1 text-white">{potentialMatches}</div></DarkCard>
            <DarkCard className="p-4"><div className="text-[11px] font-medium" style={{ color: DARK_TEXT_MUTED }}>Need more info</div><div className="text-lg font-bold tabular mt-1 text-white">{needsInfo}</div></DarkCard>
            <DarkCard className="p-4"><div className="text-[11px] font-medium" style={{ color: DARK_TEXT_MUTED }}>Profile completeness</div><div className="text-lg font-bold tabular mt-1 text-white">{completeness}%</div></DarkCard>
          </div>
        )}
        {hasAnswers && recentlyChanged > 0 && (
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: "rgba(199,127,26,0.15)" }}>
            <Info size={16} color={AMBER} />
            <div className="text-xs font-medium" style={{ color: AMBER }}>{recentlyChanged} program{recentlyChanged === 1 ? "" : "s"} in your results {recentlyChanged === 1 ? "has" : "have"} scheduled rule changes coming up.</div>
          </div>
        )}

        <DarkCard className="p-6">
          <DarkSectionTitle title="Your benefits profile" sub="Everything here is optional and stays on this device." />
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadData} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition hover:bg-white/5" style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
              <Download size={13} />Download my benefits data
            </button>
            <button onClick={resetProfile} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition" style={{ borderColor: "rgba(255,255,255,0.14)", color: RED }}>
              <Trash2 size={13} />Delete benefits profile
            </button>
          </div>
        </DarkCard>
      </div>
    );
  }

  /* ---------------- Questionnaire ---------------- */
  if (view === "questionnaire") {
    if (!currentQuestion) {
      finishQuestionnaire(draftAnswers);
      return null;
    }
    const progressPct = Math.round(((qIndex + 1) / Math.max(questions.length, qIndex + 1)) * 100);
    return (
      <div className="space-y-4 max-w-lg">
        <button onClick={() => setView("landing")} className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL }}>
          <ChevronLeft size={13} />Cancel
        </button>
        <div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.10)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: TEAL }} />
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: DARK_TEXT_MUTED }}>{currentQuestion.section} · a couple more questions to go</div>
        </div>
        <DarkCard className="p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">{currentQuestion.prompt}</h3>
          {currentQuestion.sensitive && (
            <div className="flex items-start gap-2 text-xs px-3 py-2.5 rounded-xl" style={{ backgroundColor: "rgba(37,99,255,0.15)", color: TEAL }}>
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>{currentQuestion.helper || "This is optional. It helps us check programs with additional eligibility criteria."}</span>
            </div>
          )}
          {currentQuestion.type === "select" && (
            <div className="grid gap-2">
              {currentQuestion.options?.map((o) => (
                <button
                  key={String(o.value)}
                  onClick={() => answerCurrent(o.value)}
                  className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium border transition hover:bg-white/5"
                  style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {currentQuestion.type === "text" && (
            <input
              autoFocus
              className={darkInputCls}
              style={{ backgroundColor: DARK_SURFACE, borderColor: "rgba(255,255,255,0.10)" }}
              placeholder="Type your answer"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) answerCurrent(e.currentTarget.value.trim());
              }}
            />
          )}
          <div className="flex items-center justify-between pt-2 text-xs" style={{ color: DARK_TEXT_MUTED }}>
            <button onClick={qIndex > 0 ? goBack : () => setView("landing")} className="font-medium hover:underline">Back</button>
            <div className="flex gap-4">
              {currentQuestion.sensitive && <button onClick={preferNotToSay} className="font-medium hover:underline">Prefer not to say</button>}
              <button onClick={skipCurrent} className="font-medium hover:underline">Skip</button>
            </div>
          </div>
        </DarkCard>
      </div>
    );
  }

  /* ---------------- Program detail ---------------- */
  if (view === "detail" && selectedProgramId) {
    const program = programById.get(selectedProgramId);
    const assessment = assessments.find((a) => a.programId === selectedProgramId);
    if (!program || !assessment) { setView("results"); return null; }
    return (
      <div className="space-y-4">
        <button onClick={() => setView("results")} className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL }}>
          <ChevronLeft size={13} />Back to results
        </button>
        <PrototypeBanner />
        <DarkCard className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-wide uppercase mb-1" style={{ color: TEAL }}>{program.administeringAgency} · {program.jurisdiction}</div>
              <h2 className="text-lg font-semibold text-white">{program.name}</h2>
            </div>
            <StatusPill status={assessment.status} />
          </div>
          <p className="text-sm leading-relaxed" style={{ color: DARK_TEXT_SECONDARY }}>{program.description}</p>
          {program.paymentAmountText && <div className="text-sm font-medium" style={{ color: DARK_TEXT_SECONDARY }}>{program.paymentAmountText}</div>}
          {program.repayable && (
            <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl" style={{ backgroundColor: "rgba(199,127,26,0.15)", color: AMBER }}>
              <AlertTriangle size={13} />Loans must be repaid through the tax system once applicable repayment conditions are met.
            </div>
          )}
          {program.employerFacing && !program.apprenticeFacing && (
            <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl" style={{ backgroundColor: "rgba(37,99,255,0.15)", color: TEAL }}>
              <Building2 size={13} />This payment may go to the employer rather than directly to the apprentice.
            </div>
          )}
          {assessment.freshnessWarning && (
            <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl" style={{ backgroundColor: "rgba(199,127,26,0.15)", color: AMBER }}>
              <AlertTriangle size={13} />{assessment.freshnessWarning}
            </div>
          )}
        </DarkCard>

        <DarkCard className="p-6 space-y-3">
          <DarkSectionTitle title="Why this matched" />
          <p className="text-sm leading-relaxed" style={{ color: DARK_TEXT_SECONDARY }}>{assessment.explanation}</p>
          {assessment.missingInformation.length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: AMBER }}>Still to confirm</div>
              <ul className="text-xs space-y-1" style={{ color: DARK_TEXT_MUTED }}>
                {assessment.missingInformation.map((m, i) => <li key={i}>• {m}</li>)}
              </ul>
            </div>
          )}
        </DarkCard>

        {(program.evidenceRequirements?.length || program.applicationSteps?.length) && (
          <DarkCard className="p-6 space-y-4">
            {program.evidenceRequirements?.length ? (
              <div>
                <DarkSectionTitle title="What you'll need" />
                <ul className="text-sm space-y-1" style={{ color: DARK_TEXT_SECONDARY }}>{program.evidenceRequirements.map((e, i) => <li key={i}>• {e}</li>)}</ul>
              </div>
            ) : null}
            {program.applicationSteps?.length ? (
              <div>
                <DarkSectionTitle title="Next steps" />
                <ul className="text-sm space-y-1" style={{ color: DARK_TEXT_SECONDARY }}>{program.applicationSteps.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
            ) : null}
          </DarkCard>
        )}

        <DarkCard className="p-6 space-y-3">
          <div className="flex items-center justify-between text-xs" style={{ color: DARK_TEXT_MUTED }}>
            <span>Last verified {fmtDate(program.lastVerifiedAt)}</span>
            <span>Next review {fmtDate(program.nextReviewAt)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={program.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border transition hover:bg-white/5" style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
              <ExternalLink size={14} />View official details
            </a>
            <button onClick={() => savePlanItem(program.id)} disabled={savedProgramIds.has(program.id)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              <BookmarkPlus size={14} />{savedProgramIds.has(program.id) ? "Saved to plan" : "Add to my plan"}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: DARK_TEXT_MUTED }}>Final eligibility is determined by the relevant government agency, not by Glovebox.</p>
        </DarkCard>
      </div>
    );
  }

  /* ---------------- Results ---------------- */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DarkSectionTitle eyebrow="Benefits Finder" title="Your results" sub={`Checked against ${SAMPLE_PROGRAMS.length} current programs · last checked ${fmtDate(profileData.lastCheckedAt)}`} />
        <div className="flex gap-2">
          <button onClick={() => setView("landing")} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition hover:bg-white/5" style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
            <ChevronLeft size={13} />Home
          </button>
          <button onClick={startQuestionnaire} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition hover:brightness-110" style={{ backgroundColor: TEAL }}>
            <RotateCcw size={13} />Recheck answers
          </button>
        </div>
      </div>
      <PrototypeBanner />

      {GROUPS.map((g) => {
        const items = assessments.filter((a) => a.status === g.status);
        if (!items.length) return null;
        return (
          <div key={g.status} className="space-y-3">
            <h3 className="text-sm font-semibold text-white">{g.title} <span style={{ color: DARK_TEXT_MUTED }}>({items.length})</span></h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {items.map((a) => {
                const program = programById.get(a.programId);
                if (!program) return null;
                return (
                  <ProgramCard
                    key={a.programId}
                    program={program}
                    assessment={a}
                    saved={savedProgramIds.has(a.programId)}
                    onView={() => { setSelectedProgramId(a.programId); setView("detail"); }}
                    onSave={() => savePlanItem(a.programId)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {assessments.every((a) => a.status === "closed") && (
        <div className="flex flex-col items-center text-center py-10 px-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}>
            <Landmark size={20} style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-semibold text-white">No current programs</p>
          <p className="text-xs mt-1 max-w-[280px] leading-relaxed" style={{ color: DARK_TEXT_MUTED }}>Nothing active in the demo program set matched your answers.</p>
        </div>
      )}

      <DarkCard className="p-4 flex items-start gap-2.5 text-xs" style={{ color: DARK_TEXT_MUTED }}>
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" color={GREEN} />
        <span>These results are a starting point, not a decision — final eligibility is determined by the relevant government agency.</span>
      </DarkCard>
    </div>
  );
}
