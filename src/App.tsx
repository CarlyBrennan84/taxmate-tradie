import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Receipt, Car, Wrench, Shirt, HardHat, Smartphone,
  GraduationCap, FileText, Plus, Trash2, ChevronRight, ChevronLeft, Menu,
  Download, Printer, TrendingUp, MapPin, Sparkles, Camera,
  Check, CheckCircle2, AlertTriangle, Fuel, Upload, ShieldCheck, X,
  Search, SlidersHorizontal, Send, Mic, LogOut, Landmark,
  Info, Wallet, Bell, MoreHorizontal, WashingMachine, Settings as SettingsIcon,
  Zap, Image as ImageIcon, RefreshCw, Calendar, Crosshair, Loader2, Gauge,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { AppData, Receipt as ReceiptT, Trip, CategoryKey, Profile } from "./types";
import { loadData, saveData } from "./lib/storage";
import { supabase, arrivedViaInviteOrRecovery } from "./lib/supabaseClient";
import { parseDriversnoteCSV } from "./csv";
import BenefitsFeature from "./benefits/BenefitsFeature";
import gloveboxLogo from "./assets/glovebox-logo-new.png";

/* ---------------------------------------------------------------
   Design tokens
----------------------------------------------------------------*/
export const NAVY = "#010818";
export const NAVY_SOFT = "#3A4A66";
export const TEAL = "#2563FF";
export const TEAL_DARK = "#1E4FBE";
export const TEAL_TINT = "#E9EFFE";
export const GREEN = "#18C37E";
export const GREEN_DARK = "#0E7A52";
export const GREEN_TINT = "#E4F9F0";
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
const PLACES_URL = RECEIPT_SCANNER_URL ? `${RECEIPT_SCANNER_URL.replace(/\/$/, "")}/places` : undefined;
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

export function DarkField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: "#B7C5D8" }}>{label}</span>
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-[#E7E9EE] bg-[#FBFBFC] px-3 py-2 text-sm text-[#010818] focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed";
export const darkInputCls = "w-full rounded-xl border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed";

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

function RadialProgress({
  pct, label, size = 88, trackColor = "rgba(255,255,255,0.2)", progressColor = "#fff", textColor = "#fff", labelColor = "rgba(255,255,255,0.8)",
}: { pct: number; label: string; size?: number; trackColor?: string; progressColor?: string; textColor?: string; labelColor?: string }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={progressColor} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold tabular" style={{ color: textColor }}>{Math.round(clamped * 100)}%</span>
      </div>
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap" style={{ color: labelColor }}>{label}</div>
    </div>
  );
}

function ReceiptForm({ onSave, onCancel, categoryLock, initial, dark }: { onSave: (r: ReceiptT) => void; onCancel: () => void; categoryLock?: CategoryKey; initial?: ReceiptT; dark?: boolean }) {
  const [r, setR] = useState<{ id: string; date: string; vendor: string; category: CategoryKey; amount: string; workPct: string; filed: boolean; notes: string }>(
    initial
      ? { id: initial.id, date: initial.date, vendor: initial.vendor, category: initial.category, amount: initial.amount ? String(initial.amount) : "", workPct: String(initial.workPct), filed: initial.filed, notes: initial.notes || "" }
      : { id: uid(), date: todayISO(), vendor: "", category: categoryLock || "tools", amount: "", workPct: "100", filed: true, notes: "" }
  );
  useEffect(() => { if (categoryLock) setR((p) => ({ ...p, category: categoryLock })); }, [categoryLock]);
  const set = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => setR((p) => ({ ...p, [k]: v }));
  const fieldCls = dark ? darkInputCls : inputCls;
  const fieldStyle = dark ? { backgroundColor: "#0D1B2E", borderColor: "rgba(255,255,255,0.14)" } : undefined;
  const F = dark ? DarkField : Field;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-2xl border" style={dark ? { borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#14233A" } : { borderColor: GREY_LINE, backgroundColor: "#FBFBFC" }}>
      <F label="Date"><input type="date" value={r.date} onChange={(e) => set("date", e.target.value)} className={fieldCls} style={fieldStyle} /></F>
      <F label="Vendor"><input value={r.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Total Tools" className={fieldCls} style={fieldStyle} /></F>
      <F label="Category">
        <select disabled={!!categoryLock} value={r.category} onChange={(e) => set("category", e.target.value as CategoryKey)} className={fieldCls} style={fieldStyle}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </F>
      <F label="Amount (incl. GST)"><input type="number" step="0.01" value={r.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className={fieldCls} style={fieldStyle} /></F>
      <F label="Work-related %"><input type="number" min={0} max={100} value={r.workPct} onChange={(e) => set("workPct", e.target.value)} className={fieldCls} style={fieldStyle} /></F>
      <F label="Filed / saved?">
        <select value={r.filed ? "yes" : "no"} onChange={(e) => set("filed", e.target.value === "yes")} className={fieldCls} style={fieldStyle}>
          <option value="yes">Yes</option>
          <option value="no">Not yet</option>
        </select>
      </F>
      <div className="col-span-2 sm:col-span-3">
        <F label="Notes (optional)"><input value={r.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What was it for?" className={fieldCls} style={fieldStyle} /></F>
      </div>
      <div className="col-span-2 sm:col-span-3 flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className={`px-4 py-2 rounded-xl text-sm font-medium transition ${dark ? "text-white/70 hover:bg-white/10" : "text-[#5B6472] hover:bg-[#F0F1F4]"}`}>Cancel</button>
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
  const [showForm, setShowForm] = useState(!item.scanning);
  const [caption, setCaption] = useState("Reading receipt…");

  useEffect(() => {
    if (!item.scanning) return;
    const captions = ["Reading receipt…", "Categorising…"];
    let i = 0;
    setCaption(captions[0]);
    const t = window.setInterval(() => { i = (i + 1) % captions.length; setCaption(captions[i]); }, 900);
    return () => window.clearInterval(t);
  }, [item.scanning]);

  useEffect(() => {
    if (item.scanning) return;
    if (result) {
      const label = CATEGORIES.find((c) => c.key === result.category)?.label || "Receipt";
      setCaption(`${label} receipt detected`);
    } else if (item.failed) {
      setCaption("Couldn't read receipt");
    }
    const t = window.setTimeout(() => setShowForm(true), 650);
    return () => window.clearTimeout(t);
  }, [item.scanning, result, item.failed]);

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
        <span className="text-sm font-semibold text-white">Receipt Details</span>
        <button onClick={onCancel} className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 transition"><X size={16} /></button>
      </div>
      {item.thumb && <img src={item.thumb} alt="" className="w-full max-h-52 object-cover rounded-2xl" />}
      {!showForm ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TEAL, borderTopColor: "transparent" }} />
          <span className="text-sm font-medium text-white">{caption}</span>
        </div>
      ) : (
        <>
          {result && (
            <div className="p-4 rounded-2xl flex items-start gap-3" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}>
              <Sparkles size={16} color={TEAL} className="flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-white">AI Detected</div>
                <div className="text-xs mt-0.5 mb-2" style={{ color: "#B7C5D8" }}>We've read your receipt — check the details below before saving.</div>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                  style={result.confidence === "low" ? { backgroundColor: AMBER_TINT, color: "#8A5A0F" } : { backgroundColor: GREEN_TINT, color: GREEN_DARK }}
                >
                  {result.confidence === "low" ? "Low confidence — please check" : result.confidence === "medium" ? "Medium confidence" : "High confidence"}
                </span>
              </div>
            </div>
          )}
          {item.failed && (
            <div className="p-4 rounded-2xl flex items-center gap-2.5" style={{ backgroundColor: "rgba(199,127,26,0.15)" }}>
              <AlertTriangle size={16} color={AMBER} className="flex-shrink-0" />
              <span className="text-sm" style={{ color: "#F0C896" }}>Couldn't read this one automatically — fill in the details manually.</span>
            </div>
          )}
          <ReceiptForm dark initial={initial} onSave={onSave} onCancel={onCancel} />
        </>
      )}
    </div>
  );
}

