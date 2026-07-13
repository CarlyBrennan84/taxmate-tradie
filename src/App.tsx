import React, { useState, useEffect, useRef } from "react";
import * as ChartLib from "chart.js";
import {
  LayoutDashboard, Receipt, Car, Wrench, Shirt, HardHat, Smartphone,
  GraduationCap, FileText, UploadCloud, Plus, Trash2, ChevronRight, Menu,
  Download, Printer, TrendingUp, Gauge, MapPin, Sparkles,
  Check, CheckCircle2, AlertTriangle, ArrowRight, Fuel, Upload, ShieldCheck, X,
} from "lucide-react";
import type { AppData, Receipt as ReceiptT, Trip, CategoryKey } from "./types";
import { loadData, saveData, loadDemoFlag, saveDemoFlag } from "./lib/storage";
import { SAMPLE_DATA } from "./sampleData";
import { parseDriversnoteCSV } from "./csv";

ChartLib.Chart.register(...ChartLib.registerables);

/* ---------------------------------------------------------------
   Design tokens
----------------------------------------------------------------*/
const NAVY = "#132038";
const NAVY_SOFT = "#3A4A66";
const TEAL = "#0E9C94";
const TEAL_DARK = "#0B7A73";
const TEAL_TINT = "#E6F5F3";
const GREY_BG = "#F6F7F9";
const GREY_LINE = "#E7E9EE";
const AMBER = "#C77F1A";
const AMBER_TINT = "#FBF0DE";

interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: React.ElementType;
}

const CATEGORIES: CategoryDef[] = [
  { key: "tools", label: "Tools & Equipment", icon: Wrench },
  { key: "clothing", label: "Clothing", icon: Shirt },
  { key: "ppe", label: "PPE", icon: HardHat },
  { key: "phone", label: "Phone & Internet", icon: Smartphone },
  { key: "tafe", label: "TAFE & Training", icon: GraduationCap },
  { key: "vehicle", label: "Vehicle & Fuel", icon: Car },
  { key: "other", label: "Other Work Expenses", icon: Receipt },
];

const FY_MONTHS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

const CENTS_PER_KM_RATE = 0.88; // ATO guide rate — confirm the current year's rate with your tax agent
const CENTS_PER_KM_CAP_KM = 5000;
const LAUNDRY_ATO_CAP = 150;

const DEFAULT_DATA: AppData = {
  profile: {
    name: "", occupation: "Apprentice Electrician", fy: "2025–26",
    income: 0, taxWithheld: 0, phoneWorkPct: 0, laundryEstimate: 0,
    vehicle: { make: "", model: "", rego: "", openingOdometer: 0 },
    quickSetupDone: false,
  },
  receipts: [],
  trips: [],
};

const uid = (): string => Math.random().toString(36).slice(2, 10);
const fmt = (n: number): string =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
const fmtDec = (n: number): string =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
const todayISO = (): string => new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------
   Simplified AU resident tax calc (2024–25 style brackets) —
   for estimation only, not advice.
----------------------------------------------------------------*/
function incomeTax(income: number): number {
  const b: [number, number, number][] = [
    [0, 18200, 0],
    [18200, 45000, 0.16],
    [45000, 135000, 0.30],
    [135000, 190000, 0.37],
    [190000, Infinity, 0.45],
  ];
  let tax = 0;
  for (const [lo, hi, rate] of b) {
    if (income > lo) tax += (Math.min(income, hi) - lo) * rate;
  }
  return tax;
}
function medicareLevy(income: number): number {
  if (income <= 24276) return 0;
  if (income <= 30345) return (income - 24276) * 0.1;
  return income * 0.02;
}
function totalTax(income: number): number {
  return incomeTax(Math.max(0, income)) + medicareLevy(Math.max(0, income));
}

/* ---------------------------------------------------------------
   Small building blocks
----------------------------------------------------------------*/
function AnimatedNumber({ value, format = fmt, duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const to = value || 0;
    const start = performance.now();
    let raf: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(display)}</>;
}

