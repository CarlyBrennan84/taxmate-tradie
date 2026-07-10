import type { AppData } from "../types";

/**
 * Storage layer for TaxMate Tradie.
 *
 * Today this reads/writes browser localStorage. When you're ready to
 * connect Supabase, replace the two functions below with Supabase
 * calls (e.g. `supabase.from('app_data').select()` /
 * `.upsert()` keyed by user id) — nothing else in the app needs to
 * change, since every component only ever calls loadData()/saveData().
 */

const STORAGE_KEY = "taxmate-tradie-data";

export async function loadData(defaults: AppData): Promise<AppData> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        profile: {
          ...defaults.profile,
          ...(parsed.profile || {}),
          vehicle: {
            ...defaults.profile.vehicle,
            ...((parsed.profile && parsed.profile.vehicle) || {}),
          },
        },
      };
    }
  } catch (e) {
    console.error("Failed to load TaxMate Tradie data", e);
  }
  return defaults;
}

export async function saveData(data: AppData): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save TaxMate Tradie data", e);
  }
}

const DEMO_KEY = "taxmate-tradie-demo-mode";

export function loadDemoFlag(): boolean {
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1";
  } catch (e) {
    return false;
  }
}

export function saveDemoFlag(on: boolean): void {
  try {
    window.localStorage.setItem(DEMO_KEY, on ? "1" : "0");
  } catch (e) {}
}

/* ---------------------------------------------------------------
   Future Supabase sketch (kept here for when you're ready):

   import { createClient } from "@supabase/supabase-js";
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

   export async function loadData(defaults: AppData, userId: string) {
     const { data, error } = await supabase
       .from("app_data")
       .select("payload")
       .eq("user_id", userId)
       .single();
     if (error || !data) return defaults;
     return { ...defaults, ...data.payload };
   }

   export async function saveData(data: AppData, userId: string) {
     await supabase
       .from("app_data")
       .upsert({ user_id: userId, payload: data });
   }
---------------------------------------------------------------- */