function CornerGuide({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const pos: Record<string, string> = {
    tl: "top-4 left-4 border-t-[3px] border-l-[3px] rounded-tl-lg",
    tr: "top-4 right-4 border-t-[3px] border-r-[3px] rounded-tr-lg",
    bl: "bottom-4 left-4 border-b-[3px] border-l-[3px] rounded-bl-lg",
    br: "bottom-4 right-4 border-b-[3px] border-r-[3px] rounded-br-lg",
  };
  return <div className={`absolute w-8 h-8 ${pos[corner]}`} style={{ borderColor: TEAL }} />;
}

function ScanCaptureScreen({ onClose, onGallery, onShutter }: { onClose: () => void; onGallery: () => void; onShutter: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "#081425" }}>
      <div className="flex items-center justify-between px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <button onClick={onClose} className="p-2 -ml-2 text-white" aria-label="Back"><ChevronLeft size={24} /></button>
        <span className="text-lg font-bold text-white">Scan Receipt</span>
        <div className="p-2 text-white" aria-hidden="true"><Zap size={20} /></div>
      </div>
      <p className="text-center text-sm mt-1" style={{ color: "#B7C5D8" }}>Snap a clear photo of your receipt</p>

      <div className="flex-1 flex items-center justify-center px-6 mt-4 min-h-0">
        <div className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden" style={{ backgroundColor: "#0D1B2E" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <Receipt size={48} style={{ color: "rgba(255,255,255,0.15)" }} />
          </div>
          <CornerGuide corner="tl" /><CornerGuide corner="tr" /><CornerGuide corner="bl" /><CornerGuide corner="br" />
        </div>
      </div>

      <p className="text-center text-xs mt-4 px-6" style={{ color: "#B7C5D8" }}>
        <span style={{ color: TEAL, fontWeight: 600 }}>Tips:</span> Good lighting &middot; Flat surface &middot; All edges visible
      </p>

      <div className="flex items-center justify-between px-10" style={{ paddingTop: "24px", paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}>
        <button onClick={onGallery} className="flex flex-col items-center gap-1.5 text-white min-w-[44px] min-h-[44px] justify-center">
          <ImageIcon size={22} />
          <span className="text-xs font-medium">Gallery</span>
        </button>
        <button onClick={onShutter} aria-label="Take photo" className="w-16 h-16 rounded-full bg-white flex-shrink-0 transition active:scale-95" style={{ border: "4px solid rgba(255,255,255,0.3)" }} />
        <div className="flex flex-col items-center gap-1.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: "#B7C5D8" }}>
          <RefreshCw size={22} />
          <span className="text-xs font-medium">Auto</span>
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ r, onDelete, onEdit, dark }: { r: ReceiptT; onDelete: (id: string) => void; onEdit: (r: ReceiptT) => void; dark?: boolean }) {
  const ded = r.amount * (r.workPct / 100);
  const cat = CATEGORIES.find((c) => c.key === r.category);
  const incomplete = !r.vendor || !r.amount;
  return (
    <div
      role="button" tabIndex={0} onClick={() => onEdit(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onEdit(r); }}
      className={`w-full flex items-center gap-3 py-3 px-1 border-b last:border-0 text-left transition cursor-pointer ${dark ? "hover:bg-white/5" : "hover:bg-[#FBFBFC]"}`}
      style={{ borderColor: dark ? "rgba(255,255,255,0.08)" : GREY_LINE }}
    >
      <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: dark ? "rgba(37,99,255,0.15)" : TEAL_TINT }}>
        {cat && <cat.icon size={16} color={dark ? TEAL : TEAL_DARK} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium truncate ${dark ? "text-white" : ""}`} style={dark ? undefined : { color: NAVY }}>{r.vendor || "Untitled receipt"}</div>
        <div className="text-xs truncate" style={{ color: dark ? "#79879C" : "#8A93A3" }}>{cat?.label} · {new Date(r.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}{r.notes ? ` · ${r.notes}` : ""}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-sm font-semibold ${dark ? "text-white" : ""}`} style={dark ? undefined : { color: NAVY }}>{fmtDec(r.amount)}</div>
        <div className="text-[11px]" style={{ color: dark ? "#79879C" : "#8A93A3" }}>{r.workPct}% · ded. {fmtDec(ded)}</div>
      </div>
      {incomplete ? <Pill tone="amber">Needs details</Pill> : r.filed ? <Pill tone="teal">Filed</Pill> : <Pill tone="amber">To file</Pill>}
      <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} className="p-1.5 rounded-lg transition flex-shrink-0" style={dark ? { color: "#5B6980" } : { color: "#B7BEC9" }}><Trash2 size={15} /></button>
    </div>
  );
}

const TRIP_PURPOSES = ["Site Visit", "Materials", "Supplier", "Quote", "Office", "Training", "Meeting", "Other"];
const darkFieldBg = { backgroundColor: "#14233A", borderColor: "rgba(255,255,255,0.10)" };