function Card({ children, className = "", style, delay = 0 }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; delay?: number }) {
  return (
    <div
      className={`fade-up bg-white rounded-2xl border border-[#E7E9EE] shadow-card hover:shadow-card-hover transition-shadow duration-300 ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
      <div>
        {eyebrow && <div className="text-[11px] font-semibold tracking-wide uppercase mb-1" style={{ color: TEAL_DARK }}>{eyebrow}</div>}
        <h2 className="text-lg font-semibold" style={{ color: NAVY }}>{title}</h2>
        {sub && <p className="text-xs mt-1 max-w-md" style={{ color: "#8A93A3" }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Pill({ children, tone = "grey" }: { children: React.ReactNode; tone?: "grey" | "teal" | "amber" }) {
  const tones: Record<string, string> = {
    grey: "bg-[#F0F1F4] text-[#5B6472]",
    teal: "text-white",
    amber: "bg-[#FBF0DE] text-[#8A5A0F]",
  };
  const style = tone === "teal" ? { backgroundColor: TEAL } : undefined;
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone]}`} style={style}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: NAVY_SOFT }}>{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] px-3 py-2 text-sm text-[#132038] focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed";

function EmptyState({ icon: Icon, title, subtitle, action }: { icon: React.ElementType; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: TEAL_TINT }}>
        <Icon size={20} color={TEAL_DARK} />
      </div>
      <p className="text-sm font-semibold" style={{ color: NAVY }}>{title}</p>
      <p className="text-xs mt-1 max-w-[280px] leading-relaxed" style={{ color: "#8A93A3" }}>{subtitle}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function ChartCanvas({ type, data, options, heightClass = "h-56" }: { type: "bar" | "doughnut"; data: any; options: any; heightClass?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartLib.Chart | null>(null);
  const sig = JSON.stringify({ data, options, type });
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new ChartLib.Chart(canvasRef.current, { type, data, options });
    return () => { chartRef.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return <div className={heightClass}><canvas ref={canvasRef} /></div>;
}

function Dropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled && e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)); }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center text-center py-10 px-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${drag ? "scale-[1.01]" : ""}`}
      style={{ borderColor: drag ? TEAL : "#D7DBE3", backgroundColor: drag ? TEAL_TINT : "#FBFBFC" }}
    >
      <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: TEAL_TINT }}>
        <UploadCloud size={20} color={TEAL_DARK} />
      </div>
      <p className="text-sm font-medium" style={{ color: NAVY }}>Drag receipts here, or click to browse</p>
      <p className="text-xs mt-1" style={{ color: "#8A93A3" }}>JPG, PNG or PDF — one at a time or in a batch</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) onFiles(Array.from(e.target.files)); e.target.value = ""; }}
      />
    </div>
  );
}

function ReceiptForm({ onSave, onCancel, categoryLock }: { onSave: (r: ReceiptT) => void; onCancel: () => void; categoryLock?: CategoryKey }) {
  const [r, setR] = useState<{ id: string; date: string; vendor: string; category: CategoryKey; amount: string; workPct: string; filed: boolean; notes: string }>({
    id: uid(), date: todayISO(), vendor: "", category: categoryLock || "tools", amount: "", workPct: "100", filed: true, notes: "",
  });
  useEffect(() => { if (categoryLock) setR((p) => ({ ...p, category: categoryLock })); }, [categoryLock]);
  const set = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => setR((p) => ({ ...p, [k]: v }));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-2xl border" style={{ borderColor: GREY_LINE, backgroundColor: "#FBFBFC" }}>
      <Field label="Date"><input type="date" value={r.date} onChange={(e) => set("date", e.target.value)} className={inputCls} /></Field>
      <Field label="Vendor"><input value={r.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Total Tools" className={inputCls} /></Field>
      <Field label="Category">
        <select disabled={!!categoryLock} value={r.category} onChange={(e) => set("category", e.target.value as CategoryKey)} className={inputCls}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Amount (incl. GST)"><input type="number" step="0.01" value={r.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className={inputCls} /></Field>
      <Field label="Work-related %"><input type="number" min={0} max={100} value={r.workPct} onChange={(e) => set("workPct", e.target.value)} className={inputCls} /></Field>
      <Field label="Filed / saved?">
        <select value={r.filed ? "yes" : "no"} onChange={(e) => set("filed", e.target.value === "yes")} className={inputCls}>
          <option value="yes">Yes</option>
          <option value="no">Not yet</option>
        </select>
      </Field>
      <div className="col-span-2 sm:col-span-3">
        <Field label="Notes (optional)"><input value={r.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What was it for?" className={inputCls} /></Field>
      </div>
      <div className="col-span-2 sm:col-span-3 flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5B6472] hover:bg-[#F0F1F4] transition">Cancel</button>
        <button
          onClick={() => {
            if (!r.vendor || !r.amount) return;
            onSave({ id: r.id, date: r.date, vendor: r.vendor, category: r.category, amount: parseFloat(r.amount) || 0, workPct: parseFloat(r.workPct) || 0, filed: r.filed, notes: r.notes });
          }}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition"
          style={{ backgroundColor: TEAL }}
        >
          Save receipt
        </button>
      </div>
    </div>
  );
}

function ReceiptRow({ r, onDelete, thumb }: { r: ReceiptT; onDelete: (id: string) => void; thumb?: string }) {
  const ded = r.amount * (r.workPct / 100);
  const cat = CATEGORIES.find((c) => c.key === r.category);
  const incomplete = !r.vendor || !r.amount;
  return (
    <div className="flex items-center gap-3 py-3 px-1 border-b last:border-0" style={{ borderColor: GREY_LINE }}>
      <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : cat && <cat.icon size={16} color={TEAL_DARK} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" style={{ color: NAVY }}>{r.vendor || "Untitled receipt"}</div>
        <div className="text-xs text-[#8A93A3] truncate">{cat?.label} · {new Date(r.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}{r.notes ? ` · ${r.notes}` : ""}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold" style={{ color: NAVY }}>{fmtDec(r.amount)}</div>
        <div className="text-[11px] text-[#8A93A3]">{r.workPct}% · ded. {fmtDec(ded)}</div>
      </div>
      {incomplete ? <Pill tone="amber">Needs details</Pill> : r.filed ? <Pill tone="teal">Filed</Pill> : <Pill tone="amber">To file</Pill>}
      <button onClick={() => onDelete(r.id)} className="p-1.5 rounded-lg text-[#B7BEC9] hover:text-[#C4573F] hover:bg-[#FBEAE6] transition flex-shrink-0"><Trash2 size={15} /></button>
    </div>
  );
}

function TripForm({ onSave, onCancel }: { onSave: (t: Trip) => void; onCancel: () => void }) {
  const [t, setT] = useState<{ id: string; date: string; purpose: string; type: "business" | "personal"; km: string }>({
    id: uid(), date: todayISO(), purpose: "", type: "business", km: "",
  });
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) => setT((p) => ({ ...p, [k]: v }));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl border" style={{ borderColor: GREY_LINE, backgroundColor: "#FBFBFC" }}>
      <Field label="Date"><input type="date" value={t.date} onChange={(e) => set("date", e.target.value)} className={inputCls} /></Field>
      <Field label="Purpose"><input value={t.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Site visit — Preston" className={inputCls} /></Field>
      <Field label="Trip type">
        <select value={t.type} onChange={(e) => set("type", e.target.value as "business" | "personal")} className={inputCls}>
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>
      </Field>
      <Field label="Kilometres"><input type="number" step="0.1" value={t.km} onChange={(e) => set("km", e.target.value)} placeholder="0.0" className={inputCls} /></Field>
      <div className="col-span-2 sm:col-span-4 flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5B6472] hover:bg-[#F0F1F4] transition">Cancel</button>
        <button
          onClick={() => { if (!t.purpose || !t.km) return; onSave({ id: t.id, date: t.date, purpose: t.purpose, type: t.type, km: parseFloat(t.km) || 0 }); }}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition"
          style={{ backgroundColor: TEAL }}
        >
          Log trip
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Guided-assistant building blocks
----------------------------------------------------------------*/
interface SetupStep { key: string; label: string; done: boolean; onGo: () => void; }

function SetupCard({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  if (allDone) {
    return (
      <Card className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
          <CheckCircle2 size={18} color={TEAL_DARK} />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: NAVY }}>You're set up</div>
          <div className="text-xs" style={{ color: "#8A93A3" }}>TaxMate has what it needs to start estimating your refund properly.</div>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Sparkles size={16} color={TEAL_DARK} />
          <span className="text-sm font-semibold" style={{ color: NAVY }}>Start here</span>
        </div>
        <span className="text-xs font-medium tabular" style={{ color: "#8A93A3" }}>{doneCount}/{steps.length} done</span>
      </div>
      <p className="text-xs mb-4" style={{ color: "#8A93A3" }}>A few quick steps and TaxMate can start estimating your refund properly.</p>
      <div className="w-full h-1.5 rounded-full bg-[#EEF0F4] mb-4 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(doneCount / steps.length) * 100}%`, backgroundColor: TEAL }} />
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {steps.map((s) => (
          <button key={s.key} onClick={s.onGo} disabled={s.done} className="flex items-center gap-2.5 p-3 rounded-xl border text-left transition disabled:cursor-default" style={{ borderColor: s.done ? TEAL_TINT : GREY_LINE, backgroundColor: s.done ? TEAL_TINT : "#FBFBFC" }}>
            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={s.done ? { backgroundColor: TEAL } : { border: "1.5px solid #D7DBE3" }}>
              {s.done && <Check size={12} color="#fff" strokeWidth={3} />}
            </div>
            <span className="text-xs font-medium flex-1" style={{ color: s.done ? TEAL_DARK : NAVY }}>{s.label}</span>
            {!s.done && <ArrowRight size={13} color="#B7BEC9" />}
          </button>
        ))}
      </div>
    </Card>
  );
}

function QuickSetupCard({ occupation, income, onSave, disabled }: { occupation: string; income: number; onSave: (occupation: string, income: number) => void; disabled?: boolean }) {
  const [draftOccupation, setDraftOccupation] = useState(occupation);
  const [draftIncome, setDraftIncome] = useState(income ? String(income) : "");
  const canSave = draftOccupation.trim() !== "" && (parseFloat(draftIncome) || 0) > 0;
  return (
    <Card className="p-5">
      <SectionTitle eyebrow="Quick setup" title="Tell TaxMate about your work" sub="Just enough to start estimating your refund — you can refine the details later." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Job description">
          <input disabled={disabled} value={draftOccupation} onChange={(e) => setDraftOccupation(e.target.value)} placeholder="e.g. Apprentice Electrician" className={inputCls} />
        </Field>
        <Field label="Expected income this year ($)">
          <input disabled={disabled} type="number" value={draftIncome} onChange={(e) => setDraftIncome(e.target.value)} placeholder="e.g. 52000" className={inputCls} />
        </Field>
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={() => onSave(draftOccupation, parseFloat(draftIncome) || 0)}
          disabled={disabled || !canSave}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: TEAL }}
        >
          Save
        </button>
      </div>
    </Card>
  );
}

