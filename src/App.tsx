import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Receipt, Car, Wrench, Shirt, HardHat, Smartphone,
  GraduationCap, FileText, Plus, Trash2, ChevronRight, Menu,
  Download, Printer, TrendingUp, Gauge, MapPin, Sparkles, Camera,
  Check, CheckCircle2, AlertTriangle, Fuel, Upload, ShieldCheck, X,
  Search, SlidersHorizontal, Send, Mic, LogOut, Landmark,
  Info, Wallet, Bell, MoreHorizontal, WashingMachine, Settings as SettingsIcon,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { AppData, Receipt as ReceiptT, Trip, CategoryKey, Profile } from "./types";
import { loadData, saveData, loadDemoFlag, saveDemoFlag } from "./lib/storage";
import { supabase, arrivedViaInviteOrRecovery } from "./lib/supabaseClient";
import { SAMPLE_DATA } from "./sampleData";
import { parseDriversnoteCSV } from "./csv";
import BenefitsFeature from "./benefits/BenefitsFeature";

/* ---------------------------------------------------------------
   Design tokens
----------------------------------------------------------------*/
export const NAVY = "#132038";
export const NAVY_SOFT = "#3A4A66";
export const TEAL = "#0E9C94";
export const TEAL_DARK = "#0B7A73";
export const TEAL_TINT = "#E6F5F3";
const GREY_BG = "#F6F7F9";
export const GREY_LINE = "#E7E9EE";
export const AMBER = "#C77F1A";
export const AMBER_TINT = "#FBF0DE";

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

const RECEIPT_SCANNER_URL = import.meta.env.VITE_RECEIPT_SCANNER_URL;
const ASSISTANT_URL = RECEIPT_SCANNER_URL ? `${RECEIPT_SCANNER_URL.replace(/\/$/, "")}/assistant` : undefined;
const TRANSCRIBE_URL = RECEIPT_SCANNER_URL ? `${RECEIPT_SCANNER_URL.replace(/\/$/, "")}/transcribe` : undefined;
const DISTANCE_URL = RECEIPT_SCANNER_URL ? `${RECEIPT_SCANNER_URL.replace(/\/$/, "")}/distance` : undefined;
const VOICE_SUPPORTED = typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

interface AssistantMessage { role: "user" | "assistant"; content: any[] }

interface ScannedReceipt {
  vendor?: string;
  date?: string;
  amount?: number;
  category?: CategoryKey;
  confidence?: "high" | "medium" | "low";
}

interface ScanQueueItem {
  id: string;
  file: File;
  thumb: string;
  result: ScannedReceipt | null;
  scanning: boolean;
  failed: boolean;
}

function resizeImageForScan(file: File, maxEdge = 1568, quality = 0.85): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ base64: dataUrl.split(",")[1] || "", mediaType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load image")); };
    img.src = url;
  });
}

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

export function Card({ children, className = "", style, delay = 0 }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; delay?: number }) {
  return (
    <div
      className={`fade-up bg-white rounded-2xl border border-[#E7E9EE] shadow-card hover:shadow-card-hover transition-shadow duration-300 ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: React.ReactNode }) {
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

export function Pill({ children, tone = "grey" }: { children: React.ReactNode; tone?: "grey" | "teal" | "amber" }) {
  const tones: Record<string, string> = {
    grey: "bg-[#F0F1F4] text-[#5B6472]",
    teal: "text-white",
    amber: "bg-[#FBF0DE] text-[#8A5A0F]",
  };
  const style = tone === "teal" ? { backgroundColor: TEAL } : undefined;
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone]}`} style={style}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: NAVY_SOFT }}>{label}</span>
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] px-3 py-2 text-sm text-[#132038] focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed";

export function EmptyState({ icon: Icon, title, subtitle, action }: { icon: React.ElementType; title: string; subtitle: string; action?: React.ReactNode }) {
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

function RadialProgress({ pct, label, size = 88 }: { pct: number; label: string; size?: number }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold text-white tabular">{Math.round(clamped * 100)}%</span>
      </div>
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-white/80 whitespace-nowrap">{label}</div>
    </div>
  );
}

function ReceiptForm({ onSave, onCancel, categoryLock, initial }: { onSave: (r: ReceiptT) => void; onCancel: () => void; categoryLock?: CategoryKey; initial?: ReceiptT }) {
  const [r, setR] = useState<{ id: string; date: string; vendor: string; category: CategoryKey; amount: string; workPct: string; filed: boolean; notes: string }>(
    initial
      ? { id: initial.id, date: initial.date, vendor: initial.vendor, category: initial.category, amount: initial.amount ? String(initial.amount) : "", workPct: String(initial.workPct), filed: initial.filed, notes: initial.notes || "" }
      : { id: uid(), date: todayISO(), vendor: "", category: categoryLock || "tools", amount: "", workPct: "100", filed: true, notes: "" }
  );
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
          {initial ? "Save changes" : "Save receipt"}
        </button>
      </div>
    </div>
  );
}

function ReceiptReviewModal({ item, onSave, onCancel }: { item: ScanQueueItem; onSave: (r: ReceiptT) => void; onCancel: () => void }) {
  const result = item.result;
  const initial: ReceiptT = {
    id: item.id,
    date: result?.date || todayISO(),
    vendor: result?.vendor || item.file.name.replace(/\.[^/.]+$/, ""),
    category: result?.category || "other",
    amount: result?.amount && result.amount > 0 ? result.amount : 0,
    workPct: 100,
    filed: false,
    notes: result ? (result.confidence === "low" ? "Auto-filled by AI — please double-check these details" : "Auto-filled by AI — check before filing") : "",
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: NAVY }}>Review receipt</span>
        <button onClick={onCancel} className="p-1.5 rounded-lg text-[#B7BEC9] hover:bg-[#F0F1F4] transition"><X size={16} /></button>
      </div>
      {item.thumb && <img src={item.thumb} alt="" className="w-full max-h-52 object-cover rounded-2xl" />}
      {item.scanning ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TEAL, borderTopColor: "transparent" }} />
          <span className="text-sm font-medium" style={{ color: NAVY }}>Reading your receipt…</span>
        </div>
      ) : (
        <>
          {result && (
            <Card className="p-4 flex items-start gap-3">
              <Sparkles size={16} color={TEAL_DARK} className="flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold" style={{ color: NAVY }}>AI Detected</div>
                <div className="text-xs mt-0.5 mb-2" style={{ color: "#8A93A3" }}>We've read your receipt — check the details below before saving.</div>
                <Pill tone={result.confidence === "low" ? "amber" : "teal"}>
                  {result.confidence === "low" ? "Low confidence — please check" : result.confidence === "medium" ? "Medium confidence" : "High confidence"}
                </Pill>
              </div>
            </Card>
          )}
          {item.failed && (
            <Card className="p-4 flex items-center gap-2.5" style={{ backgroundColor: AMBER_TINT }}>
              <AlertTriangle size={16} color={AMBER} className="flex-shrink-0" />
              <span className="text-sm" style={{ color: "#8A5A0F" }}>Couldn't read this one automatically — fill in the details manually.</span>
            </Card>
          )}
          <ReceiptForm initial={initial} onSave={onSave} onCancel={onCancel} />
        </>
      )}
    </div>
  );
}

function ReceiptRow({ r, onDelete, onEdit }: { r: ReceiptT; onDelete: (id: string) => void; onEdit: (r: ReceiptT) => void }) {
  const ded = r.amount * (r.workPct / 100);
  const cat = CATEGORIES.find((c) => c.key === r.category);
  const incomplete = !r.vendor || !r.amount;
  return (
    <div role="button" tabIndex={0} onClick={() => onEdit(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onEdit(r); }} className="w-full flex items-center gap-3 py-3 px-1 border-b last:border-0 text-left transition hover:bg-[#FBFBFC] cursor-pointer" style={{ borderColor: GREY_LINE }}>
      <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
        {cat && <cat.icon size={16} color={TEAL_DARK} />}
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
      <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} className="p-1.5 rounded-lg text-[#B7BEC9] hover:text-[#C4573F] hover:bg-[#FBEAE6] transition flex-shrink-0"><Trash2 size={15} /></button>
    </div>
  );
}