function LogTripScreen({ onSaveTrips, onClose, homeAddress, assumeRoundTrip, initialDate }: { onSaveTrips: (trips: Trip[]) => void; onClose: () => void; homeAddress?: string; assumeRoundTrip?: boolean; initialDate?: string }) {
  const [activeTab, setActiveTab] = useState<"manual" | "auto">("manual");
  const [date, setDate] = useState(initialDate || todayISO());
  const [startLocation, setStartLocation] = useState(homeAddress || "");
  const [endLocation, setEndLocation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [km, setKm] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [classification, setClassification] = useState<"work" | "personal" | "mixed">("work");
  const [mixedPct, setMixedPct] = useState(70);
  const [saved, setSaved] = useState(false);
  const [roundTrip, setRoundTrip] = useState(assumeRoundTrip !== false);
  const lastOneWayKm = useRef<number | null>(null);

  const [startSuggestions, setStartSuggestions] = useState<string[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<string[]>([]);
  const startDebounceRef = useRef<number | null>(null);
  const endDebounceRef = useRef<number | null>(null);

  const kmNum = parseFloat(km) || 0;
  const canSave = kmNum > 0;
  const businessKmForThisTrip = classification === "work" ? kmNum : classification === "mixed" ? kmNum * (mixedPct / 100) : 0;
  const estimatedDeduction = businessKmForThisTrip * CENTS_PER_KM_RATE;

  const fetchSuggestions = async (input: string, setter: (s: string[]) => void) => {
    if (!PLACES_URL || input.trim().length < 3) { setter([]); return; }
    try {
      const res = await fetch(PLACES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      setter((data.predictions || []).map((p: { description: string }) => p.description));
    } catch {
      setter([]);
    }
  };

  const handleStartChange = (v: string) => {
    setStartLocation(v);
    if (startDebounceRef.current) window.clearTimeout(startDebounceRef.current);
    startDebounceRef.current = window.setTimeout(() => fetchSuggestions(v, setStartSuggestions), 300);
  };

  const handleEndChange = (v: string) => {
    setEndLocation(v);
    if (endDebounceRef.current) window.clearTimeout(endDebounceRef.current);
    endDebounceRef.current = window.setTimeout(() => fetchSuggestions(v, setEndSuggestions), 300);
  };

  const toggleRoundTrip = () => {
    const next = !roundTrip;
    setRoundTrip(next);
    if (lastOneWayKm.current != null) {
      setKm(String(Math.round(lastOneWayKm.current * (next ? 2 : 1) * 10) / 10));
    }
  };

  const calcDistance = async () => {
    if (!DISTANCE_URL || !startLocation.trim() || !endLocation.trim()) return;
    setCalculating(true);
    setCalcError(null);
    try {
      const res = await fetch(DISTANCE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: startLocation, destination: endLocation }),
      });
      const data = await res.json();
      if (!res.ok || !data.distanceKm) { setCalcError(data.error || "Couldn't calculate distance."); return; }
      lastOneWayKm.current = data.distanceKm;
      setKm(String(roundTrip ? Math.round(data.distanceKm * 2 * 10) / 10 : data.distanceKm));
    } catch {
      setCalcError("Distance lookup failed — check your connection.");
    } finally {
      setCalculating(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const basePurpose = purpose.trim() || (startLocation && endLocation ? `${startLocation} → ${endLocation}` : "Trip");
    let trips: Trip[];
    if (classification === "mixed") {
      const businessKm = Math.round(kmNum * (mixedPct / 100) * 10) / 10;
      const personalKm = Math.round((kmNum - businessKm) * 10) / 10;
      trips = [
        { id: uid(), date, purpose: `${basePurpose} (${mixedPct}% business)`, type: "business", km: businessKm },
        { id: uid(), date, purpose: `${basePurpose} (${100 - mixedPct}% personal)`, type: "personal", km: personalKm },
      ];
    } else {
      trips = [{ id: uid(), date, purpose: basePurpose, type: classification === "work" ? "business" : "personal", km: kmNum }];
    }
    onSaveTrips(trips);
    setSaved(true);
    window.setTimeout(onClose, 1500);
  };

  const insight =
    classification === "work"
      ? { text: "Work trips are generally deductible.", sub: kmNum > 0 ? `Estimated deduction +${fmtDec(estimatedDeduction)}` : undefined }
      : classification === "mixed"
      ? { text: `${mixedPct}% of this trip counts as a business deduction.`, sub: kmNum > 0 ? `Estimated deduction +${fmtDec(estimatedDeduction)}` : undefined }
      : { text: "Personal trips aren't tax deductible.", sub: undefined };

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ backgroundColor: "#081425" }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: GREEN_TINT }}>
          <Check size={28} color={GREEN_DARK} />
        </div>
        <div className="text-lg font-bold text-white">Trip Saved</div>
        <div className="mt-5 flex gap-10 text-center">
          <div>
            <div className="text-xs" style={{ color: "#B7C5D8" }}>Distance</div>
            <div className="text-xl font-bold text-white tabular mt-1">{kmNum.toFixed(1)} km</div>
          </div>
          {estimatedDeduction > 0 && (
            <div>
              <div className="text-xs" style={{ color: "#B7C5D8" }}>Estimated tax benefit</div>
              <div className="text-xl font-bold tabular mt-1" style={{ color: GREEN }}>+{fmtDec(estimatedDeduction)}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "#081425" }}>
      <div className="flex items-center justify-between px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <button onClick={onClose} className="p-2 -ml-2 text-white" aria-label="Back"><ChevronLeft size={24} /></button>
        <span className="text-lg font-bold text-white">Log Trip</span>
        <div className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 mt-4 min-h-0">
        <div className="grid grid-cols-2 rounded-xl p-1" style={{ backgroundColor: "#0D1B2E" }}>
          <button onClick={() => setActiveTab("manual")} className="py-2.5 rounded-lg text-sm font-semibold transition" style={activeTab === "manual" ? { backgroundColor: "rgba(37,99,255,0.15)", color: TEAL } : { color: "#B7C5D8" }}>Manual Entry</button>
          <button onClick={() => setActiveTab("auto")} className="py-2.5 rounded-lg text-sm font-semibold transition" style={activeTab === "auto" ? { backgroundColor: "rgba(37,99,255,0.15)", color: TEAL } : { color: "#B7C5D8" }}>Auto Tracking</button>
        </div>

        {activeTab === "auto" ? (
          <div className="mt-4 rounded-2xl p-6 text-center" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "#14233A" }}>
              <MapPin size={22} style={{ color: "#B7C5D8" }} />
            </div>
            <div className="text-sm font-semibold text-white">Auto Tracking isn't available yet</div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: "#B7C5D8" }}>
              Automatically detecting trips needs background location access, which a web browser can't do reliably. Use Manual Entry for now.
            </p>
            <button onClick={() => setActiveTab("manual")} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Switch to Manual Entry</button>
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-2xl p-4 space-y-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
              <DarkField label="Date">
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={darkInputCls + " pl-9"} style={darkFieldBg} />
                </div>
              </DarkField>
              <DarkField label="Start location">
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  <input
                    value={startLocation}
                    onChange={(e) => handleStartChange(e.target.value)}
                    onBlur={() => window.setTimeout(() => setStartSuggestions([]), 150)}
                    placeholder="Home"
                    className={darkInputCls + " pl-9 pr-9"}
                    style={darkFieldBg}
                    autoComplete="off"
                  />
                  <Crosshair size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  {startSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10 shadow-lg" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.12)" }}>
                      {startSuggestions.map((s) => (
                        <button key={s} onClick={() => { setStartLocation(s); setStartSuggestions([]); }} className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-white/5 transition flex items-center gap-2">
                          <MapPin size={14} style={{ color: "#B7C5D8" }} className="flex-shrink-0" />
                          <span className="truncate">{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DarkField>
              <DarkField label="End location">
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  <input
                    value={endLocation}
                    onChange={(e) => handleEndChange(e.target.value)}
                    onBlur={() => window.setTimeout(() => setEndSuggestions([]), 150)}
                    placeholder="e.g. Client Site — Richmond"
                    className={darkInputCls + " pl-9 pr-9"}
                    style={darkFieldBg}
                    autoComplete="off"
                  />
                  <Crosshair size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  {endSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10 shadow-lg" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.12)" }}>
                      {endSuggestions.map((s) => (
                        <button key={s} onClick={() => { setEndLocation(s); setEndSuggestions([]); }} className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-white/5 transition flex items-center gap-2">
                          <MapPin size={14} style={{ color: "#B7C5D8" }} className="flex-shrink-0" />
                          <span className="truncate">{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DarkField>

              <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={darkFieldBg}>
                <div className="flex items-center gap-2">
                  <RefreshCw size={15} style={{ color: "#B7C5D8" }} />
                  <div>
                    <div className="text-sm font-medium text-white">Round trip</div>
                    <div className="text-[11px]" style={{ color: "#B7C5D8" }}>Doubles the distance for the return leg</div>
                  </div>
                </div>
                <button onClick={toggleRoundTrip} role="switch" aria-checked={roundTrip} aria-label="Round trip" className="relative w-11 h-6 rounded-full transition flex-shrink-0" style={{ backgroundColor: roundTrip ? TEAL : "rgba(255,255,255,0.14)" }}>
                  <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: roundTrip ? "22px" : "2px" }} />
                </button>
              </div>

              <DarkField label="Purpose">
                <div className="relative">
                  <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#B7C5D8" }} />
                  <input list="tripPurposes" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Site inspection" className={darkInputCls + " pl-9"} style={darkFieldBg} />
                  <datalist id="tripPurposes">
                    {TRIP_PURPOSES.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
              </DarkField>

              {DISTANCE_URL && startLocation.trim() && endLocation.trim() && (
                <button onClick={calcDistance} disabled={calculating} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition disabled:opacity-60" style={{ backgroundColor: "rgba(37,99,255,0.12)", color: TEAL }}>
                  {calculating ? <><Loader2 size={14} className="animate-spin" />Calculating…</> : <><Crosshair size={14} />Calculate distance</>}
                </button>
              )}
              {calcError && <p className="text-xs" style={{ color: AMBER }}>{calcError}</p>}

              <div className="pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="pt-3">
                  <DarkField label="Distance travelled (km)">
                    <input type="number" step="0.1" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="0.0" className={darkInputCls + " text-2xl font-bold py-3 tabular"} style={{ ...darkFieldBg, color: TEAL }} />
                  </DarkField>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-sm font-semibold text-white mb-3">Classification</div>
              <div className="grid grid-cols-3 gap-2">
                {([{ key: "work", label: "Work" }, { key: "personal", label: "Personal" }, { key: "mixed", label: "Mixed" }] as const).map((c) => (
                  <button key={c.key} onClick={() => setClassification(c.key)} className="py-2.5 rounded-xl text-sm font-semibold border transition" style={classification === c.key ? { backgroundColor: TEAL, borderColor: TEAL, color: "#fff" } : { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
                    {c.label}
                  </button>
                ))}
              </div>
              {classification === "mixed" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: "#B7C5D8" }}>
                    <span>Business %</span>
                    <span className="font-semibold text-white">{mixedPct}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={mixedPct} onChange={(e) => setMixedPct(Number(e.target.value))} className="w-full" style={{ accentColor: TEAL }} />
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl p-4 flex items-start gap-3" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}>
              <CheckCircle2 size={18} style={{ color: GREEN }} className="flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm text-white">{insight.text}</div>
                {insight.sub && <div className="text-sm font-bold mt-1" style={{ color: GREEN }}>{insight.sub}</div>}
              </div>
            </div>
          </>
        )}
      </div>

      {activeTab === "manual" && (
        <div className="px-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <button
            onClick={() => { if (navigator.vibrate) navigator.vibrate(10); handleSave(); }}
            disabled={!canSave}
            className="w-full py-4 rounded-2xl text-base font-bold text-white transition disabled:opacity-40"
            style={{ backgroundColor: TEAL }}
          >
            Save Trip
          </button>
        </div>
      )}
    </div>
  );
}

function AnimatedBar({ pct, color = TEAL, trackColor = "#EEF0F4" }: { pct: number; color?: string; trackColor?: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = window.setTimeout(() => setWidth(pct), 120); return () => window.clearTimeout(t); }, [pct]);
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: trackColor }}>
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
      <SectionTitle eyebrow="Quick setup" title="Tell Glovebox about your work" sub="Just enough to start estimating your refund — you can refine the details later." />
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
      aria-label="Glovebox AI"
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
          <span className="text-sm font-bold" style={{ color: NAVY }}>Glovebox AI</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-[#B7BEC9] hover:bg-[#F0F1F4] transition"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-2xl px-4 py-3 max-w-[85%]" style={{ backgroundColor: "#FBFBFC" }}>
            <p className="text-sm leading-relaxed" style={{ color: NAVY }}>Hi! I'm your Glovebox AI. Ask me anything about your tax, deductions or claims — or tell me about a trip or expense and I'll log it for you.{VOICE_SUPPORTED && TRANSCRIBE_URL ? " Tap the mic to just talk — handy when your hands are full." : ""}</p>
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


/* =================================================================
   AUTH
==================================================================*/
function AuthLogo() {
  return (
    <div className="flex justify-center mb-8">
      <img src={gloveboxLogo} alt="Glovebox" className="h-20 w-auto" />
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
  const [tripFormDate, setTripFormDate] = useState<string | null>(null);
  const [logbookSubTab, setLogbookSubTab] = useState<"overview" | "trips" | "review">("overview");
  const [showLogbookInfo, setShowLogbookInfo] = useState(false);
  const [scanQueue, setScanQueue] = useState<ScanQueueItem[]>([]);
  const [csvPreview, setCsvPreview] = useState<Trip[] | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [showScanCapture, setShowScanCapture] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptCameraInputRef = useRef<HTMLInputElement>(null);
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
    if (!data || !session) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { saveData(data, session.user.id); }, 800);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [data, session]);

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

  const activeData: AppData = data;

  const update = (fn: (d: AppData) => AppData) => {
    setData((prev) => (prev ? fn(structuredClone(prev)) : prev));
  };

  const addReceipt = (r: ReceiptT) => { update((d) => { d.receipts.unshift(r); return d; }); setShowReceiptForm(false); setReceiptFormCategoryLock(undefined); };
  const deleteReceipt = (id: string) => update((d) => { d.receipts = d.receipts.filter((r) => r.id !== id); return d; });
  const saveReceiptEdit = (r: ReceiptT) => { update((d) => { d.receipts = d.receipts.map((existing) => (existing.id === r.id ? r : existing)); return d; }); setEditingReceipt(null); };
  const addTrip = (t: Trip) => { update((d) => { d.trips.unshift(t); return d; }); setShowTripForm(false); };
  const addTrips = (ts: Trip[]) => { update((d) => { d.trips = [...ts, ...d.trips]; return d; }); };
  const updateTravelProfile = (patch: Partial<Pick<Profile, "homeAddress" | "lastWorksite" | "assumeRoundTrip">>) => update((d) => { d.profile = { ...d.profile, ...patch }; return d; });
  const markNoTravel = (iso: string) => update((d) => {
    const existing = d.profile.reviewedNoTravelDates || [];
    if (existing.includes(iso)) return d;
    d.profile = { ...d.profile, reviewedNoTravelDates: [...existing, iso] };
    return d;
  });
  const openTripFormFor = (iso: string | null) => { setTripFormDate(iso); setShowTripForm(true); };
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
    setReceiptFormCategoryLock(undefined);
    setShowReceiptForm(true);
    setReceiptCategoryFilter("all");
    setTab("progress");
  };

  const saveQuickSetup = (occupation: string, income: number) => {
    update((d) => { d.profile.occupation = occupation; d.profile.income = income; d.profile.quickSetupDone = true; return d; });
  };

  const quickUploadReceipt = () => {
    setReceiptCategoryFilter("all");
    setTab("progress");
    setShowScanCapture(true);
  };

  const quickLogTravel = () => {
    setTab("vehicle");
    setShowTripForm(true);
  };

  const handleCSVFile = (file: File) => {
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

  const fmtShortDate = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const REVIEW_WINDOW_DAYS = 14;
  const todayTrips = trips.filter((t) => t.date === todayISO());
  const todayBusinessKm = todayTrips.filter((t) => t.type === "business").reduce((s, t) => s + t.km, 0);
  const todayPersonalKm = todayTrips.filter((t) => t.type === "personal").reduce((s, t) => s + t.km, 0);
  const todayTotalKm = todayBusinessKm + todayPersonalKm;
  const todayBusinessPct = todayTotalKm > 0 ? Math.round((todayBusinessKm / todayTotalKm) * 100) : 0;

  const logbookStartDate = firstTripDate ? new Date(firstTripDate) : null;
  const logbookEndDate = logbookStartDate ? new Date(logbookStartDate.getTime() + 83 * 86400000) : null;

  const weekBusinessPct = (weeksAgo: number): number | null => {
    const end = Date.now() - weeksAgo * 7 * 86400000;
    const start = end - 7 * 86400000;
    const weekTrips = trips.filter((t) => { const ts = new Date(t.date).getTime(); return ts > start && ts <= end; });
    const wBiz = weekTrips.filter((t) => t.type === "business").reduce((s, t) => s + t.km, 0);
    const wTotal = weekTrips.reduce((s, t) => s + t.km, 0);
    return wTotal > 0 ? (wBiz / wTotal) * 100 : null;
  };
  const businessPctTrend = [5, 4, 3, 2, 1, 0].map(weekBusinessPct).filter((v): v is number => v !== null);
  const businessPctTrendDelta = businessPctTrend.length >= 2 ? Math.round(businessPctTrend[businessPctTrend.length - 1] - businessPctTrend[businessPctTrend.length - 2]) : null;

  const recentTrips = [...trips].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 3);

  const loggedDateSet = new Set(trips.map((t) => t.date));
  const dismissedNoTravelDates = new Set(activeData.profile.reviewedNoTravelDates || []);
  const reviewGapDays: string[] = [];
  if (logbookStartDate) {
    for (let i = 1; i <= REVIEW_WINDOW_DAYS; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (d < logbookStartDate) continue;
      if (logbookEndDate && d > logbookEndDate) continue;
      if (loggedDateSet.has(iso)) continue;
      if (dismissedNoTravelDates.has(iso)) continue;
      reviewGapDays.push(iso);
    }
  }
  reviewGapDays.sort();

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
    switch (name) {
      case "log_trip": {
        const t: Trip = { id: uid(), date: todayISO(), purpose: input.purpose || "", type: input.type === "personal" ? "personal" : "business", km: Number(input.km) || 0 };
        addTrip(t);
        return `Logged a ${t.km}km ${t.type} trip.`;
      }
      case "add_expense": {
        const category: CategoryKey = CATEGORIES.some((c) => c.key === input.category) ? input.category : "other";
        const r: ReceiptT = { id: uid(), date: todayISO(), vendor: input.vendor || "Untitled", category, amount: Number(input.amount) || 0, workPct: 100, filed: false, notes: "Added via Glovebox AI" };
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
  const recommendLogbookMethod = logbookReady && logbookEstimate >= centsPerKmEstimate;
  const primaryDeductionEstimate = logbookReady ? Math.max(logbookEstimate, centsPerKmEstimate) : centsPerKmEstimate;
  const primaryDeductionMethodLabel = logbookReady && recommendLogbookMethod ? "Using logbook method" : "Using cents/km method";
  const deductionDeltaVsCentsPerKm = logbookReady && recommendLogbookMethod ? logbookEstimate - centsPerKmEstimate : 0;

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
    { key: "overview", label: "Home", icon: LayoutDashboard },
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
      <input ref={receiptInputRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)); setShowScanCapture(false); e.target.value = ""; }} />
      <input ref={receiptCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)); setShowScanCapture(false); e.target.value = ""; }} />

      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 h-screen sticky top-0 border-r px-4 py-6 print:hidden" style={{ borderColor: GREY_LINE, backgroundColor: "#FFFFFF" }}>
          <div className="flex items-center gap-2 px-2 mb-8">
            <img src={gloveboxLogo} alt="Glovebox" className="h-10 w-auto" />
            <div className="text-[11px] text-[#8A93A3] leading-tight">{activeData.profile.fy}</div>
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
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition" style={{ borderColor: GREY_LINE, color: NAVY_SOFT }}>
              <LogOut size={13} /> Log out
            </button>
          </div>
        </aside>

        {tab !== "overview" && tab !== "vehicle" && tab !== "expenses" && (
          <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 border-b print:hidden" style={{ backgroundColor: "#FFFFFFF2", borderColor: GREY_LINE, backdropFilter: "blur(8px)" }}>
            <div className="flex items-center gap-2">
              <img src={gloveboxLogo} alt="Glovebox" className="h-9 w-auto" />
            </div>
            <div className="relative p-2" aria-hidden="true"><Bell size={19} color={NAVY} /><span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: "#D64545" }} /></div>
          </div>
        )}
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
            <div className="pt-2 mt-1" style={{ borderTop: "1px solid " + GREY_LINE }}>
              <button onClick={() => { handleLogout(); setMobileNav(false); }} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border" style={{ borderColor: GREY_LINE, color: NAVY_SOFT }}>
                <LogOut size={13} /> Log out
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pt-[68px] lg:pt-8 pb-36 lg:pb-24 max-w-6xl mx-auto w-full">

          {tab === "overview" && (
            <div className="space-y-6">
              <div className="rounded-b-3xl lg:rounded-3xl -mx-4 sm:-mx-6 lg:mx-0 -mt-[68px] lg:mt-0 px-4 sm:px-6 lg:px-6 pt-8 lg:pt-6 pb-6 fade-up" style={{ backgroundColor: NAVY }}>
                <div className="lg:hidden flex items-center justify-between mb-5">
                  <img src={gloveboxLogo} alt="Glovebox" className="h-9 w-auto" />
                  <div className="relative p-2" aria-hidden="true">
                    <Bell size={20} color="#fff" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: "#D64545" }} />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white">{greeting}{activeData.profile.name ? `, ${activeData.profile.name}` : ""} 👋</h1>
                <p className="text-sm mt-1 text-white/70">{estimatedRefund > 0 ? "You're on track to save" : `${activeData.profile.occupation} · ${activeData.profile.fy}`}</p>
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <button
                    onClick={quickUploadReceipt}
                    className="flex flex-col items-start justify-center gap-2 rounded-[18px] px-3 py-3.5 text-left transition active:scale-[0.98]"
                    style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}><Camera size={18} color="#fff" /></div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white leading-tight">Scan Receipt</div>
                      <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "#AAB7CA" }}>Snap & save</div>
                    </div>
                  </button>
                  <button
                    onClick={quickLogTravel}
                    className="flex flex-col items-start justify-center gap-2 rounded-[18px] px-3 py-3.5 text-left transition active:scale-[0.98]"
                    style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}><Car size={18} color="#fff" /></div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white leading-tight">Log Trip</div>
                      <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "#AAB7CA" }}>Track km</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setAssistantOpen(true)}
                    disabled={!ASSISTANT_URL}
                    className="flex flex-col items-start justify-center gap-2 rounded-[18px] px-3 py-3.5 text-left transition active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}><Sparkles size={18} color="#fff" /></div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white leading-tight">Ask Glovebox</div>
                      <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "#AAB7CA" }}>Get answers</div>
                    </div>
                  </button>
                </div>
              </div>

              {!activeData.profile.quickSetupDone ? (
                <QuickSetupCard
                  occupation={activeData.profile.occupation}
                  income={activeData.profile.income}
                  onSave={saveQuickSetup}
                />
              ) : (
                <Card className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "#8A93A3" }}>
                        Estimated Tax Position <Info size={12} />
                      </div>
                      <div className="text-xs mt-2" style={{ color: "#8A93A3" }}>Estimated refund</div>
                      <div className="text-4xl font-bold tabular mt-0.5" style={{ color: NAVY }}><AnimatedNumber value={Math.max(0, estimatedRefund)} /></div>
                      {weeklyDelta > 0 && (
                        <div className="inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: GREEN_TINT, color: GREEN_DARK }}>
                          <TrendingUp size={12} /> {fmt(weeklyDelta)} this month
                        </div>
                      )}
                    </div>
                    <div className="pt-2 pb-3">
                      <RadialProgress pct={readyPct} label="Tax Ready" trackColor={GREY_LINE} progressColor={TEAL} textColor={NAVY} labelColor="#8A93A3" />
                    </div>
                  </div>
                  <div className="mt-3 -mx-1">
                    <TrendSparkline points={weeklyDeductionsTrend} color={TEAL} />
                  </div>
                  <div className="mt-5 pt-4 grid grid-cols-4 gap-2" style={{ borderTop: "1px solid " + GREY_LINE }}>
                    {[
                      { icon: Wallet, label: "Income", value: fmt(income) },
                      { icon: Landmark, label: "Tax withheld", value: fmt(withheld) },
                      { icon: Wallet, label: "Current deductions", value: fmt(totalDeductions) },
                      { icon: Car, label: "Vehicle method", value: "Logbook" },
                    ].map((s) => (
                      <div key={s.label} className="flex flex-col items-center text-center gap-1.5">
                        <s.icon size={15} style={{ color: TEAL_DARK }} />
                        <div className="text-[10px] leading-tight" style={{ color: "#8A93A3" }}>{s.label}</div>
                        <div className="text-xs font-semibold tabular" style={{ color: NAVY }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {todaysTasks.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold" style={{ color: NAVY }}>Today's Tasks</span>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: TEAL_TINT, color: TEAL_DARK }}>{todaysTasks.length}</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: GREY_LINE }}>
                    {todaysTasks.map((t) => (
                      <button key={t.key} onClick={t.onGo} className="w-full flex items-center gap-3 py-3 text-left disabled:opacity-50 disabled:cursor-not-allowed group">
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
                      <span className="text-sm font-bold tabular" style={{ color: GREEN_DARK }}>+{fmt(laundryTaxBenefit)}</span>
                    </div>
                  )}
                </Card>
              )}

              {todaySuggestion && (
                <Card className="p-4 flex items-center gap-3" style={{ backgroundColor: TEAL_TINT }}>
                  <Sparkles size={16} color={TEAL_DARK} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: TEAL_DARK }}>Glovebox Insight</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: NAVY }}>{todaySuggestion.text}</div>
                  </div>
                  <button onClick={todaySuggestion.action} className="px-3.5 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 disabled:opacity-50 transition hover:brightness-95 bg-white" style={{ color: TEAL_DARK }}>
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
                    <EmptyState icon={Receipt} title="Nothing here" subtitle="Tap the + button to scan a receipt — Glovebox will sort it into the right category." />
                  ) : (
                    receiptsForTab.map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} />)
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "vehicle" && (
            <>
            <div className="-mx-4 sm:-mx-6 lg:mx-0 -mt-[68px] lg:mt-0 min-h-screen lg:min-h-0 lg:rounded-3xl fade-up" style={{ backgroundColor: "#081425" }}>
              <div className="px-4 sm:px-6 lg:px-6 pt-8 lg:pt-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}>
                    <Zap size={18} color="#fff" fill="#fff" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold text-white">Logbook</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "#79879C" }}>Track every trip. Maximise your deduction.</div>
                  </div>
                </div>
                <button onClick={() => setTab("settings")} className="p-2 -mr-2 flex-shrink-0" aria-label="Settings"><SettingsIcon size={20} color="#AEB9CB" /></button>
              </div>

              <div className="px-4 sm:px-6 lg:px-6">
                <div className="grid grid-cols-3 rounded-2xl p-1" style={{ backgroundColor: "#0D1B2E" }}>
                  <button onClick={() => setLogbookSubTab("overview")} className="py-2.5 rounded-xl text-sm font-semibold transition" style={logbookSubTab === "overview" ? { backgroundColor: TEAL, color: "#fff" } : { color: "#AEB9CB" }}>Overview</button>
                  <button onClick={() => setLogbookSubTab("trips")} className="py-2.5 rounded-xl text-sm font-semibold transition" style={logbookSubTab === "trips" ? { backgroundColor: TEAL, color: "#fff" } : { color: "#AEB9CB" }}>Trips</button>
                  <button onClick={() => setLogbookSubTab("review")} className="py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5" style={logbookSubTab === "review" ? { backgroundColor: TEAL, color: "#fff" } : { color: "#AEB9CB" }}>
                    Review Day
                    {reviewGapDays.length > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ backgroundColor: logbookSubTab === "review" ? "rgba(255,255,255,0.25)" : TEAL, color: "#fff" }}>{reviewGapDays.length}</span>
                    )}
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-6 lg:px-6 pt-4 pb-28 lg:pb-10 space-y-4">
                {logbookSubTab === "overview" && (
                  <>
                    <button onClick={() => openTripFormFor(null)} className="w-full text-left rounded-2xl p-5 pb-8 transition hover:brightness-110" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-start justify-between mb-4">
                        <span className="text-sm font-semibold text-white">Today's driving</span>
                        <span className="text-xs font-semibold" style={{ color: TEAL }}>Edit today</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-4xl font-bold text-white tabular">{Math.round(todayTotalKm)}<span className="text-lg font-semibold ml-1" style={{ color: "#79879C" }}>km</span></div>
                          <div className="flex items-center gap-4 mt-3 flex-wrap">
                            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#AEB9CB" }}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TEAL }} />Business <span className="font-semibold text-white">{Math.round(todayBusinessKm)} km</span></div>
                            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#AEB9CB" }}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#3A4A66" }} />Personal <span className="font-semibold text-white">{Math.round(todayPersonalKm)} km</span></div>
                          </div>
                        </div>
                        <RadialProgress pct={todayTotalKm > 0 ? todayBusinessPct / 100 : 0} label="Business use" size={92} trackColor="rgba(255,255,255,0.12)" progressColor={TEAL} textColor="#fff" labelColor="#AEB9CB" />
                      </div>
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="text-xs" style={{ color: "#79879C" }}>Current business use</div>
                        <div className="text-2xl font-bold text-white tabular mt-1">{businessPct}%</div>
                        {businessPctTrendDelta !== null && (
                          <div className="text-xs font-semibold mt-1" style={{ color: businessPctTrendDelta >= 0 ? GREEN : "#AEB9CB" }}>{businessPctTrendDelta >= 0 ? "↑" : "↓"} {Math.abs(businessPctTrendDelta)}% from last week</div>
                        )}
                        {businessPctTrend.length >= 2 && <div className="mt-2"><TrendSparkline points={businessPctTrend} color={TEAL} /></div>}
                      </div>

                      <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="text-xs" style={{ color: "#79879C" }}>Logbook progress</div>
                        <div className="text-2xl font-bold text-white tabular mt-1">{Math.min(daysElapsed, 84)} <span className="text-sm font-medium" style={{ color: "#79879C" }}>/ 84 days</span></div>
                        <div className="mt-2.5"><AnimatedBar pct={logbookProgress} color={TEAL} trackColor="rgba(255,255,255,0.10)" /></div>
                        <div className="text-[11px] font-medium mt-2" style={{ color: "#AEB9CB" }}>{Math.round(logbookProgress * 100)}% complete</div>
                        <div className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "#79879C" }}>
                          <Calendar size={11} />
                          {logbookStartDate && logbookEndDate ? `${fmtShortDate(logbookStartDate)} – ${fmtShortDate(logbookEndDate)}` : "Log a trip to start"}
                        </div>
                      </div>

                      <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="text-xs" style={{ color: "#79879C" }}>Estimated deduction</div>
                        <div className="text-2xl font-bold text-white tabular mt-1">{fmt(primaryDeductionEstimate)}</div>
                        <div className="text-[11px] mt-1" style={{ color: "#79879C" }}>{primaryDeductionMethodLabel}</div>
                        {deductionDeltaVsCentsPerKm > 0 && (
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold" style={{ backgroundColor: "rgba(24,195,126,0.15)", color: GREEN }}>
                            +{fmt(deductionDeltaVsCentsPerKm)} more than cents/km
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}>
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}>
                        <Sparkles size={16} style={{ color: TEAL }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold" style={{ color: !firstTripDate || !logbookReady ? "#fff" : recommendLogbookMethod ? GREEN : "#fff" }}>
                          {!firstTripDate
                            ? "Log your first trip to start your 12-week logbook."
                            : !logbookReady
                            ? `You're ${Math.min(daysElapsed, 84)} days into your logbook — keep it going.`
                            : recommendLogbookMethod
                            ? "You're ahead with the logbook method!"
                            : "Cents/km looks like the simpler claim right now."}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "#AEB9CB" }}>
                          {!firstTripDate
                            ? "The ATO needs a continuous 84-day record to use the logbook method."
                            : !logbookReady
                            ? `${84 - Math.min(daysElapsed, 84)} days left before your logbook method estimate unlocks.`
                            : recommendLogbookMethod
                            ? "Keep logging to maximise your deduction."
                            : "No need to keep tracking every vehicle expense receipt."}
                        </div>
                      </div>
                      <button onClick={() => setLogbookSubTab("trips")} className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: TEAL }}>View comparison<ChevronRight size={13} /></button>
                    </div>

                    <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-white">Recent trips</span>
                        <button onClick={() => setLogbookSubTab("trips")} className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: TEAL }}>View all trips<ChevronRight size={13} /></button>
                      </div>
                      {recentTrips.length === 0 ? (
                        <div className="py-8 text-center">
                          <div className="text-sm" style={{ color: "#AEB9CB" }}>No trips logged yet</div>
                          <div className="text-xs mt-1" style={{ color: "#79879C" }}>Tap + to log your first trip.</div>
                        </div>
                      ) : (
                        recentTrips.map((t) => (
                          <button key={t.id} onClick={() => setLogbookSubTab("trips")} className="w-full flex items-center gap-3 py-3 border-t first:border-t-0 text-left" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: t.type === "business" ? "rgba(37,99,255,0.15)" : "rgba(255,255,255,0.06)" }}><Car size={15} style={{ color: t.type === "business" ? TEAL : "#79879C" }} /></div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white truncate">{t.purpose || (t.type === "business" ? "Work trip" : "Personal trip")}</div>
                              <div className="text-xs mt-0.5" style={{ color: "#79879C" }}>{t.date === todayISO() ? "Today" : new Date(t.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-semibold text-white tabular">{t.km} km</div>
                              <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: t.type === "business" ? "rgba(24,195,126,0.15)" : "rgba(255,255,255,0.08)", color: t.type === "business" ? GREEN : "#AEB9CB" }}>{t.type === "business" ? "Business" : "Personal"}</span>
                            </div>
                            <ChevronRight size={15} style={{ color: "#3A4A66" }} className="flex-shrink-0" />
                          </button>
                        ))
                      )}
                    </div>

                    <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2"><Gauge size={16} style={{ color: "#AEB9CB" }} /><span className="text-sm font-semibold text-white">Odometer</span></div>
                        <button onClick={() => setTab("settings")} className="text-xs font-semibold" style={{ color: TEAL }}>Update</button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div><div className="text-[11px]" style={{ color: "#79879C" }}>Start</div><div className="text-base font-bold text-white tabular mt-0.5">{Math.round(activeData.profile.vehicle.openingOdometer || 0).toLocaleString()} km</div>{logbookStartDate && <div className="text-[10px] mt-0.5" style={{ color: "#79879C" }}>{fmtShortDate(logbookStartDate)}</div>}</div>
                        <div><div className="text-[11px]" style={{ color: "#79879C" }}>Current</div><div className="text-base font-bold text-white tabular mt-0.5">{Math.round(currentOdometer).toLocaleString()} km</div><div className="text-[10px] mt-0.5" style={{ color: "#79879C" }}>Today</div></div>
                        <div><div className="text-[11px]" style={{ color: "#79879C" }}>Distance</div><div className="text-base font-bold text-white tabular mt-0.5">{Math.round(totalKm).toLocaleString()} km</div><div className="text-[10px] mt-0.5" style={{ color: "#79879C" }}>Logged</div></div>
                      </div>
                    </div>
                  </>
                )}

                {logbookSubTab === "trips" && (
                  <>
                    <button onClick={() => openTripFormFor(null)} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-semibold transition hover:brightness-110" style={{ backgroundColor: TEAL }}>
                      <Car size={18} />Log Trip
                    </button>

                    <div className="rounded-2xl p-2 sm:p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="px-2 pt-2 pb-1 text-xs font-semibold" style={{ color: "#AEB9CB" }}>Trip log</div>
                      <div className="px-2">
                        {trips.length === 0 ? (
                          <div className="py-10 text-center">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}><Car size={20} style={{ color: TEAL }} /></div>
                            <p className="text-sm font-semibold text-white">No trips logged yet</p>
                            <p className="text-xs mt-1" style={{ color: "#79879C" }}>Tap Log Trip above, or import a Driversnote CSV to backfill your history.</p>
                          </div>
                        ) : (
                          trips.map((t) => (
                            <div key={t.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: t.type === "business" ? "rgba(37,99,255,0.15)" : "rgba(255,255,255,0.06)" }}><Car size={15} style={{ color: t.type === "business" ? TEAL : "#79879C" }} /></div>
                              <div className="min-w-0 flex-1"><div className="text-sm font-medium text-white truncate">{t.purpose || (t.type === "business" ? "Work trip" : "Personal trip")}</div><div className="text-xs mt-0.5" style={{ color: "#79879C" }}>{new Date(t.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div></div>
                              <div className="text-sm font-semibold text-white tabular">{t.km} km</div>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: t.type === "business" ? "rgba(24,195,126,0.15)" : "rgba(255,255,255,0.08)", color: t.type === "business" ? GREEN : "#AEB9CB" }}>{t.type === "business" ? "Business" : "Personal"}</span>
                              <button onClick={() => deleteTrip(t.id)} className="p-1.5 rounded-lg transition flex-shrink-0" style={{ color: "#5B6980" }}><Trash2 size={15} /></button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-white">Recommended method</span>
                        <button onClick={() => setShowLogbookInfo((v) => !v)} className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: TEAL }}>
                          Learn more <ChevronRight size={13} style={{ transform: showLogbookInfo ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                        </button>
                      </div>
                      {showLogbookInfo && (
                        <p className="text-xs leading-relaxed mb-3" style={{ color: "#AEB9CB" }}>Vehicle claims are usually the single largest deduction for tradies. The ATO wants a continuous 12-week period that records <b className="text-white">every</b> trip — work and private, not just work journeys. Complete your 84-day logbook once — it can support your claims for up to five years while your driving pattern stays similar.</p>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-xl border" style={{ borderColor: !recommendLogbookMethod && logbookReady ? TEAL : "rgba(255,255,255,0.10)", backgroundColor: !recommendLogbookMethod && logbookReady ? "rgba(37,99,255,0.12)" : "#14233A" }}>
                          <div className="text-[11px] font-medium" style={{ color: "#79879C" }}>Cents/km method</div>
                          <div className="text-lg font-bold text-white tabular mt-0.5">{fmt(centsPerKmEstimate)}</div>
                        </div>
                        <div className="p-3 rounded-xl border" style={{ borderColor: recommendLogbookMethod ? TEAL : "rgba(255,255,255,0.10)", backgroundColor: recommendLogbookMethod ? "rgba(37,99,255,0.12)" : "#14233A" }}>
                          <div className="text-[11px] font-medium" style={{ color: "#79879C" }}>Logbook method</div>
                          <div className="text-lg font-bold text-white tabular mt-0.5">{logbookReady ? fmt(logbookEstimate) : "—"}</div>
                          <div className="text-[10px] mt-0.5" style={{ color: "#79879C" }}>{logbookReady ? "Business % × total car costs" : "Finish your 12-week logbook to unlock this"}</div>
                        </div>
                      </div>
                      <p className="text-xs leading-relaxed mt-3" style={{ color: "#AEB9CB" }}>
                        {logbookReady
                          ? recommendLogbookMethod
                            ? "Based on what's logged so far, the logbook method looks like the better claim — it's not capped by kilometres like cents/km is."
                            : "Based on what's logged so far, cents/km looks simpler and about as good — no need to keep tracking every vehicle expense receipt."
                          : businessKm > CENTS_PER_KM_CAP_KM
                          ? "You're already over the 5,000 km cap for cents/km — finishing your logbook could unlock a bigger, uncapped claim."
                          : "Cents/km is fine to use for now. Once your 12-week logbook is done, Glovebox will tell you if switching to the logbook method is worth more."}
                      </p>
                    </div>

                    <button onClick={() => csvInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold border transition" style={{ borderColor: "rgba(255,255,255,0.14)", color: "#fff" }}>
                      <Upload size={15} />Import Driversnote CSV
                    </button>

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

                    <div>
                      <div className="text-sm font-semibold text-white mb-1">Vehicle Expense Tracker</div>
                      <div className="text-xs mb-3" style={{ color: "#79879C" }}>Fuel, servicing, rego & insurance — these feed the logbook-method estimate above.</div>
                      <div className="rounded-2xl p-2 sm:p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="px-2">
                          {receiptsWithNum.filter((r) => r.category === "vehicle").length === 0 ? (
                            <div className="py-10 text-center">
                              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}><Fuel size={20} style={{ color: TEAL }} /></div>
                              <p className="text-sm font-semibold text-white">No vehicle expenses yet</p>
                              <p className="text-xs mt-1" style={{ color: "#79879C" }}>Scan a fuel, servicing or insurance receipt and tag it as "Vehicle &amp; Fuel".</p>
                            </div>
                          ) : (
                            receiptsWithNum.filter((r) => r.category === "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} dark />)
                          )}
                        </div>
                      </div>
                    </div>

                    <button onClick={() => setTab("settings")} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition" style={{ borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#0D1B2E" }}>
                      <span className="text-sm font-semibold text-white">Vehicle details</span>
                      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL }}>Edit in Settings<ChevronRight size={14} /></span>
                    </button>
                  </>
                )}

                {logbookSubTab === "review" && (
                  <>
                    {!firstTripDate ? (
                      <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}><Calendar size={22} style={{ color: TEAL }} /></div>
                        <div className="text-sm font-semibold text-white">Nothing to review yet</div>
                        <p className="text-xs mt-2 leading-relaxed" style={{ color: "#AEB9CB" }}>Log your first trip to start your 12-week logbook — Glovebox will flag any days you might have missed after that.</p>
                        <button onClick={() => openTripFormFor(null)} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Log a trip</button>
                      </div>
                    ) : reviewGapDays.length === 0 ? (
                      <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(24,195,126,0.15)" }}><CheckCircle2 size={22} style={{ color: GREEN }} /></div>
                        <div className="text-sm font-semibold text-white">All caught up</div>
                        <p className="text-xs mt-2 leading-relaxed" style={{ color: "#AEB9CB" }}>Every day in the last {REVIEW_WINDOW_DAYS} days has a trip logged, or you've confirmed there wasn't one.</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs leading-relaxed" style={{ color: "#AEB9CB" }}>These days in your logbook period don't have a trip logged. Log one, or confirm there wasn't any driving that day — the ATO logbook needs a continuous record.</p>
                        {reviewGapDays.map((iso) => (
                          <div key={iso} className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(199,127,26,0.15)" }}><Calendar size={16} style={{ color: AMBER }} /></div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white">{new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}</div>
                              <div className="text-xs mt-0.5" style={{ color: "#79879C" }}>No trip logged</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button onClick={() => markNoTravel(iso)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#AEB9CB" }}>No travel</button>
                              <button onClick={() => openTripFormFor(iso)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition" style={{ backgroundColor: TEAL }}>Log trip</button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            {logbookSubTab === "overview" && (
              <button onClick={() => openTripFormFor(null)} className="fixed right-4 sm:right-6 bottom-20 lg:bottom-6 z-20 w-14 h-14 rounded-full flex items-center justify-center transition hover:brightness-110 active:scale-95" style={{ backgroundColor: TEAL, boxShadow: "0 8px 24px -4px rgba(37,99,255,0.55)" }} aria-label="Add Trip">
                <Plus size={24} color="#fff" />
              </button>
            )}
            </>
          )}

          {tab === "expenses" && (
            <div className="-mx-4 sm:-mx-6 lg:mx-0 -mt-[68px] lg:mt-0 min-h-screen lg:min-h-0 lg:rounded-3xl fade-up" style={{ backgroundColor: "#081425" }}>
              <div className="px-4 sm:px-6 lg:px-6 pt-8 lg:pt-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}>
                    <Zap size={18} color="#fff" fill="#fff" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold text-white">Deductions</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "#79879C" }}>Track your deductions and grow your refund.</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowReceiptFilters((v) => !v)}
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition"
                  style={showReceiptFilters ? { backgroundColor: "rgba(37,99,255,0.15)", color: TEAL } : { backgroundColor: "#0D1B2E", color: "#AEB9CB" }}
                  aria-label="Filters"
                >
                  <SlidersHorizontal size={16} />
                </button>
              </div>

              <div className="px-4 sm:px-6 lg:px-6 pb-28 lg:pb-10 space-y-4">
                <div className="rounded-2xl p-5" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: "#79879C" }}>Total estimated deductions</span>
                    {monthGrowthPct !== 0 && (
                      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: "rgba(24,195,126,0.15)", color: GREEN }}>
                        <TrendingUp size={11} style={monthGrowthPct < 0 ? { transform: "scaleY(-1)" } : undefined} />{monthGrowthPct > 0 ? "Up" : "Down"} {Math.abs(monthGrowthPct)}%
                      </div>
                    )}
                  </div>
                  <div className="text-4xl font-bold tabular mt-1 text-white"><AnimatedNumber value={totalDeductions} /></div>
                  {thisMonthDelta !== 0 && (
                    <div className="flex items-center gap-1.5 mt-2 text-sm font-medium" style={{ color: GREEN }}>
                      <TrendingUp size={13} style={thisMonthDelta < 0 ? { transform: "scaleY(-1)" } : undefined} />{thisMonthDelta > 0 ? "+" : "-"}{fmt(Math.abs(thisMonthDelta))} this month
                    </div>
                  )}
                  <div className="text-xs mt-0.5" style={{ color: "#79879C" }}>Compared to last month</div>
                  <div className="mt-3 -mx-1">
                    <TrendSparkline points={monthlyDeductionsTrend} color={TEAL} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-white">By category</span>
                    <button onClick={() => receiptsListRef.current?.scrollIntoView({ behavior: "smooth" })} className="text-xs font-semibold" style={{ color: TEAL }}>View all categories</button>
                  </div>
                  <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {deductionCategoryRows.map((row) => (
                      <button key={row.key} onClick={row.onGo} className="w-full text-left px-4 py-3.5 flex items-center gap-3 border-b last:border-0 transition hover:bg-white/5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}><row.icon size={16} style={{ color: TEAL }} /></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white">{row.label}</div>
                          <div className="text-xs mt-0.5" style={row.needsSetup ? { color: AMBER, fontWeight: 600 } : { color: "#79879C" }}>{row.sub}</div>
                          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.amount / maxCategoryRowAmount) * 100)}%`, backgroundColor: row.needsSetup ? "rgba(255,255,255,0.18)" : TEAL }} />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold text-white tabular">{fmt(row.amount)}</div>
                          <div className="text-[11px]" style={{ color: "#79879C" }}>{totalDeductions > 0 ? Math.round((row.amount / totalDeductions) * 100) : 0}% of total</div>
                        </div>
                        <ChevronRight size={15} className="flex-shrink-0" style={{ color: "#3A4A66" }} />
                      </button>
                    ))}
                  </div>
                </div>

                {recentReceipts.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-white">Recent receipts</span>
                      <button onClick={() => receiptsListRef.current?.scrollIntoView({ behavior: "smooth" })} className="text-xs font-semibold" style={{ color: TEAL }}>View all receipts</button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                      {recentReceipts.map((r) => {
                        const cat = CATEGORIES.find((c) => c.key === r.category);
                        return (
                          <button key={r.id} onClick={() => setEditingReceipt(r)} className="flex-shrink-0 w-36 text-left rounded-2xl p-3" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                            <div className="w-full h-16 rounded-xl flex items-center justify-center mb-2" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}>{cat && <cat.icon size={22} style={{ color: TEAL }} />}</div>
                            <div className="text-xs font-semibold text-white truncate">{r.vendor || "Untitled"}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: "#79879C" }}>{new Date(r.date).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</div>
                            {cat && <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: "rgba(37,99,255,0.15)", color: TEAL }}>{cat.label}</span>}
                            <div className="text-sm font-bold text-white tabular mt-1.5">{fmtDec(r.amount)}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {todaySuggestion && (
                  <div className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: "#14233A", border: "1px solid rgba(255,255,255,0.10)" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}>
                      <Sparkles size={16} style={{ color: TEAL }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: TEAL }}>Glovebox Insight</div>
                      <div className="text-sm font-medium mt-0.5 text-white">{todaySuggestion.text}</div>
                    </div>
                    <button onClick={todaySuggestion.action} className="px-3.5 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition hover:brightness-110" style={{ backgroundColor: TEAL, color: "#fff" }}>
                      Add now
                    </button>
                  </div>
                )}

                <button onClick={() => setTab("settings")} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition" style={{ borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#0D1B2E" }}>
                  <span className="text-sm font-semibold text-white">Your details & other deductions</span>
                  <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL }}>Edit in Settings<ChevronRight size={14} /></span>
                </button>

                <div className="rounded-2xl p-2 sm:p-4" style={{ backgroundColor: "#0D1B2E", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div ref={receiptsListRef} style={{ scrollMarginTop: "80px" }} />
                  {showReceiptFilters && (
                    <div className="flex items-center gap-2 flex-wrap px-2 pt-2 pb-3">
                      <button onClick={() => setReceiptCategoryFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === "all" ? { backgroundColor: TEAL, color: "#fff" } : { backgroundColor: "rgba(255,255,255,0.08)", color: "#AEB9CB" }}>All work expenses</button>
                      {CATEGORIES.map((c) => (
                        <button key={c.key} onClick={() => setReceiptCategoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={receiptCategoryFilter === c.key ? { backgroundColor: TEAL, color: "#fff" } : { backgroundColor: "rgba(255,255,255,0.08)", color: "#AEB9CB" }}>{c.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="px-2">
                    {filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").length === 0 ? (
                      <div className="py-10 text-center">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(37,99,255,0.15)" }}><Wrench size={20} style={{ color: TEAL }} /></div>
                        <p className="text-sm font-semibold text-white">Nothing here yet</p>
                        <p className="text-xs mt-1" style={{ color: "#79879C" }}>Tap the + button to scan a receipt straight into this category.</p>
                      </div>
                    ) : (
                      filteredReceipts.filter((r) => receiptCategoryFilter !== "all" || r.category !== "vehicle").map((r) => <ReceiptRow key={r.id} r={r} onDelete={deleteReceipt} onEdit={setEditingReceipt} dark />)
                    )}
                  </div>
                </div>
              </div>
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
                  <Field label="Your name"><input value={activeData.profile.name} onChange={(e) => setProfile("name", e.target.value)} placeholder="Optional" className={inputCls} /></Field>
                  <Field label="Occupation"><input value={activeData.profile.occupation} onChange={(e) => setProfile("occupation", e.target.value)} className={inputCls} /></Field>
                  <Field label="Income ($)"><input type="number" value={activeData.profile.income} onChange={(e) => setProfile("income", Number(e.target.value))} className={inputCls} /></Field>
                  <Field label="Tax withheld ($)"><input type="number" value={activeData.profile.taxWithheld} onChange={(e) => setProfile("taxWithheld", Number(e.target.value))} className={inputCls} /></Field>
                </div>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Vehicle details" eyebrow="Used for your logbook and odometer tracking" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Make"><input value={activeData.profile.vehicle.make} onChange={(e) => setVehicle("make", e.target.value)} className={inputCls} placeholder="Toyota" /></Field>
                  <Field label="Model"><input value={activeData.profile.vehicle.model} onChange={(e) => setVehicle("model", e.target.value)} className={inputCls} placeholder="HiLux" /></Field>
                  <Field label="Rego"><input value={activeData.profile.vehicle.rego} onChange={(e) => setVehicle("rego", e.target.value)} className={inputCls} placeholder="1AB2CD" /></Field>
                  <Field label="Opening odometer (km)"><input type="number" value={activeData.profile.vehicle.openingOdometer} onChange={(e) => setVehicle("openingOdometer", Number(e.target.value))} className={inputCls} /></Field>
                </div>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Other common deductions" eyebrow="No receipts needed under ATO thresholds" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Laundry & uniform estimate (up to $${LAUNDRY_ATO_CAP} without receipts)`}>
                    <input type="number" value={activeData.profile.laundryEstimate} onChange={(e) => setProfile("laundryEstimate", Number(e.target.value))} className={inputCls} />
                  </Field>
                  <Field label="Phone & internet work-use %">
                    <input type="number" min={0} max={100} value={activeData.profile.phoneWorkPct} onChange={(e) => setProfile("phoneWorkPct", Number(e.target.value))} className={inputCls} />
                  </Field>
                </div>
                <p className="text-xs mt-3 leading-relaxed" style={{ color: "#8A93A3" }}>The ATO allows a reasonable estimate for laundering work uniforms without keeping receipts, up to ${LAUNDRY_ATO_CAP} a year. Your phone % should reflect genuine work use — check a typical bill if you're not sure.</p>
              </Card>

              <Card className="p-5">
                <SectionTitle title="AI travel memory" eyebrow="What Glovebox AI remembers when you log trips" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Home address">
                    <input value={activeData.profile.homeAddress || ""} onChange={(e) => updateTravelProfile({ homeAddress: e.target.value })} placeholder="e.g. 18 Maureen Close, Cranbourne West" className={inputCls} />
                  </Field>
                  <Field label="Usual trip type">
                    <select value={activeData.profile.assumeRoundTrip === false ? "one_way" : "round_trip"} onChange={(e) => updateTravelProfile({ assumeRoundTrip: e.target.value === "round_trip" })} className={inputCls}>
                      <option value="round_trip">Round trip (there and back)</option>
                      <option value="one_way">One-way</option>
                    </select>
                  </Field>
                </div>
                <p className="text-xs mt-3 leading-relaxed" style={{ color: "#8A93A3" }}>Glovebox AI uses these so it doesn't have to ask every time you log a trip — it'll also update them automatically as you chat.</p>
              </Card>

              <Card className="p-5">
                <SectionTitle title="Account" />
                <div className="flex flex-wrap gap-2">
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

      {(showReceiptForm || editingReceipt) && (
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

      {showScanCapture && (
        <ScanCaptureScreen
          onClose={() => setShowScanCapture(false)}
          onGallery={() => receiptInputRef.current?.click()}
          onShutter={() => receiptCameraInputRef.current?.click()}
        />
      )}

      {scanQueue.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" style={{ backgroundColor: "#0D1B2E" }}>
            <ReceiptReviewModal
              key={scanQueue[0].id}
              item={scanQueue[0]}
              onSave={(r) => { addReceipt(r); setScanQueue((p) => p.slice(1)); }}
              onCancel={() => setScanQueue((p) => p.slice(1))}
            />
          </div>
        </div>
      )}

      {showTripForm && (
        <LogTripScreen onSaveTrips={addTrips} onClose={() => { setShowTripForm(false); setTripFormDate(null); }} homeAddress={activeData.profile.homeAddress} assumeRoundTrip={activeData.profile.assumeRoundTrip} initialDate={tripFormDate || undefined} />
      )}

      {!showReceiptForm && !showTripForm && !editingReceipt && !assistantOpen && (
        <>
          {!(tab === "vehicle" && logbookSubTab === "overview") && (
            <FloatingActionButton
              onScan={quickUploadReceipt}
              onLogTrip={quickLogTravel}
              onAddExpense={openManualExpenseEntry}
              onImportCsv={() => csvInputRef.current?.click()}

            />
          )}
          {ASSISTANT_URL && <AssistantButton onClick={() => setAssistantOpen(true)} />}
        </>
      )}

      {assistantOpen && (
        <AssistantModal
          messages={assistantMessages}
          loading={assistantLoading}
          onSend={sendAssistantMessage}
          onClose={() => setAssistantOpen(false)}
         
        />
      )}
    </div>
  );
}






