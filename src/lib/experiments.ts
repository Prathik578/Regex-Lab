/* Experiment persistence: Supabase with localStorage fallback.
 * Each experiment = { name, pattern, testStrings, customAutomaton }.
 */

import { supabase } from "./supabaseClient";

export type CustomAutomatonData = {
  states: { id: string; x: number; y: number; isInitial: boolean; isAccepting: boolean }[];
  transitions: { id: string; from: string; to: string; label: string }[];
};

export type Experiment = {
  id: string;
  name: string;
  pattern: string;
  test_strings: string[];
  custom_automaton: CustomAutomatonData | null;
  created_at: string;
  updated_at: string;
};

const LS_KEY = "regexlab_local_experiments";

type LocalExperiment = {
  id: string;
  name: string;
  pattern: string;
  testStrings: string[];
  customAutomaton: CustomAutomatonData | null;
  createdAt: string;
  updatedAt: string;
};

function readLocal(): LocalExperiment[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LocalExperiment[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: LocalExperiment[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage full or unavailable — persistence degrades silently
  }
}

function toLocal(e: Experiment): LocalExperiment {
  return {
    id: e.id,
    name: e.name,
    pattern: e.pattern,
    testStrings: e.test_strings,
    customAutomaton: e.custom_automaton,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

function toRemote(l: LocalExperiment) {
  return {
    name: l.name,
    pattern: l.pattern,
    test_strings: l.testStrings,
    custom_automaton: l.customAutomaton,
  };
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/** Save (insert or update) an experiment. Tries Supabase; falls back to localStorage. */
export async function saveExperiment(input: {
  id: string | null;
  name: string;
  pattern: string;
  testStrings: string[];
  customAutomaton: CustomAutomatonData | null;
}): Promise<SaveResult> {
  const now = new Date().toISOString();

  // Try Supabase first
  if (input.id && !isLocalId(input.id)) {
    const { error } = await supabase
      .from("experiments")
      .update({ name: input.name, pattern: input.pattern, test_strings: input.testStrings, custom_automaton: input.customAutomaton, updated_at: now })
      .eq("id", input.id);
    if (!error) return { ok: true, id: input.id };
    if (!isNetworkError(error)) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase
      .from("experiments")
      .insert({ name: input.name, pattern: input.pattern, test_strings: input.testStrings, custom_automaton: input.customAutomaton })
      .select()
      .single();
    if (!error && data) return { ok: true, id: (data as Experiment).id };
    if (!isNetworkError(error)) return { ok: false, error: error?.message ?? "Insert failed" };
  }

  // Fallback to localStorage
  const list = readLocal();
  if (input.id && isLocalId(input.id)) {
    const idx = list.findIndex((e) => e.id === input.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: input.name, pattern: input.pattern, testStrings: input.testStrings, customAutomaton: input.customAutomaton, updatedAt: now };
      writeLocal(list);
      return { ok: true, id: input.id };
    }
  }
  const local: LocalExperiment = {
    id: `local-${crypto.randomUUID()}`,
    name: input.name,
    pattern: input.pattern,
    testStrings: input.testStrings,
    customAutomaton: input.customAutomaton,
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(local);
  writeLocal(list);
  return { ok: true, id: local.id };
}

function isNetworkError(error: { message: string } | null): boolean {
  if (!error) return false;
  const m = error.message.toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("failed to") || m.includes("timeout");
}

function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

/** Load all experiments (remote merged with local). */
export async function loadExperiments(): Promise<{ experiments: LocalExperiment[]; warning: string | null }> {
  let remote: LocalExperiment[] = [];
  let warning: string | null = null;
  const { data, error } = await supabase
    .from("experiments")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (!error && data) {
    remote = (data as Experiment[]).map(toLocal);
  } else if (error) {
    warning = "Saved experiments are stored in this browser only right now.";
  }
  const local = readLocal();
  return { experiments: [...local, ...remote], warning };
}

/** Delete an experiment by id (remote or local). */
export async function deleteExperiment(id: string): Promise<void> {
  if (isLocalId(id)) {
    writeLocal(readLocal().filter((e) => e.id !== id));
    return;
  }
  await supabase.from("experiments").delete().eq("id", id);
  // also clear any stale local copy
  writeLocal(readLocal().filter((e) => e.id !== id));
}

export { toRemote };