function TripForm({ onSave, onCancel }: { onSave: (t: Trip) => void; onCancel: () => void }) {
  const [t, setT] = useState<{ id: string; date: string; purpose: string; type: "business" | "personal"; km: string }>({
    id: uid(), date: todayISO(), purpose: "", type: "business", km: "",
  });
  const kmRef = useRef<HTMLInputElement>(null);
  useEffect(() => { kmRef.current?.focus(); }, []);
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) => setT((p) => ({ ...p, [k]: v }));
  const canSave = (parseFloat(t.km) || 0) > 0;
  return (
    <div className="p-5 rounded-2xl border bg-white" style={{ borderColor: GREY_LINE }}>
      <span className="text-sm font-semibold" style={{ color: NAVY }}>Log a trip</span>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <button onClick={() => set("type", "business")} className="py-3 rounded-xl text-sm font-semibold border transition" style={t.type === "business" ? { backgroundColor: TEAL, borderColor: TEAL, color: "#fff" } : { borderColor: GREY_LINE, color: NAVY, backgroundColor: "#FBFBFC" }}>Business</button>
        <button onClick={() => set("type", "personal")} className="py-3 rounded-xl text-sm font-semibold border transition" style={t.type === "personal" ? { backgroundColor: NAVY, borderColor: NAVY, color: "#fff" } : { borderColor: GREY_LINE, color: NAVY, backgroundColor: "#FBFBFC" }}>Personal</button>
      </div>
      <div className="mt-3">
        <Field label="Kilometres">
          <input ref={kmRef} type="number" step="0.1" inputMode="decimal" value={t.km} onChange={(e) => set("km", e.target.value)} placeholder="0.0" className={`${inputCls} text-2xl font-bold py-3 tabular`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Purpose (optional)"><input value={t.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Site visit — Preston" className={inputCls} /></Field>
        <Field label="Date"><input type="date" value={t.date} onChange={(e) => set("date", e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5B6472] hover:bg-[#F0F1F4] transition">Cancel</button>
        <button
          onClick={() => { if (!canSave) return; onSave({ id: t.id, date: t.date, purpose: t.purpose, type: t.type, km: parseFloat(t.km) || 0 }); }}
          disabled={!canSave}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: TEAL }}
        >
          Log trip
        </button>
      </div>
    </div>
  );
}

function AnimatedBar({ pct, color = TEAL }: { pct: number; color?: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = window.setTimeout(() => setWidth(pct), 120); return () => window.clearTimeout(t); }, [pct]);
  return (
    <div className="w-full h-2 rounded-full bg-[#EEF0F4] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${width * 100}%`, backgroundColor: color }} />
    </div>
  );
}

