import type { AppData, Receipt, Trip } from "./types";

const daysAgoISO = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const sampleReceipts: Receipt[] = [
  { id: "d1", date: daysAgoISO(120), vendor: "Total Tools", category: "tools", amount: 249.0, workPct: 100, filed: true, notes: "Cordless drill kit" },
  { id: "d2", date: daysAgoISO(95), vendor: "Bunnings", category: "tools", amount: 78.5, workPct: 100, filed: true, notes: "Hand tools" },
  { id: "d3", date: daysAgoISO(80), vendor: "Blackwoods", category: "ppe", amount: 65.0, workPct: 100, filed: true, notes: "Steel-cap boots" },
  { id: "d4", date: daysAgoISO(80), vendor: "Blackwoods", category: "ppe", amount: 34.9, workPct: 100, filed: false, notes: "Safety glasses & gloves" },
  { id: "d5", date: daysAgoISO(70), vendor: "Workwear World", category: "clothing", amount: 112.0, workPct: 100, filed: true, notes: "Branded uniform shirts" },
  { id: "d6", date: daysAgoISO(60), vendor: "TAFE NSW", category: "tafe", amount: 385.0, workPct: 100, filed: true, notes: "Certificate III course fee" },
  { id: "d7", date: daysAgoISO(45), vendor: "Telstra", category: "phone", amount: 89.0, workPct: 40, filed: true, notes: "Monthly phone plan" },
  { id: "d8", date: daysAgoISO(38), vendor: "BP", category: "vehicle", amount: 92.4, workPct: 100, filed: true, notes: "Fuel" },
  { id: "d9", date: daysAgoISO(25), vendor: "Shell", category: "vehicle", amount: 88.1, workPct: 100, filed: false, notes: "Fuel" },
  { id: "d10", date: daysAgoISO(20), vendor: "Midas", category: "vehicle", amount: 220.0, workPct: 100, filed: true, notes: "Service & tyres" },
  { id: "d11", date: daysAgoISO(14), vendor: "Total Tools", category: "tools", amount: 59.95, workPct: 100, filed: false, notes: "Tool belt" },
  { id: "d12", date: daysAgoISO(6), vendor: "Telstra", category: "phone", amount: 89.0, workPct: 40, filed: true, notes: "Monthly phone plan" },
];

const tripPurposes = [
  "Site visit — Preston job",
  "Depot to job site",
  "Supplier run — Blackwoods",
  "Job site — Reservoir",
  "TAFE class",
  "Home to depot",
  "Weekend errands",
  "Job site — Coburg",
  "Client meeting",
  "Grocery shopping",
];

function buildSampleTrips(): Trip[] {
  const trips: Trip[] = [];
  for (let i = 0; i < 22; i++) {
    const dayOffset = Math.floor((i / 22) * 82) + Math.floor(Math.random() * 2);
    const isPersonal = i % 5 === 0;
    trips.push({
      id: `dt${i}`,
      date: daysAgoISO(82 - dayOffset),
      purpose: isPersonal ? tripPurposes[(i + 1) % tripPurposes.length].includes("Weekend") ? tripPurposes[6] : "Personal errands" : tripPurposes[i % tripPurposes.length],
      type: isPersonal ? "personal" : "business",
      km: Math.round((isPersonal ? 8 + Math.random() * 15 : 12 + Math.random() * 38) * 10) / 10,
    });
  }
  return trips.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const SAMPLE_DATA: AppData = {
  profile: {
    name: "Jordan",
    occupation: "Apprentice Electrician",
    fy: "2025–26",
    income: 52000,
    taxWithheld: 7800,
    phoneWorkPct: 40,
    laundryEstimate: 120,
    vehicle: { make: "Toyota", model: "HiLux", rego: "1AB2CD", openingOdometer: 45210 },
  },
  receipts: sampleReceipts,
  trips: buildSampleTrips(),
};