function TopQuickPanel({ onUpload, onLogTravel, disabled }: { onUpload: () => void; onLogTravel: () => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <button
        onClick={onUpload}
        disabled={disabled}
        className="flex items-center gap-3 p-5 rounded-2xl border bg-white text-left shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5"
        style={{ borderColor: GREY_LINE }}
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
          <UploadCloud size={20} color={TEAL_DARK} />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: NAVY }}>Upload receipt</div>
          <div className="text-xs mt-0.5" style={{ color: "#8A93A3" }}>Snap it, sort it later</div>
        </div>
      </button>
      <button
        onClick={onLogTravel}
        disabled={disabled}
        className="flex items-center gap-3 p-5 rounded-2xl border bg-white text-left shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5"
        style={{ borderColor: GREY_LINE }}
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
          <Car size={20} color={TEAL_DARK} />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: NAVY }}>Log travel</div>
          <div className="text-xs mt-0.5" style={{ color: "#8A93A3" }}>Add a trip to your logbook</div>
        </div>
      </button>
    </div>
  );
}

function QuickActionsBar({ actions, disabled }: { actions: { label: string; icon: React.ElementType; onClick: () => void }[]; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          disabled={disabled}
          className="flex flex-col items-center gap-2 p-3.5 rounded-2xl border bg-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:shadow-card-hover hover:not-disabled:-translate-y-0.5"
          style={{ borderColor: GREY_LINE }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: TEAL_TINT }}>
            <a.icon size={16} color={TEAL_DARK} />
          </div>
          <span className="text-[11px] font-medium text-center leading-tight" style={{ color: NAVY }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function ReadinessItem({ ok, title, detail, cta, onGo }: { ok: boolean; title: string; detail: string; cta?: string; onGo?: () => void }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b last:border-0" style={{ borderColor: GREY_LINE }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: ok ? TEAL_TINT : AMBER_TINT }}>
        {ok ? <Check size={14} color={TEAL_DARK} strokeWidth={3} /> : <AlertTriangle size={13} color={AMBER} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: NAVY }}>{title}</div>
        <div className="text-xs mt-0.5" style={{ color: "#8A93A3" }}>{detail}</div>
      </div>
      {!ok && cta && onGo && (
        <button onClick={onGo} className="text-xs font-semibold flex-shrink-0 px-3 py-1.5 rounded-lg transition hover:brightness-105" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>{cta}</button>
      )}
    </div>
  );
}

function MethodCompareCard({ centsPerKmEstimate, logbookEstimate, logbookReady, businessKm }: { centsPerKmEstimate: number; logbookEstimate: number; logbookReady: boolean; businessKm: number }) {
  const recommendLogbook = logbookReady && logbookEstimate >= centsPerKmEstimate;
  const capped = businessKm > CENTS_PER_KM_CAP_KM;
  return (
    <Card className="p-5">
      <SectionTitle title="Recommended method" eyebrow="Cents/km vs logbook" />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="p-3 rounded-xl border" style={{ borderColor: !recommendLogbook && logbookReady ? TEAL : GREY_LINE, backgroundColor: !recommendLogbook && logbookReady ? TEAL_TINT : "#FBFBFC" }}>
          <div className="text-[11px] font-medium" style={{ color: "#8A93A3" }}>Cents per km</div>
          <div className="text-lg font-bold tabular mt-0.5" style={{ color: NAVY }}>{fmt(centsPerKmEstimate)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "#8A93A3" }}>{Math.min(businessKm, CENTS_PER_KM_CAP_KM).toFixed(0)} km × {(CENTS_PER_KM_RATE * 100).toFixed(0)}¢{capped ? " (capped at 5,000 km)" : ""}</div>
        </div>
        <div className="p-3 rounded-xl border" style={{ borderColor: recommendLogbook ? TEAL : GREY_LINE, backgroundColor: recommendLogbook ? TEAL_TINT : "#FBFBFC" }}>
          <div className="text-[11px] font-medium" style={{ color: "#8A93A3" }}>Logbook method</div>
          <div className="text-lg font-bold tabular mt-0.5" style={{ color: NAVY }}>{logbookReady ? fmt(logbookEstimate) : "—"}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "#8A93A3" }}>{logbookReady ? "Business % × total car costs" : "Finish your 12-week logbook to unlock this"}</div>
        </div>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "#8A93A3" }}>
        {logbookReady
          ? recommendLogbook
            ? "Based on what's logged so far, the logbook method looks like the better claim — it's not capped by kilometres like cents/km is."
            : "Based on what's logged so far, cents/km looks simpler and about as good — no need to keep tracking every vehicle expense receipt."
          : capped
          ? "You're already over the 5,000 km cap for cents/km — finishing your logbook could unlock a bigger, uncapped claim."
          : "Cents/km is fine to use for now. Once your 12-week logbook is done, TaxMate will tell you if switching to the logbook method is worth more."}
      </p>
    </Card>
  );
}

