export type CategoryKey =
  | "tools"
  | "clothing"
  | "ppe"
  | "phone"
  | "tafe"
  | "vehicle"
  | "other";

export interface Receipt {
  id: string;
  date: string; // ISO yyyy-mm-dd
  vendor: string;
  category: CategoryKey;
  amount: number;
  workPct: number; // 0-100
  filed: boolean;
  notes?: string;
  fileName?: string;
}

export interface Trip {
  id: string;
  date: string;
  purpose: string;
  type: "business" | "personal";
  km: number;
}

export interface VehicleDetails {
  make: string;
  model: string;
  rego: string;
  openingOdometer: number;
}

export interface Profile {
  name: string;
  occupation: string;
  fy: string;
  income: number;
  taxWithheld: number;
  phoneWorkPct: number;
  laundryEstimate: number;
  vehicle: VehicleDetails;
  quickSetupDone: boolean;
}

export interface AppData {
  profile: Profile;
  receipts: Receipt[];
  trips: Trip[];
}