function TrendSparkline({ points, color = "#fff" }: { points: number[]; color?: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 280, h = 56;
  const stepX = w / (points.length - 1);
  const coords = points.map((p, i) => [i * stepX, h - ((p - min) / range) * h] as const);
  const pathD = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${w},${h} L0,${h} Z`;
  const gradId = "sparkFade";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} stroke="none" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3.5 : 2} fill={color} opacity={i === coords.length - 1 ? 1 : 0.5} />
      ))}
    </svg>
  );
}

function Disclosure({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="p-0 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left">
        <span className="text-sm font-semibold" style={{ color: NAVY }}>{title}</span>
        <ChevronRight size={16} color="#B7BEC9" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && <div className="px-5 pb-5 fade-up">{children}</div>}
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

function FloatingActionButton({ onScan, onLogTrip, onAddExpense, onImportCsv, disabled }: { onScan: () => void; onLogTrip: () => void; onAddExpense: () => void; onImportCsv: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const items = [
    { label: "Scan Receipt", icon: Camera, onClick: onScan },
    { label: "Log Trip", icon: Car, onClick: onLogTrip },
    { label: "Add Expense", icon: Receipt, onClick: onAddExpense },
    { label: "Import CSV", icon: Upload, onClick: onImportCsv },
  ];

  const handlePointerDown = () => {
    if (disabled) return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => { longPressed.current = true; onScan(); }, 500);
  };
  const handlePointerUp = () => { if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const handleClick = () => {
    if (longPressed.current) { longPressed.current = false; return; }
    setOpen((v) => !v);
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <div className="fixed right-4 sm:right-6 bottom-20 lg:bottom-6 z-40 flex flex-col items-end gap-3">
        {open && (
          <div className="flex flex-col items-end gap-2 mb-1">
            {items.map((it, i) => (
              <button
                key={it.label}
                onClick={() => { it.onClick(); setOpen(false); }}
                disabled={disabled}
                className="fade-up flex items-center gap-2.5 pl-4 pr-3 py-2.5 rounded-full bg-white shadow-card border text-sm font-semibold transition disabled:opacity-50 hover:brightness-95"
                style={{ borderColor: GREY_LINE, color: NAVY, animationDelay: `${i * 30}ms` }}
              >
                {it.label}
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
                  <it.icon size={15} color={TEAL_DARK} />
                </div>
              </button>
            ))}
          </div>
        )}
        <button
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleClick}
          disabled={disabled}
          aria-label={open ? "Close quick actions" : "Quick actions"}
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-card-hover transition-transform duration-200 disabled:opacity-50"
          style={{ backgroundColor: TEAL, transform: open ? "rotate(45deg)" : "none" }}
        >
          <Plus size={24} color="#fff" />
        </button>
      </div>
    </>
  );
}

function AssistantButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="TaxMate AI"
      className="fixed left-4 sm:left-6 bottom-20 lg:bottom-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-card-hover transition disabled:opacity-50"
      style={{ backgroundColor: NAVY }}
    >
      <Sparkles size={22} color={TEAL} />
    </button>
  );
}

const ASSISTANT_QUICK_REPLY_RE = /business or personal|business\/personal/i;
const MAX_RECORDING_MS = 20000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function AssistantModal({ messages, loading, onSend, onClose, disabled }: { messages: AssistantMessage[]; loading: boolean; onSend: (text: string) => void; onClose: () => void; disabled?: boolean }) {
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxDurationTimerRef = useRef<number | null>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    if (maxDurationTimerRef.current) window.clearTimeout(maxDurationTimerRef.current);
  }, []);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || disabled) return;
    onSend(trimmed);
    setInput("");
  };

  const startRecording = async () => {
    if (!VOICE_SUPPORTED || !TRANSCRIBE_URL || loading || disabled || recording || transcribing) return;
    setVoiceError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (maxDurationTimerRef.current) { window.clearTimeout(maxDurationTimerRef.current); maxDurationTimerRef.current = null; }
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) return; // too short to be real speech
        setTranscribing(true);
        try {
          const base64 = await blobToBase64(blob);
          const res = await fetch(TRANSCRIBE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64 }),
          });
          if (!res.ok) throw new Error("transcribe failed");
          const data = await res.json();
          const text = (data.text || "").trim();
          if (text) send(text);
          else setVoiceError("Didn't catch that — try again.");
        } catch {
          setVoiceError("Couldn't transcribe that — check your connection and try again.");
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      maxDurationTimerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (err: any) {
      setRecording(false);
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setVoiceError("Microphone access was blocked — check your browser's site settings and allow the microphone.");
      } else if (err?.name === "NotFoundError") {
        setVoiceError("No microphone found on this device.");
      } else {
        setVoiceError("Couldn't access the microphone on this browser.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  };

  const lastAssistantText = (() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return "";
    return last.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
  })();
  const showQuickReplies = !loading && ASSISTANT_QUICK_REPLY_RE.test(lastAssistantText);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: GREY_LINE }}>
        <div className="flex items-center gap-2">
          <Sparkles size={17} color={TEAL_DARK} />
          <span className="text-sm font-bold" style={{ color: NAVY }}>TaxMate AI</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-[#B7BEC9] hover:bg-[#F0F1F4] transition"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-2xl px-4 py-3 max-w-[85%]" style={{ backgroundColor: "#FBFBFC" }}>
            <p className="text-sm leading-relaxed" style={{ color: NAVY }}>Hi! I'm your TaxMate AI. Ask me anything about your tax, deductions or claims — or tell me about a trip or expense and I'll log it for you.{VOICE_SUPPORTED && TRANSCRIBE_URL ? " Tap the mic to just talk — handy when your hands are full." : ""}</p>
          </div>
        )}
        {messages.map((m, i) => {
          const text = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
          if (!text) return null;
          return (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap" style={m.role === "user" ? { backgroundColor: TEAL, color: "#fff" } : { backgroundColor: "#FBFBFC", color: NAVY }}>
                {text}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "#FBFBFC" }}>
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#B7BEC9" }} />
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#B7BEC9", animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#B7BEC9", animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        {showQuickReplies && (
          <div className="flex gap-2 fade-up">
            <button onClick={() => send("Business")} className="px-4 py-2 rounded-full text-sm font-semibold border transition hover:brightness-95" style={{ borderColor: GREY_LINE, color: NAVY }}>Business</button>
            <button onClick={() => send("Personal")} className="px-4 py-2 rounded-full text-sm font-semibold border transition hover:brightness-95" style={{ borderColor: GREY_LINE, color: NAVY }}>Personal</button>
          </div>
        )}
      </div>

      {voiceError && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs flex-shrink-0" style={{ backgroundColor: AMBER_TINT, color: "#8A5A0F" }}>
          <span>{voiceError}</span>
          <button onClick={() => setVoiceError("")} className="flex-shrink-0"><X size={12} /></button>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3 border-t flex-shrink-0" style={{ borderColor: GREY_LINE }}>
        {VOICE_SUPPORTED && TRANSCRIBE_URL && (
          <button
            onClick={() => (recording ? stopRecording() : startRecording())}
            disabled={disabled || loading || transcribing}
            aria-label={recording ? "Stop recording" : "Speak"}
            className={`p-3 rounded-xl transition disabled:opacity-50 flex-shrink-0 ${recording ? "animate-pulse" : ""}`}
            style={recording ? { backgroundColor: "#C4573F", color: "#fff" } : { backgroundColor: TEAL_TINT, color: TEAL_DARK }}
          >
            <Mic size={17} />
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
          placeholder={disabled ? "Not available in demo mode" : recording ? "Listening…" : transcribing ? "Transcribing…" : "Ask me anything…"}
          disabled={disabled || loading || recording || transcribing}
          className={inputCls}
        />
        <button onClick={() => send(input)} disabled={disabled || loading || !input.trim()} className="p-3 rounded-xl text-white transition disabled:opacity-50 flex-shrink-0" style={{ backgroundColor: TEAL }}>
          <Send size={17} />
        </button>
      </div>
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
   AUTH
==================================================================*/
function AuthLogo() {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}><Gauge size={20} color={TEAL} /></div>
      <span className="text-lg font-bold" style={{ color: NAVY }}>TaxMate Tradie</span>
    </div>
  );
}

function ConfigMissingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: GREY_BG }}>
      <div className="w-full max-w-sm text-center">
        <AuthLogo />
        <Card className="p-6">
          <p className="text-sm" style={{ color: NAVY }}>Accounts aren't set up yet — <code className="text-xs">VITE_SUPABASE_URL</code> and <code className="text-xs">VITE_SUPABASE_ANON_KEY</code> are missing from this build.</p>
        </Card>
      </div>
    </div>
  );
}

function AuthScreen({ needsPasswordSetup, onPasswordSet }: { needsPasswordSetup: boolean; onPasswordSet: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!supabase || loading) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSetPassword = async () => {
    if (!supabase || loading) return;
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    onPasswordSet();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: GREY_BG }}>
      <div className="w-full max-w-sm">
        <AuthLogo />
        <Card className="p-6">
          {needsPasswordSetup ? (
            <>
              <h1 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Welcome — set your password</h1>
              <p className="text-sm mb-4" style={{ color: "#8A93A3" }}>Choose a password to finish setting up your account.</p>
              <Field label="New password">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSetPassword()} placeholder="At least 8 characters" className={inputCls} />
              </Field>
              {error && <p className="text-xs mt-2" style={{ color: "#C4573F" }}>{error}</p>}
              <button onClick={handleSetPassword} disabled={loading || !password} className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition hover:brightness-110" style={{ backgroundColor: TEAL }}>
                {loading ? "Saving…" : "Save password & continue"}
              </button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold mb-1" style={{ color: NAVY }}>Log in</h1>
              <p className="text-sm mb-4" style={{ color: "#8A93A3" }}>Accounts are invite-only — ask for an invite if you don't have one yet.</p>
              <div className="space-y-3">
                <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} className={inputCls} /></Field>
                <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} className={inputCls} /></Field>
              </div>
              {error && <p className="text-xs mt-2" style={{ color: "#C4573F" }}>{error}</p>}
              <button onClick={handleLogin} disabled={loading || !email || !password} className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition hover:brightness-110" style={{ backgroundColor: TEAL }}>
                {loading ? "Logging in…" : "Log in"}
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* =================================================================
   MAIN APP
==================================================================*/
type TabKey = "overview" | "vehicle" | "expenses" | "progress" | "summary" | "benefits" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still checking
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState<boolean>(arrivedViaInviteOrRecovery);
  const [data, setData] = useState<AppData | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptFormCategoryLock, setReceiptFormCategoryLock] = useState<CategoryKey | undefined>(undefined);
  const [receiptCategoryFilter, setReceiptCategoryFilter] = useState<CategoryKey | "all">("all");
  const [showReceiptFilters, setShowReceiptFilters] = useState(false);
  const [receiptSearch, setReceiptSearch] = useState("");
  const [receiptSegment, setReceiptSegment] = useState<"needsAttention" | "recent" | "completed">("recent");
  const [editingReceipt, setEditingReceipt] = useState<ReceiptT | null>(null);
  const [showTripForm, setShowTripForm] = useState(false);
  const [showLogbookInfo, setShowLogbookInfo] = useState(false);
  const [scanQueue, setScanQueue] = useState<ScanQueueItem[]>([]);
  const [demoMode, setDemoMode] = useState<boolean>(() => loadDemoFlag());
  const [csvPreview, setCsvPreview] = useState<Trip[] | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptsListRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadData(DEFAULT_DATA, session.user.id).then(setData);
  }, [session?.user.id]);

  useEffect(() => {
    if (!data || !session || demoMode) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { saveData(data, session.user.id); }, 800);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [data, demoMode, session]);

  const handleLogout = async () => { if (supabase) await supabase.auth.signOut(); };

  if (!supabase) {
    return <ConfigMissingScreen />;
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: GREY_BG }}>
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TEAL, borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!session || needsPasswordSetup) {
    return (
      <AuthScreen
        needsPasswordSetup={!!session && needsPasswordSetup}
        onPasswordSet={() => {
          window.history.replaceState(null, "", window.location.pathname);
          setNeedsPasswordSetup(false);
        }}
      />
    );
  }

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
  const saveReceiptEdit = (r: ReceiptT) => { update((d) => { d.receipts = d.receipts.map((existing) => (existing.id === r.id ? r : existing)); return d; }); setEditingReceipt(null); };
  const addTrip = (t: Trip) => { update((d) => { d.trips.unshift(t); return d; }); setShowTripForm(false); };
  const addTrips = (ts: Trip[]) => { update((d) => { d.trips = [...ts, ...d.trips]; return d; }); };
  const updateTravelProfile = (patch: Partial<Pick<Profile, "homeAddress" | "lastWorksite" | "assumeRoundTrip">>) => update((d) => { d.profile = { ...d.profile, ...patch }; return d; });
  const deleteTrip = (id: string) => update((d) => { d.trips = d.trips.filter((t) => t.id !== id); return d; });
  const setProfile = <K extends keyof AppData["profile"]>(k: K, v: AppData["profile"][K]) => update((d) => { d.profile[k] = v; return d; });
  const setVehicle = <K extends keyof AppData["profile"]["vehicle"]>(k: K, v: AppData["profile"]["vehicle"][K]) => update((d) => { d.profile.vehicle[k] = v; return d; });

  const scanReceipt = async (id: string, file: File) => {
    try {
      const { base64, mediaType } = await resizeImageForScan(file);
      const res = await fetch(RECEIPT_SCANNER_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType }),
      });
      if (!res.ok) throw new Error("scan failed");
      const result: ScannedReceipt = await res.json();
      setScanQueue((p) => p.map((it) => (it.id === id ? { ...it, result, scanning: false } : it)));
    } catch {
      setScanQueue((p) => p.map((it) => (it.id === id ? { ...it, scanning: false, failed: true } : it)));
    }
  };

  const handleFiles = (files: File[]) => {
    if (demoMode) return;
    files.forEach((f) => {
      const id = uid();
      const isImage = f.type.startsWith("image/");
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const thumb = (e.target?.result as string) || "";
          const willScan = !!RECEIPT_SCANNER_URL;
          setScanQueue((p) => [...p, { id, file: f, thumb, result: null, scanning: willScan, failed: false }]);
          if (willScan) scanReceipt(id, f);
        };
        reader.readAsDataURL(f);
      } else {
        setScanQueue((p) => [...p, { id, file: f, thumb: "", result: null, scanning: false, failed: false }]);
      }
    });
  };

  const openManualExpenseEntry = () => {
    if (demoMode) return;
    setReceiptFormCategoryLock(undefined);
    setShowReceiptForm(true);
    setReceiptCategoryFilter("all");
    setTab("progress");
  };

  const saveQuickSetup = (occupation: string, income: number) => {
    if (demoMode) return;
    update((d) => { d.profile.occupation = occupation; d.profile.income = income; d.profile.quickSetupDone = true; return d; });
  };

  const quickUploadReceipt = () => {
    if (demoMode) return;
    setReceiptCategoryFilter("all");
    setTab("progress");
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

  const buildAssistantContext = () => ({
    occupation: activeData.profile.occupation,
    income,
    totalDeductions,
    estimatedRefund,
    receiptsCount: receiptsWithNum.length,
    tripsCount: trips.length,
    logbookDays: Math.min(daysElapsed, 84),
    today: todayISO(),
    homeAddress: activeData.profile.homeAddress,
    lastWorksite: activeData.profile.lastWorksite,
    assumeRoundTrip: activeData.profile.assumeRoundTrip,
  });

  const executeAssistantTool = async (name: string, input: any): Promise<string> => {
    if (demoMode) return "Can't make changes in demo mode.";
    switch (name) {
      case "log_trip": {
        const t: Trip = { id: uid(), date: todayISO(), purpose: input.purpose || "", type: input.type === "personal" ? "personal" : "business", km: Number(input.km) || 0 };
        addTrip(t);
        return `Logged a ${t.km}km ${t.type} trip.`;
      }
      case "add_expense": {
        const category: CategoryKey = CATEGORIES.some((c) => c.key === input.category) ? input.category : "other";
        const r: ReceiptT = { id: uid(), date: todayISO(), vendor: input.vendor || "Untitled", category, amount: Number(input.amount) || 0, workPct: 100, filed: false, notes: "Added via TaxMate AI" };
        addReceipt(r);
        return `Added ${r.vendor} — ${fmtDec(r.amount)} to ${category}.`;
      }
      case "search_receipts": {
        const q = String(input.query || "").toLowerCase();
        const matches = receiptsWithNum.filter((r) => r.vendor.toLowerCase().includes(q) || (r.notes || "").toLowerCase().includes(q)).slice(0, 5);
        return JSON.stringify(matches.map((r) => ({ id: r.id, vendor: r.vendor, amount: r.amount, date: r.date, category: r.category, workPct: r.workPct })));
      }
      case "update_receipt": {
        const existing = receiptsWithNum.find((r) => r.id === input.id);
        if (!existing) return "Receipt not found — try search_receipts again.";
        const updated: ReceiptT = {
          ...existing,
          workPct: input.workPct !== undefined ? Number(input.workPct) : existing.workPct,
          amount: input.amount !== undefined ? Number(input.amount) : existing.amount,
          notes: input.notes !== undefined ? String(input.notes) : existing.notes,
        };
        saveReceiptEdit(updated);
        return "Updated.";
      }
      case "calculate_distance": {
        if (!DISTANCE_URL) return JSON.stringify({ error: "Distance lookup isn't configured." });
        try {
          const res = await fetch(DISTANCE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ origin: input.origin, destination: input.destination }),
          });
          if (!res.ok) return JSON.stringify({ error: "Distance lookup failed." });
          return JSON.stringify(await res.json());
        } catch {
          return JSON.stringify({ error: "Distance lookup failed — check your connection." });
        }
      }
      case "update_travel_profile": {
        const patch: Partial<Pick<Profile, "homeAddress" | "lastWorksite" | "assumeRoundTrip">> = {};
        if (input.homeAddress) patch.homeAddress = String(input.homeAddress);
        if (input.lastWorksite) patch.lastWorksite = String(input.lastWorksite);
        if (typeof input.assumeRoundTrip === "boolean") patch.assumeRoundTrip = input.assumeRoundTrip;
        updateTravelProfile(patch);
        return "Saved — I'll remember that next time.";
      }
      case "log_trip_range": {
        if (!DISTANCE_URL) return JSON.stringify({ error: "Distance lookup isn't configured." });
        const origin = String(input.origin || "").trim();
        const destination = String(input.destination || "").trim();
        if (!origin || !destination) return JSON.stringify({ error: "Missing origin or destination." });

        let oneWayKm: number;
        try {
          const res = await fetch(DISTANCE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ origin, destination }),
          });
          if (!res.ok) return JSON.stringify({ error: "Distance lookup failed." });
          const dist = await res.json();
          oneWayKm = Number(dist.distanceKm) || 0;
          if (!oneWayKm) return JSON.stringify({ error: dist.error || "Could not determine distance." });
        } catch {
          return JSON.stringify({ error: "Distance lookup failed — check your connection." });
        }

        const parseISODate = (s: string): number => {
          const [y, m, d] = String(s).split("-").map(Number);
          return Date.UTC(y || 0, (m || 1) - 1, d || 1);
        };
        const start = parseISODate(input.startDate);
        const end = parseISODate(input.endDate);
        if (!input.startDate || !input.endDate || isNaN(start) || isNaN(end) || start > end) {
          return JSON.stringify({ error: "Invalid date range." });
        }

        const roundTrip = input.roundTrip !== false;
        const skipWeekends = input.skipWeekends !== false;
        const tripType: "business" | "personal" = input.tripType === "personal" ? "personal" : "business";
        const kmPerDay = Math.round((roundTrip ? oneWayKm * 2 : oneWayKm) * 10) / 10;
        const purpose = String(input.purpose || `${origin} → ${destination}`);

        const dates: string[] = [];
        const DAY_MS = 86400000;
        for (let t = start; t <= end; t += DAY_MS) {
          const day = new Date(t).getUTCDay();
          if (skipWeekends && (day === 0 || day === 6)) continue;
          dates.push(new Date(t).toISOString().slice(0, 10));
        }
        if (!dates.length) return JSON.stringify({ error: "No workdays fall in that date range." });
        if (dates.length > 31) return JSON.stringify({ error: "That range is too long — try a shorter one (max 31 days)." });

        const newTrips: Trip[] = dates.map((date) => ({ id: uid(), date, purpose, type: tripType, km: kmPerDay }));
        addTrips(newTrips);
        updateTravelProfile({ lastWorksite: destination });

        return JSON.stringify({ created: newTrips.length, kmPerDay, totalKm: Math.round(kmPerDay * newTrips.length * 10) / 10, dates });
      }
      default:
        return "Unknown action.";
    }
  };

  const runAssistantConversation = async (history: AssistantMessage[]) => {
    if (!ASSISTANT_URL) return;
    setAssistantLoading(true);
    let current = history;
    try {
      for (let i = 0; i < 6; i++) {
        const res = await fetch(ASSISTANT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: current, context: buildAssistantContext() }),
        });
        if (!res.ok) throw new Error("assistant failed");
        const data = await res.json();
        const content = data.content || [];
        current = [...current, { role: "assistant", content }];
        setAssistantMessages(current);

        const toolUses = content.filter((b: any) => b.type === "tool_use");
        if (toolUses.length === 0) break;

        const toolResults = await Promise.all(toolUses.map(async (tu: any) => ({ type: "tool_result", tool_use_id: tu.id, content: await executeAssistantTool(tu.name, tu.input) })));
        current = [...current, { role: "user", content: toolResults }];
        setAssistantMessages(current);
      }
    } catch {
      setAssistantMessages((prev) => [...prev, { role: "assistant", content: [{ type: "text", text: "Sorry, I couldn't reach the assistant just then — try again in a moment." }] }]);
    } finally {
      setAssistantLoading(false);
    }
  };

  const sendAssistantMessage = (text: string) => {
    const updated: AssistantMessage[] = [...assistantMessages, { role: "user", content: [{ type: "text", text }] }];
    setAssistantMessages(updated);
    runAssistantConversation(updated);
  };

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
    { key: "filed", icon: Receipt, ok: receiptsWithNum.length > 0 && receiptsFiledPct === 100, title: "Receipts saved", detail: receiptsWithNum.length ? `${receiptsFiledPct}% of ${receiptsWithNum.length} receipts marked as filed` : "No receipts logged yet", cta: "Review receipts", onGo: () => setTab("progress") },
    { key: "missing", icon: AlertTriangle, ok: missingDetailsCount === 0, title: "Missing receipt details", detail: missingDetailsCount ? `${missingDetailsCount} receipt(s) still need a vendor or amount` : "All receipts have complete details", cta: "Fix details", onGo: () => setTab("progress") },
    { key: "vehicle", icon: Car, ok: vehicleEvidenceComplete, title: "Vehicle evidence complete", detail: vehicleEvidenceComplete ? "12-week logbook complete with business km logged" : `${Math.min(daysElapsed, 84)}/84 days of your logbook done`, cta: "Go to logbook", onGo: () => setTab("vehicle") },
    { key: "laundry", icon: Shirt, ok: laundryAdded, title: "Laundry estimate added", detail: laundryAdded ? `${fmt(laundryEstimate)} claimed for uniform laundering` : "Add an estimate for washing your work uniform", cta: "Add estimate", onGo: () => setTab("expenses") },
    { key: "phone", icon: Smartphone, ok: phonePctAdded, title: "Phone work-use % added", detail: phonePctAdded ? `${activeData.profile.phoneWorkPct}% of your phone bill claimed as work use` : "Set what % of your phone use is for work", cta: "Add %", onGo: () => setTab("expenses") },
    { key: "accountant", icon: FileText, ok: accountantReady, title: "Accountant summary ready", detail: accountantReady ? "Everything's in good shape for tax time" : "A few things above still need attention before your pack is complete", cta: "View pack", onGo: () => setTab("summary") },
  ];
  const readinessScore = readinessChecks.filter((c) => c.ok).length;
  const readyPct = readinessChecks.length ? readinessScore / readinessChecks.length : 0;
  const todaysTasks = readinessChecks.filter((c) => !c.ok && c.key !== "accountant").slice(0, 3);
  const laundryOpportunity = laundryAdded ? 0 : LAUNDRY_ATO_CAP;
  const laundryTaxBenefit = laundryOpportunity > 0 ? taxAfter - totalTax(Math.max(0, income - totalDeductions - laundryOpportunity)) : 0;
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";

  const catByKey = (k: CategoryKey) => categoryTotals.find((c) => c.key === k)!;
  const goToReceiptsFiltered = (key: CategoryKey) => { setReceiptCategoryFilter(key); setShowReceiptFilters(true); receiptsListRef.current?.scrollIntoView({ behavior: "smooth" }); };
  const deductionCategoryRows = [
    { key: "tools" as const, label: "Tools & Equipment", icon: Wrench, amount: catByKey("tools").deductible, sub: `${catByKey("tools").count} receipt${catByKey("tools").count === 1 ? "" : "s"}`, needsSetup: false, onGo: () => goToReceiptsFiltered("tools") },
    { key: "vehicle" as const, label: "Vehicle", icon: Car, amount: catByKey("vehicle").deductible, sub: `${businessPct}% business use`, needsSetup: false, onGo: () => goToReceiptsFiltered("vehicle") },
    { key: "ppe" as const, label: "PPE & Safety Gear", icon: HardHat, amount: catByKey("ppe").deductible, sub: `${catByKey("ppe").count} receipt${catByKey("ppe").count === 1 ? "" : "s"}`, needsSetup: false, onGo: () => goToReceiptsFiltered("ppe") },
    { key: "clothing" as const, label: "Clothing & Uniforms", icon: Shirt, amount: catByKey("clothing").deductible, sub: `${catByKey("clothing").count} receipt${catByKey("clothing").count === 1 ? "" : "s"}`, needsSetup: false, onGo: () => goToReceiptsFiltered("clothing") },
    { key: "phone" as const, label: "Phone & Internet", icon: Smartphone, amount: catByKey("phone").deductible, sub: phonePctAdded ? `${catByKey("phone").count} receipt${catByKey("phone").count === 1 ? "" : "s"}` : "Add your work-use %", needsSetup: !phonePctAdded, onGo: () => (phonePctAdded ? goToReceiptsFiltered("phone") : setTab("settings")) },
    { key: "laundry" as const, label: "Laundry", icon: WashingMachine, amount: laundryEstimate, sub: laundryAdded ? "Claimed" : "Add your estimate", needsSetup: !laundryAdded, onGo: () => setTab("settings") },
  ];
  const maxCategoryRowAmount = Math.max(...deductionCategoryRows.map((r) => r.amount), 1);
  const recentReceipts = receiptsWithNum.slice(0, 8);

  const weeklyDeductionsTrend = (() => {
    const weeks = 8;
    const buckets = Array(weeks).fill(0);
    const now = Date.now();
    receiptsWithNum.forEach((r) => {
      if (!r.date) return;
      const weeksAgo = Math.floor((now - new Date(r.date).getTime()) / (7 * 86400000));
      if (weeksAgo >= 0 && weeksAgo < weeks) buckets[weeks - 1 - weeksAgo] += r.amount * (r.workPct / 100);
    });
    let running = 0;
    return buckets.map((b) => (running += b));
  })();
  const weeklyDelta = weeklyDeductionsTrend.length > 1 ? weeklyDeductionsTrend[weeklyDeductionsTrend.length - 1] - weeklyDeductionsTrend[weeklyDeductionsTrend.length - 2] : 0;

  const monthlyDeductionsTrend = (() => {
    const months = 6;
    const buckets = Array(months).fill(0);
    const now = new Date();
    receiptsWithNum.forEach((r) => {
      if (!r.date) return;
      const d = new Date(r.date);
      const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      if (monthsAgo >= 0 && monthsAgo < months) buckets[months - 1 - monthsAgo] += r.amount * (r.workPct / 100);
    });
    let running = 0;
    return buckets.map((b) => (running += b));
  })();
  const thisMonthDelta = monthlyDeductionsTrend.length > 1 ? monthlyDeductionsTrend[monthlyDeductionsTrend.length - 1] - monthlyDeductionsTrend[monthlyDeductionsTrend.length - 2] : 0;
  const lastMonthTotal = monthlyDeductionsTrend.length > 1 ? monthlyDeductionsTrend[monthlyDeductionsTrend.length - 2] : 0;
  const monthGrowthPct = lastMonthTotal > 0 ? Math.round((thisMonthDelta / lastMonthTotal) * 100) : thisMonthDelta > 0 ? 100 : 0;

  const taxReadySummary = [
    { icon: Camera, label: `${receiptsWithNum.length} receipt${receiptsWithNum.length === 1 ? "" : "s"} logged`, done: receiptsWithNum.length > 0 },
    { icon: Car, label: `${trips.length} trip${trips.length === 1 ? "" : "s"} logged`, done: trips.length > 0 },
    { icon: Wrench, label: `${fmt(totalDeductions)} deductions`, done: totalDeductions > 0 },
    { icon: ShieldCheck, label: "Tax details complete", done: income > 0 && withheld > 0 },
  ];

  const todaySuggestion = (() => {
    if (unfiledCount > 0) return { text: `You have ${unfiledCount} receipt${unfiledCount === 1 ? "" : "s"} to file.`, action: () => setTab("progress") };
    if (missingDetailsCount > 0) return { text: `${missingDetailsCount} receipt${missingDetailsCount === 1 ? " needs" : "s need"} a vendor or amount.`, action: () => setTab("progress") };
    if (trips.length === 0) return { text: "Log today's work trip to start your 12-week logbook.", action: quickLogTravel };
    if (!logbookReady) return { text: `You're ${Math.min(daysElapsed, 84)} days into your logbook — keep it going.`, action: () => setTab("vehicle") };
    if (!laundryEstimate) return { text: "Add a laundry estimate — up to $150 without receipts.", action: () => setTab("expenses") };
    return null;
  })();

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

  const NAV: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Today", icon: LayoutDashboard },
    { key: "vehicle", label: "Logbook", icon: Car },
    { key: "expenses", label: "Deductions", icon: Wrench },
    { key: "benefits", label: "Benefits", icon: Landmark },
    { key: "progress", label: "Progress", icon: ShieldCheck },
  ];

  const filteredReceipts = receiptCategoryFilter === "all" ? receiptsWithNum : receiptsWithNum.filter((r) => r.category === receiptCategoryFilter);

  const receiptIsIncomplete = (r: ReceiptT) => !r.vendor || !r.amount || r.amount <= 0;
  const receiptSegments: { key: "needsAttention" | "recent" | "completed"; label: string; list: ReceiptT[] }[] = [
    { key: "needsAttention", label: "Needs Attention", list: filteredReceipts.filter(receiptIsIncomplete) },
    { key: "recent", label: "Recent", list: filteredReceipts },
    { key: "completed", label: "Completed", list: filteredReceipts.filter((r) => !receiptIsIncomplete(r) && r.filed) },
  ];
  const receiptSearchLower = receiptSearch.trim().toLowerCase();
  const receiptsForTab = (receiptSegments.find((s) => s.key === receiptSegment)?.list || filteredReceipts).filter(
    (r) => !receiptSearchLower || r.vendor.toLowerCase().includes(receiptSearchLower) || (r.notes || "").toLowerCase().includes(receiptSearchLower)
  );

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
          <div className="mt-auto pt-6 space-y-2">
            <button onClick={() => setTab("settings")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all" style={tab === "settings" ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
              <SettingsIcon size={17} />Settings{tab === "settings" && <ChevronRight size={14} className="ml-auto" />}
            </button>
            <button onClick={demoMode ? disableDemo : enableDemo} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition" style={demoMode ? { backgroundColor: AMBER_TINT, borderColor: AMBER_TINT, color: "#8A5A0F" } : { borderColor: GREY_LINE, color: NAVY_SOFT }}>
              {demoMode ? <><X size={13} /> Clear demo data</> : <><Sparkles size={13} /> View sample apprentice data</>}
            </button>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition" style={{ borderColor: GREY_LINE, color: NAVY_SOFT }}>
              <LogOut size={13} /> Log out
            </button>
          </div>
        </aside>

        <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 border-b print:hidden" style={{ backgroundColor: "#FFFFFFF2", borderColor: GREY_LINE, backdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}><Gauge size={14} color={TEAL} /></div>
            <span className="text-sm font-bold" style={{ color: NAVY }}>TaxMate Tradie</span>
          </div>
          <div className="relative p-2" aria-hidden="true"><Bell size={19} color={NAVY} /><span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: "#D64545" }} /></div>
        </div>
        {mobileNav && (
          <div className="lg:hidden fixed bottom-[64px] left-0 right-0 z-30 bg-white border-t px-4 py-3 space-y-1 rounded-t-2xl shadow-card-hover" style={{ borderColor: GREY_LINE }}>
            <button onClick={() => { setTab("progress"); setMobileNav(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium" style={tab === "progress" ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
              <ShieldCheck size={17} />Progress
            </button>
            <button onClick={() => { setTab("summary"); setMobileNav(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium" style={tab === "summary" ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
              <FileText size={17} />Accountant Pack
            </button>
            <button onClick={() => { setTab("settings"); setMobileNav(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium" style={tab === "settings" ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { color: "#5B6472" }}>
              <SettingsIcon size={17} />Settings
            </button>
            <div className="pt-2 mt-1 space-y-2" style={{ borderTop: "1px solid " + GREY_LINE }}>
              <button onClick={() => { demoMode ? disableDemo() : enableDemo(); setMobileNav(false); }} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border" style={demoMode ? { backgroundColor: AMBER_TINT, borderColor: AMBER_TINT, color: "#8A5A0F" } : { borderColor: GREY_LINE, color: NAVY_SOFT }}>
                {demoMode ? <><X size={13} /> Clear demo data</> : <><Sparkles size={13} /> View sample apprentice data</>}
              </button>
              <button onClick={() => { handleLogout(); setMobileNav(false); }} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border" style={{ borderColor: GREY_LINE, color: NAVY_SOFT }}>
                <LogOut size={13} /> Log out
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pt-[68px] lg:pt-8 pb-36 lg:pb-24 max-w-6xl mx-auto w-full">
          {demoMode && (
            <div className="mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl fade-up" style={{ backgroundColor: TEAL_TINT }}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: TEAL_DARK }}><Sparkles size={15} />Viewing sample apprentice data — nothing here is saved</div>
              <button onClick={disableDemo} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white hover:brightness-95 transition flex-shrink-0" style={{ color: TEAL_DARK }}>Clear demo data</button>
            </div>
          )}

          {tab === "overview" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold" style={{ color: NAVY }}>{greeting}{activeData.profile.name ? `, ${activeData.profile.name}` : ""} 👋</h1>
                <p className="text-sm mt-1" style={{ color: "#8A93A3" }}>{estimatedRefund > 0 ? "You're on track to save" : `${activeData.profile.occupation} · ${activeData.profile.fy}`}</p>
              </div>

              <div>
                <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Quick actions</div>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={quickUploadReceipt} disabled={demoMode} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white border shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5" style={{ borderColor: GREY_LINE }}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: NAVY }}><Camera size={18} color="#fff" /></div>
                    <span className="text-xs font-semibold" style={{ color: NAVY }}>Scan Receipt</span>
                  </button>
                  <button onClick={quickLogTravel} disabled={demoMode} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white border shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5" style={{ borderColor: GREY_LINE }}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: NAVY }}><Car size={18} color="#fff" /></div>
                    <span className="text-xs font-semibold" style={{ color: NAVY }}>Log Trip</span>
                  </button>
                  <button onClick={() => setAssistantOpen(true)} disabled={demoMode || !ASSISTANT_URL} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white border shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5" style={{ borderColor: GREY_LINE }}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: NAVY }}><Mic size={18} color="#fff" /></div>
                    <span className="text-xs font-semibold" style={{ color: NAVY }}>Ask TaxMate</span>
                  </button>
                </div>
              </div>

              {!activeData.profile.quickSetupDone ? (
                <QuickSetupCard
                  occupation={activeData.profile.occupation}
                  income={activeData.profile.income}
                  onSave={saveQuickSetup}
                  disabled={demoMode}
                />
              ) : (
                <div className="rounded-3xl p-6 fade-up" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${TEAL_DARK} 100%)` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/70">
                        Estimated Tax Position <Info size={12} />
                      </div>
                      <div className="text-xs mt-2 text-white/70">Estimated refund</div>
                      <div className="text-4xl font-bold tabular mt-0.5 text-white"><AnimatedNumber value={Math.max(0, estimatedRefund)} /></div>
                      {weeklyDelta > 0 && (
                        <div className="inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: "rgba(255,255,255,0.18)" }}>
                          <TrendingUp size={12} /> {fmt(weeklyDelta)} this month
                        </div>
                      )}
                    </div>
                    <div className="pt-2 pb-3"><RadialProgress pct={readyPct} label="Tax Ready" /></div>
                  </div>
                  <div className="mt-3 -mx-1">
                    <TrendSparkline points={weeklyDeductionsTrend} color="#5EEAD4" />
                  </div>
                  <div className="mt-5 pt-4 grid grid-cols-4 gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                    {[
                      { icon: Wallet, label: "Income", value: fmt(income) },
                      { icon: Landmark, label: "Tax withheld", value: fmt(withheld) },
                      { icon: Wallet, label: "Current deductions", value: fmt(totalDeductions) },
                      { icon: Car, label: "Vehicle method", value: "Logbook" },
                    ].map((s) => (
                      <div key={s.label} className="flex flex-col items-center text-center gap-1.5">
                        <s.icon size={15} className="text-white/60" />
                        <div className="text-[10px] leading-tight text-white/60">{s.label}</div>
                        <div className="text-xs font-semibold tabular text-white">{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {todaysTasks.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold" style={{ color: NAVY }}>Today's Tasks</span>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>{todaysTasks.length}</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: GREY_LINE }}>
                    {todaysTasks.map((t) => (
                      <button key={t.key} onClick={t.onGo} disabled={demoMode} className="w-full flex items-center gap-3 py-3 text-left disabled:opacity-50 disabled:cursor-not-allowed group">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}>
                          <t.icon size={16} color={TEAL_DARK} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold" style={{ color: NAVY }}>{t.title}</div>
                          <div className="text-xs mt-0.5 truncate" style={{ color: "#8A93A3" }}>{t.detail}</div>
                        </div>
                        <ChevronRight size={16} className="flex-shrink-0" style={{ color: "#B7BEC9" }} />
                      </button>
                    ))}
                  </div>
                  {laundryTaxBenefit > 0 && (
                    <div className="flex items-center justify-between pt-3 mt-1" style={{ borderTop: "1px solid " + GREY_LINE }}>
                      <span className="text-xs font-semibold" style={{ color: NAVY_SOFT }}>Estimated tax benefit today</span>
                      <span className="text-sm font-bold tabular" style={{ color: TEAL_DARK }}>+{fmt(laundryTaxBenefit)}</span>
                    </div>
                  )}
                </Card>
              )}

              {todaySuggestion && (
                <Card className="p-4 flex items-center gap-3">
                  <Sparkles size={16} color={TEAL_DARK} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#8A93A3" }}>TaxMate Insight</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: NAVY }}>{todaySuggestion.text}</div>
                  </div>
                  <button onClick={todaySuggestion.action} disabled={demoMode} className="px-3.5 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 disabled:opacity-50 transition hover:brightness-95" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>
                    Add now
                  </button>
                </Card>
              )}
            </div>
          )}

          {tab === "progress" && (
            <div className="space-y-4">
              <SectionTitle title="Progress" />

              {(() => {
                const readyMessage = readyPct >= 0.8 ? "You're almost there! 🎉" : readyPct >= 0.4 ? "You're making great progress! 🎉" : "Let's get your claim sorted.";
                return (
                  <div className="rounded-3xl p-6 fade-up text-white" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${TEAL_DARK} 100%)` }}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/70">Tax Ready</div>
                    <div className="text-5xl font-bold mt-1 tabular">{Math.round(readyPct * 100)}%</div>
                    <div className="mt-3">
                      <AnimatedBar pct={readyPct} color="#fff" />
                    </div>
                    <div className="text-sm mt-3 text-white/90">{readyMessage}</div>
                    <div className="mt-4 pt-4 space-y-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
                      {taxReadySummary.map((s) => (
                        <div key={s.label} className="flex items-center gap-2.5 text-sm">
                          <s.icon size={15} className="text-white/70 flex-shrink-0" />
                          <span className="flex-1">{s.label}</span>
                          {s.done ? <CheckCircle2 size={16} className="text-white flex-shrink-0" /> : <div className="w-4 h-4 rounded-full border-2 border-white/40 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <Card className="p-6 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#8A93A3" }}>Estimated Refund</div>
                <div className="text-2xl font-bold tabular mt-0.5" style={{ color: NAVY }}><AnimatedNumber value={Math.max(0, estimatedRefund)} /></div>
                {weeklyDelta > 0 && (
                  <div className="inline-flex items-center gap-1 mt-2 px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>
                    <TrendingUp size={12} /> {fmt(weeklyDelta)} this week
                  </div>
                )}
              </Card>

              {readinessChecks.filter((c) => !c.ok).length > 0 && (
                <Card className="p-2">
                  <div className="px-3 pt-2 pb-1 text-xs font-semibold" style={{ color: NAVY_SOFT }}>What's left</div>
                  {readinessChecks.filter((c) => !c.ok).map((c) => <ReadinessItem key={c.key} ok={c.ok} title={c.title} detail={c.detail} cta={c.cta} onGo={c.onGo} />)}
                </Card>
              )}

              <button onClick={() => setTab("summary")} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border bg-white transition hover:brightness-95" style={{ borderColor: GREY_LINE, color: NAVY }}>
                <FileText size={15} color={TEAL_DARK} />
                View Accountant Pack
              </button>

              <SectionTitle title="Receipts" />

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={15} color="#B7BEC9" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input value={receiptSearch} onChange={(e) => setReceiptSearch(e.target.value)} placeholder="Search receipts…" className={`${inputCls} pl-9`} />
                </div>
                <button
                  onClick={() => setShowReceiptFilters((v) => !v)}
                  className="relative p-2.5 rounded-xl border flex-shrink-0 transition"
                  style={showReceiptFilters || receiptCategoryFilter !== "all" ? { backgroundColor: TEAL_TINT, borderColor: TEAL_TINT, color: TEAL_DARK } : { borderColor: GREY_LINE, color: NAVY_SOFT }}
                  aria-label="Filters"
                >
                  <SlidersHorizontal size={16} />
                  {receiptCategoryFilter !== "all" && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TEAL }} />}
                </button>
              </div>

              {showReceiptFilters && (
                <div className="flex items-center gap-2 flex-wrap fade-up">
                  <button onClick={() => setReceiptCategoryFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === "all" ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>All</button>
                  {CATEGORIES.map((c) => (
                    <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === c.key ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>{c.label}</button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                {receiptSegments.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setReceiptSegment(s.key)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition flex-1 justify-center"
                    style={receiptSegment === s.key ? { backgroundColor: TEAL_TINT, color: TEAL_DARK } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}
                  >
                    {s.label}
                    {s.key === "needsAttention" && s.list.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ backgroundColor: AMBER, color: "#fff" }}>{s.list.length}</span>
                    )}
                  </button>
                ))}
              </div>

              <Card className="p-2 sm:p-4">
                <div className="px-2">
                  {receiptsForTab.length === 0 ? (
                    <EmptyState icon={Receipt} title="Nothing here" subtitle="Tap the + button to scan a receipt — TaxMate will sort it into the right category." />
                  ) : (
                    receiptsForTab.map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "vehicle" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle title="Logbook" />
                <button onClick={() => setShowLogbookInfo((v) => !v)} className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: TEAL_DARK }}>
                  Learn more <ChevronRight size={13} style={{ transform: showLogbookInfo ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                </button>
              </div>

              {showLogbookInfo && (
                <Card className="p-4 fade-up">
                  <p className="text-xs leading-relaxed" style={{ color: "#8A93A3" }}>Vehicle claims are usually the single largest deduction for tradies. The ATO wants a continuous 12-week period that records <b>every</b> trip — work and private, not just work journeys. Complete your 84-day logbook once — it can support your claims for up to five years while your driving pattern stays similar.</p>
                </Card>
              )}

              <Card className="p-5" style={{ borderColor: firstTripDate ? GREY_LINE : AMBER }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: NAVY }}>Logbook progress</span>
                  <span className="text-xs font-medium tabular" style={{ color: NAVY_SOFT }}>{Math.min(daysElapsed, 84)} / 84 days</span>
                </div>
                <AnimatedBar pct={logbookProgress} />
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="p-4 text-center" delay={0}><div className="text-xl font-bold tabular" style={{ color: NAVY }}>{Math.round(businessKm)} km</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Business km</div></Card>
                <Card className="p-4 text-center" delay={40}><div className="text-xl font-bold tabular" style={{ color: NAVY }}>{Math.round(personalKm)} km</div><div className="text-[11px] mt-1" style={{ color: "#8A93A3" }}>Personal km</div></Card>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center"><span className="text-xs font-semibold tabular" style={{ color: TEAL_DARK }}>{businessPct}%</span> <span className="text-[11px]" style={{ color: "#8A93A3" }}>business use</span></div>
                <div className="text-center"><span className="text-xs font-semibold tabular" style={{ color: NAVY_SOFT }}>{currentOdometer > 0 ? Math.round(currentOdometer).toLocaleString() : "—"}</span> <span className="text-[11px]" style={{ color: "#8A93A3" }}>est. odometer</span></div>
              </div>

              <button onClick={() => setShowTripForm(true)} disabled={demoMode} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-semibold shadow-card hover:shadow-card-hover transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:-translate-y-0.5" style={{ backgroundColor: TEAL }}>
                <Car size={18} />
                Log Trip
              </button>

              <button onClick={() => setTab("settings")} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border bg-white text-left transition hover:bg-[#FBFBFC]" style={{ borderColor: GREY_LINE }}>
                <span className="text-sm font-semibold" style={{ color: NAVY }}>Vehicle details</span>
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL_DARK }}>Edit in Settings<ChevronRight size={14} /></span>
              </button>

              <Disclosure title="Recommended method">
                <MethodCompareCard centsPerKmEstimate={centsPerKmEstimate} logbookEstimate={logbookEstimate} logbookReady={logbookReady} businessKm={businessKm} />
              </Disclosure>

              <Disclosure title="Import from Driversnote">
                <p className="text-xs mb-3" style={{ color: "#8A93A3" }}>Export a CSV from Driversnote and drop it in — TaxMate will match up dates, distances and trip purposes.</p>
                <button onClick={() => csvInputRef.current?.click()} disabled={demoMode} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition disabled:opacity-50" style={{ borderColor: GREY_LINE, color: NAVY }}><Upload size={15} />Import Driversnote CSV</button>
              </Disclosure>

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

              <Card className="p-2 sm:p-4">
                <div className="px-2 pt-2 pb-1 text-xs font-semibold" style={{ color: NAVY_SOFT }}>Trip log</div>
                <div className="px-2">
                  {trips.length === 0 ? (
                    <EmptyState icon={Car} title="No trips logged yet" subtitle="Tap Log Trip above, or import a Driversnote CSV to backfill your history." />
                  ) : (
                    trips.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: GREY_LINE }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: t.type === "business" ? TEAL_TINT : "#F0F1F4" }}><Car size={15} color={t.type === "business" ? TEAL_DARK : "#8A93A3"} /></div>
                        <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate" style={{ color: NAVY }}>{t.purpose || (t.type === "business" ? "Work trip" : "Personal trip")}</div><div className="text-xs text-[#8A93A3]">{new Date(t.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div></div>
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
                    <EmptyState icon={Fuel} title="No vehicle expenses yet" subtitle={'Scan a fuel, servicing or insurance receipt and tag it as "Vehicle & Fuel".'} />
                  ) : (
                    receiptsWithNum.filter((r) => r.category === "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "expenses" && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Deductions</h1>
                  <p className="text-sm mt-1" style={{ color: "#8A93A3" }}>Track your claims and grow your refund</p>
                </div>
                <button
                  onClick={() => setShowReceiptFilters((v) => !v)}
                  className="w-10 h-10 rounded-full border flex items-center justify-center flex-shrink-0 transition"
                  style={showReceiptFilters ? { backgroundColor: TEAL_TINT, borderColor: TEAL_TINT, color: TEAL_DARK } : { borderColor: GREY_LINE, color: NAVY_SOFT }}
                  aria-label="Filters"
                >
                  <SlidersHorizontal size={16} />
                </button>
              </div>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "#8A93A3" }}>Total estimated deductions</span>
                  {monthGrowthPct !== 0 && (
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>
                      <TrendingUp size={11} style={monthGrowthPct < 0 ? { transform: "scaleY(-1)" } : undefined} />{monthGrowthPct > 0 ? "Up" : "Down"} {Math.abs(monthGrowthPct)}%
                    </div>
                  )}
                </div>
                <div className="text-4xl font-bold tabular mt-1" style={{ color: NAVY }}><AnimatedNumber value={totalDeductions} /></div>
                {thisMonthDelta !== 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm font-medium" style={{ color: TEAL_DARK }}>
                    <TrendingUp size={13} style={thisMonthDelta < 0 ? { transform: "scaleY(-1)" } : undefined} />{thisMonthDelta > 0 ? "+" : "-"}{fmt(Math.abs(thisMonthDelta))} this month
                  </div>
                )}
                <div className="text-xs mt-0.5" style={{ color: "#8A93A3" }}>Compared to last month</div>
                <div className="mt-3 -mx-1">
                  <TrendSparkline points={monthlyDeductionsTrend} color={TEAL} />
                </div>
              </Card>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold" style={{ color: NAVY }}>By category</span>
                  <button onClick={() => receiptsListRef.current?.scrollIntoView({ behavior: "smooth" })} className="text-xs font-semibold" style={{ color: TEAL_DARK }}>View all categories</button>
                </div>
                <Card className="p-2">
                  {deductionCategoryRows.map((row) => (
                    <button key={row.key} onClick={row.onGo} className="w-full text-left px-3 py-3 flex items-center gap-3 border-b last:border-0 transition hover:bg-[#FBFBFC]" style={{ borderColor: GREY_LINE }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL_TINT }}><row.icon size={16} color={TEAL_DARK} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold" style={{ color: NAVY }}>{row.label}</div>
                        <div className="text-xs mt-0.5" style={row.needsSetup ? { color: AMBER, fontWeight: 600 } : { color: "#8A93A3" }}>{row.sub}</div>
                        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#EEF0F4" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.amount / maxCategoryRowAmount) * 100)}%`, backgroundColor: row.needsSetup ? "#D8DCE3" : TEAL }} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold tabular" style={{ color: NAVY }}>{fmt(row.amount)}</div>
                        <div className="text-[11px]" style={{ color: "#8A93A3" }}>{totalDeductions > 0 ? Math.round((row.amount / totalDeductions) * 100) : 0}% of total</div>
                      </div>
                      <ChevronRight size={15} className="flex-shrink-0" style={{ color: "#B7BEC9" }} />
                    </button>
                  ))}
                </Card>
              </div>

              {recentReceipts.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold" style={{ color: NAVY }}>Recent receipts</span>
                    <button onClick={() => receiptsListRef.current?.scrollIntoView({ behavior: "smooth" })} className="text-xs font-semibold" style={{ color: TEAL_DARK }}>View all receipts</button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                    {recentReceipts.map((r) => {
                      const cat = CATEGORIES.find((c) => c.key === r.category);
                      return (
                        <button key={r.id} onClick={() => setEditingReceipt(r)} className="flex-shrink-0 w-36 text-left">
                          <Card className="p-3">
                            <div className="w-full h-16 rounded-xl flex items-center justify-center mb-2" style={{ backgroundColor: TEAL_TINT }}>{cat && <cat.icon size={22} color={TEAL_DARK} />}</div>
                            <div className="text-xs font-semibold truncate" style={{ color: NAVY }}>{r.vendor || "Untitled"}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: "#8A93A3" }}>{new Date(r.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div>
                            {cat && <div className="mt-1.5"><Pill tone="teal">{cat.label}</Pill></div>}
                            <div className="text-sm font-bold tabular mt-1.5" style={{ color: NAVY }}>{fmtDec(r.amount)}</div>
                          </Card>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {todaySuggestion && (
                <Card className="p-4 flex items-center gap-3">
                  <Sparkles size={16} color={TEAL_DARK} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#8A93A3" }}>TaxMate Insight</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: NAVY }}>{todaySuggestion.text}</div>
                  </div>
                  <button onClick={todaySuggestion.action} disabled={demoMode} className="px-3.5 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 disabled:opacity-50 transition hover:brightness-95" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>
                    Add now
                  </button>
                </Card>
              )}

              <button onClick={() => setTab("settings")} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border bg-white text-left transition hover:bg-[#FBFBFC]" style={{ borderColor: GREY_LINE }}>
                <span className="text-sm font-semibold" style={{ color: NAVY }}>Your details & other deductions</span>
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL_DARK }}>Edit in Settings<ChevronRight size={14} /></span>
              </button>

              <Card className="p-2 sm:p-4">
                <div ref={receiptsListRef} style={{ scrollMarginTop: "80px" }} />
                {showReceiptFilters && (
                  <div className="flex items-center gap-2 flex-wrap px-2 pt-2 pb-3">
                    <button onClick={() => setReceiptCategoryFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === "all" ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>All work expenses</button>
                    {CATEGORIES.map((c) => (
                      <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === c.key ? { backgroundColor: NAVY, color: "#fff" } : { backgroundColor: "#F0F1F4", color: "#5B6472" }}>{c.label}</button>
                    ))}
                  </div>
                )}
                <div className="px-2">
                  {filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").length === 0 ? (
                    <EmptyState icon={Wrench} title="Nothing here yet" subtitle="Tap the + button to scan a receipt straight into this category." />
                  ) : (
                    filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "summary" && (
            <div className="space-y-6">
              <button onClick={() => setTab("progress")} className="flex items-center gap-1 text-xs font-semibold print:hidden" style={{ color: TEAL_DARK }}>
                <ChevronRight size={13} style={{ transform: "rotate(180deg)" }} /> Back to Progress
              </button>
              <SectionTitle title="Accountant Pack" eyebrow="Print or export, ready to send"
                action={<div className="flex gap-2 print:hidden">
                  <button onClick={exportCSV} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition hover:bg-[#F6F7F9]" style={{ borderColor: GREY_LINE, color: NAVY }}><Download size={15} />Export CSV</button>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:brightness-110 transition" style={{ backgroundColor: TEAL }}><Printer size={15} />Print</button>
                </div>} />

              <Card className="p-4 flex items-center gap-3" style={{ backgroundColor: accountantReady ? TEAL_TINT : AMBER_TINT }}>
                {accountantReady ? <CheckCircle2 size={18} color={TEAL_DARK} /> : <AlertTriangle size={16} color={AMBER} />}
                <div className="text-sm font-medium" style={{ color: accountantReady ? TEAL_DARK : "#8A5A0F" }}>{accountantReady ? "This pack is ready to send to your accountant." : "A few things on Progress still need attention before this pack is fully ready."}</div>
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

          {tab === "benefits" && <BenefitsFeature />}

          {tab === "settings" && (
            <div className="space-y-6">
              <SectionTitle title="Settings" sub="Manage your profile, vehicle and deduction details." />

              <Card className="p-5">
                <SectionTitle title="Profile & tax details" eyebrow="Used across your dashboard and accountant summary" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Your name"><input disabled={demoMode} value={activeData.profile.name} onChange={(e) => setProfile("name", e.target.value)} placeholder="Optional" className={inputCls} /></Field>
                  <Field label="Occupation"><input disabled={demoMode} value={activeData.profile.occupation} onChange={(e) => setProfile("occupation", e.target.value)} className={inputCls} /></Field>
                  <Field label="Income ($)"><input disabled={demoMode} type="number" value={activeData.profile.income} onChange={(e) => setProfile("income", Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Tax withheld ($)"><input disabled={demoMode} type="number" value={activeData.profile.taxWithheld} onChange={(e) => setProfile("taxWithheld", Number(e.target.value))} className={inputCls} /></Field>
                </div>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Vehicle details" eyebrow="Used for your logbook and odometer tracking" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Make"><input disabled={demoMode} value={activeData.profile.vehicle.make} onChange={(e) => setVehicle("make", e.target.value)} className={inputCls} placeholder="Toyota" /></Field>
                  <Field label="Model"><input disabled={demoMode} value={activeData.profile.vehicle.model} onChange={(e) => setVehicle("model", e.target.value)} className={inputCls} placeholder="HiLux" /></Field>
                  <Field label="Rego"><input disabled={demoMode} value={activeData.profile.vehicle.rego} onChange={(e) => setVehicle("rego", e.target.value)} className={inputCls} placeholder="1AB2CD" /></Field>
                  <Field label="Opening odometer (km)"><input disabled={demoMode} type="number" value={activeData.profile.vehicle.openingOdometer} onChange={(e) => setVehicle("openingOdometer", Number(e.target.value))} className={inputCls} /></Field>
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

              <Card className="p-5">
                <SectionTitle title="AI travel memory" eyebrow="What TaxMate AI remembers when you log trips" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Home address">
                    <input disabled={demoMode} value={activeData.profile.homeAddress || ""} onChange={(e) => updateTravelProfile({ homeAddress: e.target.value })} placeholder="e.g. 18 Maureen Close, Cranbourne West" className={inputCls} />
                  </Field>
                  <Field label="Usual trip type">
                    <select disabled={demoMode} value={activeData.profile.assumeRoundTrip === false ? "one_way" : "round_trip"} onChange={(e) => updateTravelProfile({ assumeRoundTrip: e.target.value === "round_trip" })} className={inputCls}>
                      <option value="round_trip">Round trip (there and back)</option>
                      <option value="one_way">One-way</option>
                    </select>
                  </Field>
                </div>
                <p className="text-xs mt-3 leading-relaxed" style={{ color: "#8A93A3" }}>TaxMate AI uses these so it doesn't have to ask every time you log a trip — it'll also update them automatically as you chat.</p>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Account" />
                <div className="flex flex-wrap gap-2">
                  <button onClick={demoMode ? disableDemo : enableDemo} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition" style={demoMode ? { backgroundColor: AMBER_TINT, borderColor: AMBER_TINT, color: "#8A5A0F" } : { borderColor: GREY_LINE, color: NAVY_SOFT }}>
                    {demoMode ? <><X size={15} /> Clear demo data</> : <><Sparkles size={15} /> View sample apprentice data</>}
                  </button>
                  <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition" style={{ borderColor: GREY_LINE, color: NAVY_SOFT }}>
                    <LogOut size={15} /> Log out
                  </button>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>

      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t px-2 py-1.5 flex justify-around print:hidden" style={{ borderColor: GREY_LINE }}>
        {NAV.filter((n) => n.key !== "progress").map((n) => (
          <button key={n.key} onClick={() => setTab(n.key)} className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-xl flex-1" style={tab === n.key ? { color: TEAL_DARK } : { color: "#B7BEC9" }}>
            <n.icon size={19} /><span className="text-[9.5px] font-medium text-center leading-tight">{n.label}</span>
          </button>
        ))}
        <button onClick={() => setMobileNav((v) => !v)} className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-xl flex-1" style={mobileNav || tab === "progress" || tab === "summary" || tab === "settings" ? { color: TEAL_DARK } : { color: "#B7BEC9" }}>
          <MoreHorizontal size={19} /><span className="text-[9.5px] font-medium text-center leading-tight">More</span>
        </button>
      </div>

      {(showReceiptForm || editingReceipt) && !demoMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => { setShowReceiptForm(false); setReceiptFormCategoryLock(undefined); setEditingReceipt(null); }}>
          <div className="w-full sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
            <ReceiptForm
              initial={editingReceipt || undefined}
              categoryLock={editingReceipt ? undefined : receiptFormCategoryLock}
              onSave={editingReceipt ? saveReceiptEdit : addReceipt}
              onCancel={() => { setShowReceiptForm(false); setReceiptFormCategoryLock(undefined); setEditingReceipt(null); }}
            />
          </div>
        </div>
      )}

      {scanQueue.length > 0 && !demoMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto">
            <ReceiptReviewModal
              item={scanQueue[0]}
              onSave={(r) => { addReceipt(r); setScanQueue((p) => p.slice(1)); }}
              onCancel={() => setScanQueue((p) => p.slice(1))}
            />
          </div>
        </div>
      )}

      {showTripForm && !demoMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setShowTripForm(false)}>
          <div className="w-full sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <TripForm onSave={addTrip} onCancel={() => setShowTripForm(false)} />
          </div>
        </div>
      )}

      {!showReceiptForm && !showTripForm && !editingReceipt && !assistantOpen && (
        <>
          <FloatingActionButton
            onScan={quickUploadReceipt}
            onLogTrip={quickLogTravel}
            onAddExpense={openManualExpenseEntry}
            onImportCsv={() => { if (demoMode) return; csvInputRef.current?.click(); }}
            disabled={demoMode}
          />
          {ASSISTANT_URL && <AssistantButton onClick={() => setAssistantOpen(true)} disabled={demoMode} />}
        </>
      )}

      {assistantOpen && (
        <AssistantModal
          messages={assistantMessages}
          loading={assistantLoading}
          onSend={sendAssistantMessage}
          onClose={() => setAssistantOpen(false)}
          disabled={demoMode}
        />
      )}
    </div>
  );
}