/* =================================================================
   MAIN APP
==================================================================*/
type TabKey = "overview" | "receipts" | "vehicle" | "expenses" | "checklist" | "summary";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptFormCategoryLock, setReceiptFormCategoryLock] = useState<CategoryKey | undefined>(undefined);
  const [receiptCategoryFilter, setReceiptCategoryFilter] = useState<CategoryKey | "all">("all");
  const [showTripForm, setShowTripForm] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [demoMode, setDemoMode] = useState<boolean>(() => loadDemoFlag());
  const [csvPreview, setCsvPreview] = useState<Trip[] | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData(DEFAULT_DATA).then(setData); }, []);
  useEffect(() => { if (data && !demoMode) saveData(data); }, [data, demoMode]);

  if (!data) {
    return (
      <div className="min-h-[500px] flex items-center justify-center" style={{ backgroundColor: GREY_BG }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: NAVY_SOFT }}>
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TEAL, borderTopColor: "transparent" }} />
          Loading your dashboard…
        </div>
      </div>
    );
  }

  const activeData: AppData = demoMode ? SAMPLE_DATA : data;

  const update = (fn: (d: AppData) => AppData) => {
    if (demoMode) return;
    setData((prev) => (prev ? fn(structuredClone(prev)) : prev));
  };

  const addReceipt = (r: ReceiptT) => { update((d) => { d.receipts.unshift(r); return d; }); setShowReceiptForm(false); setReceiptFormCategoryLock(undefined); };
  const deleteReceipt = (id: string) => update((d) => { d.receipts = d.receipts.filter((r) => r.id !== id); return d; });
  const addTrip = (t: Trip) => { update((d) => { d.trips.unshift(t); return d; }); setShowTripForm(false); };
  const deleteTrip = (id: string) => update((d) => { d.trips = d.trips.filter((t) => t.id !== id); return d; });
  const setProfile = <K extends keyof AppData["profile"]>(k: K, v: AppData["profile"][K]) => update((d) => { d.profile[k] = v; return d; });
  const setVehicle = <K extends keyof AppData["profile"]["vehicle"]>(k: K, v: AppData["profile"]["vehicle"][K]) => update((d) => { d.profile.vehicle[k] = v; return d; });

  const handleFiles = (files: File[]) => {
    if (demoMode) return;
    files.forEach((f) => {
      const id = uid();
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => setThumbs((p) => ({ ...p, [id]: e.target?.result as string }));
        reader.readAsDataURL(f);
      }
      update((d) => {
        d.receipts.unshift({ id, date: todayISO(), vendor: f.name.replace(/\.[^/.]+$/, ""), category: "other", amount: 0, workPct: 100, filed: false, notes: "Uploaded — add amount & category", fileName: f.name });
        return d;
      });
    });
  };

  const openReceiptQuickAdd = (cat: CategoryKey) => {
    if (demoMode) return;
    setReceiptFormCategoryLock(cat);
    setShowReceiptForm(true);
    setReceiptCategoryFilter("all");
    setTab("receipts");
  };

  const saveQuickSetup = (occupation: string, income: number) => {
    if (demoMode) return;
    update((d) => { d.profile.occupation = occupation; d.profile.income = income; d.profile.quickSetupDone = true; return d; });
  };

  const quickUploadReceipt = () => {
    if (demoMode) return;
    setReceiptCategoryFilter("all");
    setTab("receipts");
    receiptInputRef.current?.click();
  };

  const quickLogTravel = () => {
    if (demoMode) return;
    setTab("vehicle");
    setShowTripForm(true);
  };

  const handleCSVFile = (file: File) => {
    if (demoMode) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setCsvPreview(parseDriversnoteCSV(text));
      setTab("vehicle");
    };
    reader.readAsText(file);
  };

  const confirmCSVImport = () => {
    if (!csvPreview || !csvPreview.length) return;
    update((d) => { d.trips = [...csvPreview, ...d.trips]; return d; });
    setCsvPreview(null);
  };

  const enableDemo = () => { setDemoMode(true); saveDemoFlag(true); };
  const disableDemo = () => { setDemoMode(false); saveDemoFlag(false); };

  /* ---------------- derived numbers (based on activeData) ---------------- */
  const receiptsWithNum = activeData.receipts.map((r) => ({ ...r, amount: Number(r.amount) || 0, workPct: Number(r.workPct) || 0 }));
  const laundryEstimate = Number(activeData.profile.laundryEstimate) || 0;
  const totalDeductions = receiptsWithNum.reduce((s, r) => s + r.amount * (r.workPct / 100), 0) + laundryEstimate;
  const totalSpend = receiptsWithNum.reduce((s, r) => s + r.amount, 0);
  const unfiledCount = receiptsWithNum.filter((r) => !r.filed).length;
  const missingDetailsCount = receiptsWithNum.filter((r) => !r.vendor || !r.amount || r.amount <= 0).length;
  const receiptsFiledPct = receiptsWithNum.length ? Math.round((receiptsWithNum.filter((r) => r.filed).length / receiptsWithNum.length) * 100) : 0;

  const income = Number(activeData.profile.income) || 0;
  const withheld = Number(activeData.profile.taxWithheld) || 0;
  const taxBefore = totalTax(income);
  const taxAfter = totalTax(Math.max(0, income - totalDeductions));
  const deductionSaving = taxBefore - taxAfter;
  const estimatedRefund = withheld > 0 ? withheld - taxAfter : deductionSaving;

  const trips = activeData.trips.map((t) => ({ ...t, km: Number(t.km) || 0 }));
  const businessKm = trips.filter((t) => t.type === "business").reduce((s, t) => s + t.km, 0);
  const personalKm = trips.filter((t) => t.type === "personal").reduce((s, t) => s + t.km, 0);
  const totalKm = businessKm + personalKm;
  const businessPct = totalKm > 0 ? Math.round((businessKm / totalKm) * 100) : 0;
  const firstTripDate = trips.length ? trips.map((t) => t.date).sort()[0] : null;
  const daysElapsed = firstTripDate ? Math.floor((Date.now() - new Date(firstTripDate).getTime()) / 86400000) + 1 : 0;
  const logbookProgress = Math.max(0, Math.min(1, daysElapsed / 84));
  const logbookReady = logbookProgress >= 1;
  const vehicleEvidenceComplete = logbookReady && businessKm > 0;
  const currentOdometer = (Number(activeData.profile.vehicle.openingOdometer) || 0) + totalKm;

  const monthlyTotals = FY_MONTHS.map(() => 0);
  receiptsWithNum.forEach((r) => {
    if (!r.date) return;
    const d = new Date(r.date);
    const idx = (d.getMonth() - 6 + 12) % 12;
    monthlyTotals[idx] += r.amount;
  });

  const categoryTotals = CATEGORIES.map((c) => ({
    ...c,
    total: receiptsWithNum.filter((r) => r.category === c.key).reduce((s, r) => s + r.amount, 0),
    deductible: receiptsWithNum.filter((r) => r.category === c.key).reduce((s, r) => s + r.amount * (r.workPct / 100), 0),
    count: receiptsWithNum.filter((r) => r.category === c.key).length,
  }));

  const vehicleExpenseTotal = categoryTotals.find((c) => c.key === "vehicle")?.total || 0;
  const centsPerKmEstimate = Math.min(businessKm, CENTS_PER_KM_CAP_KM) * CENTS_PER_KM_RATE;
  const logbookEstimate = (businessPct / 100) * vehicleExpenseTotal;

  const laundryAdded = laundryEstimate > 0;
  const phonePctAdded = (Number(activeData.profile.phoneWorkPct) || 0) > 0;
  const accountantReady = receiptsWithNum.length > 0 && receiptsFiledPct === 100 && missingDetailsCount === 0 && vehicleEvidenceComplete && laundryAdded && phonePctAdded && income > 0;

  const readinessChecks = [
    { key: "filed", ok: receiptsWithNum.length > 0 && receiptsFiledPct === 100, title: "Receipts saved", detail: receiptsWithNum.length ? `${receiptsFiledPct}% of ${receiptsWithNum.length} receipts marked as filed` : "No receipts logged yet", cta: "Review receipts", onGo: () => setTab("receipts") },
    { key: "missing", ok: missingDetailsCount === 0, title: "Missing receipt details", detail: missingDetailsCount ? `${missingDetailsCount} receipt(s) still need a vendor or amount` : "All receipts have complete details", cta: "Fix details", onGo: () => setTab("receipts") },
    { key: "vehicle", ok: vehicleEvidenceComplete, title: "Vehicle evidence complete", detail: vehicleEvidenceComplete ? "12-week logbook complete with business km logged" : `${Math.min(daysElapsed, 84)}/84 days of your logbook done`, cta: "Go to logbook", onGo: () => setTab("vehicle") },
    { key: "laundry", ok: laundryAdded, title: "Laundry estimate added", detail: laundryAdded ? `${fmt(laundryEstimate)} claimed for uniform laundering` : "Add an estimate for washing your work uniform", cta: "Add estimate", onGo: () => setTab("expenses") },
    { key: "phone", ok: phonePctAdded, title: "Phone work-use % added", detail: phonePctAdded ? `${activeData.profile.phoneWorkPct}% of your phone bill claimed as work use` : "Set what % of your phone use is for work", cta: "Add %", onGo: () => setTab("expenses") },
    { key: "accountant", ok: accountantReady, title: "Accountant summary ready", detail: accountantReady ? "Everything's in good shape for tax time" : "A few things above still need attention before your pack is complete", cta: "View pack", onGo: () => setTab("summary") },
  ];
  const readinessScore = readinessChecks.filter((c) => c.ok).length;

  const exportCSV = () => {
    const rows: (string | number)[][] = [["Date", "Vendor", "Category", "Amount", "Work %", "Deductible", "Filed", "Notes"]];
    receiptsWithNum.forEach((r) => rows.push([r.date, r.vendor, CATEGORIES.find((c) => c.key === r.category)?.label || r.category, r.amount.toFixed(2), r.workPct, ((r.amount * r.workPct) / 100).toFixed(2), r.filed ? "Yes" : "No", r.notes || ""]));
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tax-receipts-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const setupSteps: SetupStep[] = [
    { key: "vehicle", label: "Add vehicle details", done: !!(activeData.profile.vehicle.make && activeData.profile.vehicle.rego), onGo: () => setTab("vehicle") },
    { key: "odometer", label: "Enter opening odometer", done: (Number(activeData.profile.vehicle.openingOdometer) || 0) > 0, onGo: () => setTab("vehicle") },
    { key: "receipt", label: "Upload your first receipt", done: receiptsWithNum.length > 0, onGo: () => setTab("receipts") },
    { key: "logbook", label: "Start your 12-week logbook", done: trips.length > 0, onGo: () => setTab("vehicle") },
    { key: "income", label: "Add tax withheld", done: withheld > 0, onGo: () => setTab("expenses") },
  ];

  const quickActions = [
    { label: "Add tool receipt", icon: Wrench, onClick: () => openReceiptQuickAdd("tools") },
    { label: "Add fuel receipt", icon: Fuel, onClick: () => openReceiptQuickAdd("vehicle") },
    { label: "Add PPE/clothing", icon: HardHat, onClick: () => openReceiptQuickAdd("ppe") },
    { label: "Add TAFE cost", icon: GraduationCap, onClick: () => openReceiptQuickAdd("tafe") },
    { label: "Add work trip", icon: Car, onClick: () => { if (demoMode) return; setTab("vehicle"); setShowTripForm(true); } },
    { label: "Import Driversnote CSV", icon: Upload, onClick: () => { if (demoMode) return; csvInputRef.current?.click(); } },
  ];

  const NAV: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "receipts", label: "Receipts", icon: Receipt },
    { key: "vehicle", label: "Vehicle Logbook", icon: Car },
    { key: "expenses", label: "Deductions", icon: Wrench },
    { key: "checklist", label: "Tax Checklist", icon: ShieldCheck },
    { key: "summary", label: "Accountant Pack", icon: FileText },
  ];

  const filteredReceipts = receiptCategoryFilter === "all" ? receiptsWithNum : receiptsWithNum.filter((r) => r.category === receiptCategoryFilter);

  /* ---------------- render ---------------- */
  return (
    <div className="min-h-screen w-full font-sans" style={{ backgroundColor: GREY_BG }}>
      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCSVFile(f); e.target.value = ""; }} />
      <input ref={receiptInputRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />

      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 h-screen sticky top-0 border-r px-4 py-6 print:hidden" style={{ borderColor: GREY_LINE, backgroundColor: "#FFFFFF" }}>
          <div className="flex items-center gap-2 px-2 mb-8">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}><Gauge size={16} color={TEAL} /></div>
            <div>
              <div className="text-sm font-bold leading-tight" style={{ color: NAVY }}>TaxMate Tradie</div>
              <div className="text-[11px] text-[#8A93A3] leading-tight">{activeData.profile.fy}</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => (
              <button key={n.key} onClick={() => setTab(n.key)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all" style={tab === n.key ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
                <n.icon size={17} />{n.label}{tab === n.key && <ChevronRight size={14} className="ml-auto" />}
              </button>
            ))}
          </nav>
          <div className="mt-auto pt-6 space-y-3">
            <button onClick={demoMode ? disableDemo : enableDemo} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition" style={demoMode ? { backgroundColor: AMBER_TINT, borderColor: AMBER_TINT, color: "#8A5A0F" } : { borderColor: GREY_LINE, color: NAVY_SOFT }}>
              {demoMode ? <><X size={13} /> Clear demo data</> : <><Sparkles size={13} /> View sample apprentice data</>}
            </button>
            <div className="rounded-2xl p-4" style={{ backgroundColor: NAVY }}>
              <Sparkles size={16} color={TEAL} />
              <p className="text-xs text-white/80 mt-2 leading-relaxed">Receipt scanning and Supabase sync are next on the roadmap.</p>
            </div>
          </div>
        </aside>

        <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 border-b print:hidden" style={{ backgroundColor: "#FFFFFFF2", borderColor: GREY_LINE, backdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}><Gauge size={14} color={TEAL} /></div>
            <span className="text-sm font-bold" style={{ color: NAVY }}>TaxMate Tradie</span>
          </div>
          <button onClick={() => setMobileNav((v) => !v)} className="p-2 rounded-lg" style={{ color: NAVY }}><Menu size={20} /></button>
        </div>
        {mobileNav && (
          <div className="lg:hidden fixed top-[52px] left-0 right-0 z-30 bg-white border-b px-4 py-3 grid grid-cols-3 gap-2" style={{ borderColor: GREY_LINE }}>
            {NAV.map((n) => (
              <button key={n.key} onClick={() => { setTab(n.key); setMobileNav(false); }} className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-[11px] font-medium text-center leading-tight" style={tab === n.key ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
                <n.icon size={17} />{n.label}
              </button>
            ))}
            <button onClick={() => { demoMode ? disableDemo() : enableDemo(); setMobileNav(false); }} className="col-span-3 mt-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border" style={demoMode ? { backgroundColor: AMBER_TINT, borderColor: AMBER_TINT, color: "#8A5A0F" } : { borderColor: GREY_LINE, color: NAVY_SOFT }}>
              {demoMode ? <><X size={13} /> Clear demo data</> : <><Sparkles size={13} /> View sample apprentice data</>}
            </button>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pt-[68px] lg:pt-8 pb-24 lg:pb-10 max-w-6xl mx-auto w-full">
          {demoMode && (
            <div className="mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl fade-up" style={{ backgroundColor: TEAL_TINT }}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: TEAL_DARK }}><Sparkles size={15} />Viewing sample apprentice data — nothing here is saved</div>
              <button onClick={disableDemo} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white hover:brightness-95 transition flex-shrink-0" style={{ color: TEAL_DARK }}>Clear demo data</button>
            </div>
          )}

          {tab === "overview" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: NAVY }}>G'day{activeData.profile.name ? `, ${activeData.profile.name}` : ""} 👋</h1>
                  <p className="text-sm mt-1" style={{ color: "#8A93A3" }}>{activeData.profile.occupation} · {activeData.profile.fy}</p>
                </div>
                <Pill tone={unfiledCount > 0 ? "amber" : "teal"}>{unfiledCount > 0 ? `${unfiledCount} receipts to file` : receiptsWithNum.length ? "All receipts filed" : "No receipts yet"}</Pill>
              </div>

              <TopQuickPanel onUpload={quickUploadReceipt} onLogTravel={quickLogTravel} disabled={demoMode} />

              {!activeData.profile.quickSetupDone && (
                <QuickSetupCard
                  occupation={activeData.profile.occupation}
                  income={activeData.profile.income}
                  onSave={saveQuickSetup}
                  disabled={demoMode}
                />
              )}

              <SetupCard steps={setupSteps} />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                <Card className="p-5" delay={60}>
                  <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium" style={{ color: "#8A93A3" }}>Total Deductions</span><TrendingUp size={15} color={TEAL} /></div>
                  <div className="text-2xl font-bold tabular" style={{ color: NAVY }}><AnimatedNumber value={totalDeductions} /></div>
                  <div className="text-xs mt-1" style={{ color: "#8A93A3" }}>from {fmt(totalSpend)} logged spend{laundryAdded ? ` + ${fmt(laundryEstimate)} laundry` : ""}</div>
                </Card>
                <Card className="p-5" delay={100}>
                  <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium" style={{ color: "#8A93A3" }}>Receipts Logged</span><Receipt size={15} color={TEAL} /></div>
                  <div className="text-2xl font-bold tabular" style={{ color: NAVY }}>{receiptsWithNum.length}</div>
                  <div className="text-xs mt-1" style={{ color: "#8A93A3" }}>{unfiledCount} awaiting details</div>
                </Card>
                <Card className="p-5" delay={140}>
                  <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium" style={{ color: "#8A93A3" }}>Business Km Share</span><MapPin size={15} color={TEAL} /></div>
                  <div className="text-2xl font-bold tabular" style={{ color: NAVY }}>{businessPct}%</div>
                  <div className="text-xs mt-1" style={{ color: "#8A93A3" }}>{Math.round(businessKm)} km of {Math.round(totalKm)} km logged</div>
                </Card>
                <Card className="p-5" delay={180}>
                  <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium" style={{ color: "#8A93A3" }}>ATO Readiness</span><ShieldCheck size={15} color={TEAL} /></div>
                  <div className="text-2xl font-bold tabular" style={{ color: NAVY }}>{readinessScore}/{readinessChecks.length}</div>
                  <div className="w-full h-1.5 rounded-full bg-[#EEF0F4] mt-2 overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(readinessScore / readinessChecks.length) * 100}%`, backgroundColor: TEAL }} /></div>
                </Card>
              </div>

              <div>
                <SectionTitle title="Quick actions" eyebrow="Log as you go" sub="The faster you log a receipt or trip, the less scrambling at tax time." />
                <QuickActionsBar actions={quickActions} disabled={demoMode} />
              </div>

              <Card className="p-6" delay={220}>
                <SectionTitle eyebrow="Trends" title="Monthly Spending" />
                <ChartCanvas type="bar" data={{ labels: FY_MONTHS, datasets: [{ label: "Spend", data: monthlyTotals, backgroundColor: TEAL, borderRadius: 6, maxBarThickness: 28 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => fmt(c.parsed.y) } } }, scales: { y: { grid: { color: "#F0F1F4" }, ticks: { callback: (v: any) => `$${v}` } }, x: { grid: { display: false } } } }}
                  heightClass="h-64" />
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Card className="p-6" delay={260}>
                  <SectionTitle eyebrow="Breakdown" title="Deductions by Category" />
                  {categoryTotals.some((c) => c.deductible > 0) ? (
                    <ChartCanvas type="doughnut"
                      data={{ labels: categoryTotals.filter((c) => c.deductible > 0).map((c) => c.label), datasets: [{ data: categoryTotals.filter((c) => c.deductible > 0).map((c) => c.deductible), backgroundColor: [TEAL, "#4FB8AF", NAVY, NAVY_SOFT, AMBER, "#7C93B8", "#B7BEC9"], borderWidth: 0 }] }}
                      options={{ responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { boxWidth: 8, font: { size: 11 }, padding: 12 } } } }}
                      heightClass="h-64" />
                  ) : (
                    <EmptyState icon={Receipt} title="No deductions yet" subtitle="Add a receipt and this chart fills in automatically." />
                  )}
                </Card>
                <Card className="p-6" delay={300}>
                  <SectionTitle eyebrow="Logbook" title="Business vs Personal Km" />
                  {totalKm > 0 ? (
                    <ChartCanvas type="doughnut"
                      data={{ labels: ["Business", "Personal"], datasets: [{ data: [businessKm || 0, personalKm || 0], backgroundColor: [TEAL, "#E7E9EE"], borderWidth: 0 }] }}
                      options={{ responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { boxWidth: 8, font: { size: 11 }, padding: 12 } } } }}
                      heightClass="h-64" />
                  ) : (
                    <EmptyState icon={Car} title="No trips logged yet" subtitle="Start your 12-week logbook to see your business-use split here." />
                  )}
                </Card>
              </div>
            </div>
          )}

          {tab === "receipts" && (
            <div className="space-y-6">
              <SectionTitle title="Receipt Tracker" eyebrow="Every deduction, in one place" sub="Upload as you go — TaxMate sorts them by category and works out what's deductible."
                action={<button onClick={() => { setReceiptFormCategoryLock(undefined); setShowReceiptForm((v) => !v); }} disabled={demoMode} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition disabled:opacity-50" style={{ backgroundColor: TEAL }}><Plus size={15} />Add receipt</button>} />
              <Card className="p-6"><Dropzone onFiles={handleFiles} disabled={demoMode} /></Card>
              {showReceiptForm && !demoMode && <ReceiptForm onSave={addReceipt} onCancel={() => { setShowReceiptForm(false); setReceiptFormCategoryLock(undefined); }} categoryLock={receiptFormCategoryLock} />}
              <Card className="p-2 sm:p-4">
                <div className="flex items-center gap-2 flex-wrap px-2 pt-2 pb-3">
                  <button onClick={() => setReceiptCategoryFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === "all" ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>All</button>
                  {CATEGORIES.map((c) => (
                    <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === c.key ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>{c.label}</button>
                  ))}
                </div>
                <div className="px-2">
                  {filteredReceipts.length === 0 ? (
                    <EmptyState icon={Receipt} title="No receipts here yet" subtitle="Drag a photo into the box above, or use a quick action on Overview — TaxMate will sort it into the right category." />
                  ) : (
                    filteredReceipts.map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} thumb={thumbs[r.id]} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "vehicle" && (
            <div className="space-y-6">
              <SectionTitle title="Vehicle Logbook" eyebrow="Your biggest deduction, done properly" sub="Vehicle claims are usually the single largest deduction for tradies — a complete logbook makes it easy to prove."
                action={<button onClick={() => setShowTripForm((v) => !v)} disabled={demoMode} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition disabled:opacity-50" style={{ backgroundColor: TEAL }}><Plus size={15} />Log a trip</button>} />

              <Card className="p-5">
                <SectionTitle title="Vehicle details" eyebrow="For your logbook & records" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Make"><input disabled={demoMode} value={activeData.profile.vehicle.make} onChange={(e) => setVehicle("make", e.target.value)} className={inputCls} placeholder="Toyota" /></Field>
                  <Field label="Model"><input disabled={demoMode} value={activeData.profile.vehicle.model} onChange={(e) => setVehicle("model", e.target.value)} className={inputCls} placeholder="HiLux" /></Field>
                  <Field label="Rego"><input disabled={demoMode} value={activeData.profile.vehicle.rego} onChange={(e) => setVehicle("rego", e.target.value)} className={inputCls} placeholder="1AB2CD" /></Field>
                  <Field label="Opening odometer (km)"><input disabled={demoMode} type="number" value={activeData.profile.vehicle.openingOdometer} onChange={(e) => setVehicle("openingOdometer", Number(e.target.value))} className={inputCls} /></Field>
                </div>
              </Card>

              <Card className="p-5" style={{ borderColor: firstTripDate ? GREY_LINE : AMBER }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: NAVY }}>12-week continuous logbook</span>
                  <span className="text-xs font-medium tabular" style={{ color: NAVY_SOFT }}>{Math.min(daysElapsed, 84)} / 84 days</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#EEF0F4] overflow-hidden mb-3"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${logbookProgress * 100}%`, backgroundColor: TEAL }} /></div>
                <p className="text-xs leading-relaxed" style={{ color: "#8A93A3" }}>For the logbook method, the ATO wants a continuous 12-week period that records <b>every</b> trip — work and private — not just work journeys. Start it now and stay consistent; once done, it can support your claims for up to five years while your driving pattern stays similar.</p>
              </Card>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card className="p-4 text-center" delay={0}><div className="text-xl font-bold tabular" style={{ color: NAVY }}>{Math.round(businessKm)}</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Business km</div></Card>
                <Card className="p-4 text-center" delay={40}><div className="text-xl font-bold tabular" style={{ color: NAVY }}>{Math.round(personalKm)}</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Personal km</div></Card>
                <Card className="p-4 text-center" delay={80}><div className="text-xl font-bold tabular" style={{ color: TEAL_DARK }}>{businessPct}%</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Business use</div></Card>
                <Card className="p-4 text-center" delay={120}><div className="text-xl font-bold tabular" style={{ color: NAVY }}>{currentOdometer > 0 ? Math.round(currentOdometer).toLocaleString() : "—"}</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Current odometer (est.)</div></Card>
              </div>

              <MethodCompareCard centsPerKmEstimate={centsPerKmEstimate} logbookEstimate={logbookEstimate} logbookReady={logbookReady} businessKm={businessKm} />

              <div>
                <SectionTitle title="Import from Driversnote" eyebrow="Optional" sub="Export a CSV from Driversnote and drop it in — TaxMate will match up dates, distances and trip purposes." />
                <button onClick={() => csvInputRef.current?.click()} disabled={demoMode} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition disabled:opacity-50" style={{ borderColor: GREY_LINE, color: NAVY }}><Upload size={15} />Import Driversnote CSV</button>
              </div>

              {csvPreview && (
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: NAVY }}>Driversnote import preview</div>
                      <div className="text-xs mt-0.5" style={{ color: "#8A93A3" }}>{csvPreview.length} trip{csvPreview.length !== 1 ? "s" : ""} found — review before adding, business/personal may need a manual fix</div>
                    </div>
                    <button onClick={() => setCsvPreview(null)} className="p-1.5 rounded-lg text-[#B7BEC9] hover:bg-[#F0F1F4] transition flex-shrink-0"><X size={16} /></button>
                  </div>
                  {csvPreview.length === 0 ? (
                    <p className="text-sm" style={{ color: "#8A93A3" }}>Couldn't find any trips in that file — check it's a CSV export with date, distance and purpose columns.</p>
                  ) : (
                    <>
                      <div className="max-h-56 overflow-y-auto rounded-xl border" style={{ borderColor: GREY_LINE }}>
                        {csvPreview.slice(0, 50).map((t) => (
                          <div key={t.id} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 text-xs" style={{ borderColor: GREY_LINE }}>
                            <span className="tabular flex-shrink-0" style={{ color: "#8A93A3" }}>{t.date}</span>
                            <span className="flex-1 truncate" style={{ color: NAVY }}>{t.purpose}</span>
                            <span className="tabular font-medium flex-shrink-0" style={{ color: NAVY }}>{t.km} km</span>
                            <Pill tone={t.type === "business" ? "teal" : "grey"}>{t.type}</Pill>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2 mt-3">
                        <button onClick={() => setCsvPreview(null)} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5B6472] hover:bg-[#F0F1F4] transition">Cancel</button>
                        <button onClick={confirmCSVImport} className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition" style={{ backgroundColor: TEAL }}>Add {csvPreview.length} trips</button>
                      </div>
                    </>
                  )}
                </Card>
              )}

              {showTripForm && !demoMode && <TripForm onSave={addTrip} onCancel={() => setShowTripForm(false)} />}

              <Card className="p-2 sm:p-4">
                <div className="px-2 pt-2 pb-1 text-xs font-semibold" style={{ color: NAVY_SOFT }}>Trip log</div>
                <div className="px-2">
                  {trips.length === 0 ? (
                    <EmptyState icon={Car} title="No trips logged yet" subtitle="Log your first trip above, or import a Driversnote CSV to backfill your history." />
                  ) : (
                    trips.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: GREY_LINE }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: t.type === "business" ? TEAL_TINT : "#F0F1F4" }}><Car size={15} color={t.type === "business" ? TEAL_DARK : "#8A93A3"} /></div>
                        <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate" style={{ color: NAVY }}>{t.purpose}</div><div className="text-xs text-[#8A93A3]">{new Date(t.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div></div>
                        <div className="text-sm font-semibold tabular" style={{ color: NAVY }}>{t.km} km</div>
                        <Pill tone={t.type === "business" ? "teal" : "grey"}>{t.type === "business" ? "Business" : "Personal"}</Pill>
                        <button onClick={() => deleteTrip(t.id)} className="p-1.5 rounded-lg text-[#B7BEC9] hover:text-[#C4573F] hover:bg-[#FBEAE6] transition"><Trash2 size={15} /></button>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <SectionTitle title="Vehicle Expense Tracker" eyebrow="Fuel, servicing, rego & insurance" sub="These feed the logbook-method estimate above." />
              <Card className="p-2 sm:p-4">
                <div className="px-2">
                  {receiptsWithNum.filter((r) => r.category === "vehicle").length === 0 ? (
                    <EmptyState icon={Fuel} title="No vehicle expenses yet" subtitle={'Use the "Add fuel receipt" quick action on Overview, or log fuel, servicing or insurance here as "Vehicle & Fuel".'} />
                  ) : (
                    receiptsWithNum.filter((r) => r.category === "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} thumb={thumbs[r.id]} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "expenses" && (
            <div className="space-y-6">
              <SectionTitle title="Deductions" eyebrow="Tools · Clothing · PPE · Phone · TAFE" sub="Tap a category to filter, or use a quick action on Overview to add straight into it." />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {categoryTotals.filter((c) => c.key !== "vehicle" && c.key !== "other").map((c, i) => (
                  <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="text-left">
                    <Card className="p-4 h-full" delay={i * 40}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: TEAL_TINT }}><c.icon size={16} color={TEAL_DARK} /></div>
                      <div className="text-sm font-semibold" style={{ color: NAVY }}>{c.label}</div>
                      <div className="text-lg font-bold tabular mt-1" style={{ color: NAVY }}>{fmt(c.total)}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: "#8A93A3" }}>{c.count} receipt{c.count !== 1 ? "s" : ""}</div>
                    </Card>
                  </button>
                ))}
              </div>

              <Card className="p-5">
                <SectionTitle title="Your details" eyebrow="Used for your accountant summary" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Your name"><input disabled={demoMode} value={activeData.profile.name} onChange={(e) => setProfile("name", e.target.value)} placeholder="Optional" className={inputCls} /></Field>
                  <Field label="Tax withheld ($)"><input disabled={demoMode} type="number" value={activeData.profile.taxWithheld} onChange={(e) => setProfile("taxWithheld", Number(e.target.value))} className={inputCls} /></Field>
                </div>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Other common deductions" eyebrow="No receipts needed under ATO thresholds" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Laundry & uniform estimate (up to $${LAUNDRY_ATO_CAP} without receipts)`}>
                    <input disabled={demoMode} type="number" value={activeData.profile.laundryEstimate} onChange={(e) => setProfile("laundryEstimate", Number(e.target.value))} className={inputCls} />
                  </Field>
                  <Field label="Phone & internet work-use %">
                    <input disabled={demoMode} type="number" min={0} max={100} value={activeData.profile.phoneWorkPct} onChange={(e) => setProfile("phoneWorkPct", Number(e.target.value))} className={inputCls} />
                  </Field>
                </div>
                <p className="text-xs mt-3 leading-relaxed" style={{ color: "#8A93A3" }}>The ATO allows a reasonable estimate for laundering work uniforms without keeping receipts, up to ${LAUNDRY_ATO_CAP} a year. Your phone % should reflect genuine work use — check a typical bill if you're not sure.</p>
              </Card>

              <Card className="p-2 sm:p-4">
                <div className="flex items-center gap-2 flex-wrap px-2 pt-2 pb-3">
                  <button onClick={() => setReceiptCategoryFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === "all" ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>All work expenses</button>
                  {CATEGORIES.filter((c) => c.key !== "vehicle").map((c) => (
                    <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === c.key ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>{c.label}</button>
                  ))}
                </div>
                <div className="px-2">
                  {filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").length === 0 ? (
                    <EmptyState icon={Wrench} title="Nothing here yet" subtitle="Add a receipt from Overview's quick actions, or use the Add receipt button on the Receipts tab." />
                  ) : (
                    filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} thumb={thumbs[r.id]} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "checklist" && (
            <div className="space-y-6">
              <SectionTitle title="ATO Readiness" eyebrow={`${readinessScore} of ${readinessChecks.length} ready`} sub="Updates automatically as you log receipts, trips and details — no manual ticking needed." />
              <Card className="p-2">
                {readinessChecks.map((c) => <ReadinessItem key={c.key} ok={c.ok} title={c.title} detail={c.detail} cta={c.cta} onGo={c.onGo} />)}
              </Card>
            </div>
          )}

          {tab === "summary" && (
            <div className="space-y-6">
              <SectionTitle title="Accountant Pack" eyebrow="Print or export, ready to send"
                action={<div className="flex gap-2 print:hidden">
                  <button onClick={exportCSV} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition hover:bg-[#F6F7F9]" style={{ borderColor: GREY_LINE, color: NAVY }}><Download size={15} />Export CSV</button>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition" style={{ backgroundColor: TEAL }}><Printer size={15} />Print</button>
                </div>} />

              <Card className="p-4 flex items-center gap-3" style={{ backgroundColor: accountantReady ? TEAL_TINT : AMBER_TINT }}>
                {accountantReady ? <CheckCircle2 size={18} color={TEAL_DARK} /> : <AlertTriangle size={16} color={AMBER} />}
                <div className="text-sm font-medium" style={{ color: accountantReady ? TEAL_DARK : "#8A5A0F" }}>{accountantReady ? "This pack is ready to send to your accountant." : "A few things in Tax Checklist still need attention before this pack is fully ready."}</div>
              </Card>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[["Gross income", fmt(income)], ["Total deductions", fmt(totalDeductions)], ["Tax withheld", fmt(withheld)], ["Est. refund / owing", fmt(estimatedRefund)]].map(([l, v], i) => (
                  <Card key={l} className="p-4" delay={i * 40}><div className="text-[11px] font-medium" style={{ color: "#8A93A3" }}>{l}</div><div className="text-lg font-bold tabular mt-1" style={{ color: NAVY }}>{v}</div></Card>
                ))}
              </div>
              <Card className="p-6">
                <SectionTitle title="Deductions by category" />
                <div className="divide-y" style={{ borderColor: GREY_LINE }}>
                  {categoryTotals.map((c) => (
                    <div key={c.key} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2 text-sm" style={{ color: NAVY }}><c.icon size={14} color={TEAL_DARK} />{c.label}</div>
                      <div className="text-sm font-semibold tabular" style={{ color: NAVY }}>{fmt(c.deductible)}</div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2 text-sm" style={{ color: NAVY }}><Shirt size={14} color={TEAL_DARK} />Laundry & uniform estimate</div>
                    <div className="text-sm font-semibold tabular" style={{ color: NAVY }}>{fmt(laundryEstimate)}</div>
                  </div>
                </div>
              </Card>
              <Card className="p-6">
                <SectionTitle title="Vehicle logbook status" />
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div><div className="text-lg font-bold tabular" style={{ color: NAVY }}>{Math.round(businessKm)} km</div><div className="text-[11px]" style={{ color: "#8A93A3" }}>Business</div></div>
                  <div><div className="text-lg font-bold tabular" style={{ color: NAVY }}>{Math.round(personalKm)} km</div><div className="text-[11px]" style={{ color: "#8A93A3" }}>Personal</div></div>
                  <div><div className="text-lg font-bold tabular" style={{ color: TEAL_DARK }}>{businessPct}%</div><div className="text-[11px]" style={{ color: "#8A93A3" }}>Business use</div></div>
                </div>
              </Card>
              <Card className="p-6">
                <SectionTitle title="Outstanding items" />
                {readinessChecks.filter((c) => !c.ok).length === 0 ? (
                  <p className="text-sm" style={{ color: NAVY_SOFT }}>Nothing outstanding — you're in great shape for tax time.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {readinessChecks.filter((c) => !c.ok).map((c) => <li key={c.key} className="text-xs flex items-center gap-2" style={{ color: "#8A93A3" }}><span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: AMBER }} />{c.title}</li>)}
                  </ul>
                )}
              </Card>
              <p className="text-xs text-center pb-4" style={{ color: "#B7BEC9" }}>This dashboard is a record-keeping tool, not tax advice. Confirm deductibility with a registered tax agent.</p>
            </div>
          )}
        </main>
      </div>

      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t px-2 py-1.5 flex justify-around print:hidden" style={{ borderColor: GREY_LINE }}>
        {NAV.slice(0, 5).map((n) => (
          <button key={n.key} onClick={() => setTab(n.key)} className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-xl flex-1" style={tab === n.key ? { color: TEAL_DARK } : { color: "#B7BEC9" }}>
            <n.icon size={19} /><span className="text-[9.5px] font-medium text-center leading-tight">{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}






