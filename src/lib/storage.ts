import type { AppData } from "../types";
import { supabase } from "./supabaseClient";

/**
 * Storage layer for Glovebox. Every component only ever calls
 * loadData()/saveData() — this is the one place that knows how data is
 * actually persisted.
 *
 * Data lives in Supabase (table `app_data`, one row per user, protected by
 * row-level security — see supabase/schema.sql). The old localStorage key is
 * still checked once on first login so existing local data isn't lost when
 * an account is created — see migrateLocalDataIfAny().
 */

const LOCAL_STORAGE_KEY = "taxmate-tradie-data";

function mergeWithDefaults(defaults: AppData, parsed: Partial<AppData>): AppData {
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

async function migrateLocalDataIfAny(defaults: AppData, userId: string): Promise<AppData | null> {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const merged = mergeWithDefaults(defaults, parsed);
    await saveData(merged, userId);
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return merged;
  } catch (e) {
    console.error("Failed to migrate local Glovebox data", e);
    return null;
  }
}

export async function loadData(defaults: AppData, userId: string): Promise<AppData> {
  if (!supabase) return defaults;
  try {
    const { data, error } = await supabase
      .from("app_data")
      .select("payload")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const migrated = await migrateLocalDataIfAny(defaults, userId);
      return migrated || defaults;
    }
    return mergeWithDefaults(defaults, (data.payload as Partial<AppData>) || {});
  } catch (e) {
    console.error("Failed to load Glovebox data", e);
    return defaults;
  }
}

export async function saveData(data: AppData, userId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("app_data")
      .upsert({ user_id: userId, payload: data, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    console.error("Failed to save Glovebox data", e);
  }
}
