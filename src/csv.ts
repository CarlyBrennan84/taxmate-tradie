import type { Trip } from "./types";

function normalizeDate(s: string): string | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"|"$/g, ""));
}

/**
 * Best-effort parser for Driversnote-style trip exports. Column names
 * vary between export formats, so this matches on common keywords
 * rather than exact headers. Always review the preview before
 * committing — some rows may need a manual fix (e.g. business vs
 * personal classification defaults to "business" if it can't tell).
 */
export function parseDriversnoteCSV(text: string): Trip[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
  const findCol = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const dateIdx = findCol(["date"]);
  const kmIdx = findCol(["distance", "km", "kilomet"]);
  const purposeIdx = findCol(["purpose", "reason", "note", "description", "client"]);
  const typeIdx = findCol(["type", "category", "classification", "business"]);

  const trips: Trip[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const km = kmIdx >= 0 ? parseFloat((cols[kmIdx] || "0").replace(/[^0-9.\-]/g, "")) : 0;
    if (!km || km <= 0) continue;
    const date = (dateIdx >= 0 && normalizeDate(cols[dateIdx])) || new Date().toISOString().slice(0, 10);
    const purpose = (purposeIdx >= 0 && cols[purposeIdx]) || "Imported trip";
    const typeRaw = (typeIdx >= 0 ? cols[typeIdx] : "").toLowerCase();
    const type: "business" | "personal" = typeRaw.includes("personal") || typeRaw.includes("private") ? "personal" : "business";
    trips.push({ id: Math.random().toString(36).slice(2, 10), date, purpose, type, km });
  }
  return trips;
}
