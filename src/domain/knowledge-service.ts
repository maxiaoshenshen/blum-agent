/**
 * Knowledge Service — runtime knowledge loading with localStorage caching.
 *
 * Knowledge is served as a static JSON file (public/data/knowledge.json) so that
 * updating the knowledge base does NOT require rebuilding the entire app.
 *
 * Loading strategy:
 *  1. Check localStorage cache (keyed by version hash).
 *  2. If cache hit → return immediately (synchronous).
 *  3. If cache miss → fetch from /data/knowledge.json, cache in localStorage.
 *  4. Subsequent accessors work synchronously against the in-memory cache.
 */

import type { OfficialSource } from "./types";

export interface KnowledgeSnapshot {
  version: string;
  generatedAt: string;
  knowledgeBase: readonly OfficialSource[];
  officialSources: readonly OfficialSource[];
  fallbackSourceIds: readonly string[];
}

const CACHE_KEY = "blum-knowledge-v1";

// In-memory cache — populated once on first access and reused for all queries.
let _snapshot: KnowledgeSnapshot | null = null;

/**
 * Prime the cache. Call in a useEffect on app mount.
 * Safe to call multiple times — subsequent calls return immediately if already loaded.
 */
export async function preloadKnowledge(): Promise<void> {
  if (_snapshot) return;
  _snapshot = await loadFromCacheOrNetwork();
}

/** Synchronous access — requires preloadKnowledge() to have been called first. */
export function getKnowledge(): KnowledgeSnapshot {
  if (!_snapshot) {
    _snapshot = loadFromLocalStorage() ?? createEmptySnapshot();
  }
  return _snapshot;
}

export function isKnowledgeLoaded(): boolean {
  return _snapshot !== null;
}

export function getAllSources(): readonly OfficialSource[] {
  return getKnowledge().officialSources;
}

export function findSourcesByIds(ids: readonly string[]): readonly OfficialSource[] {
  const sources = getKnowledge().officialSources;
  return ids.flatMap((id) => {
    const found = (sources as OfficialSource[]).find((s) => s.id === id);
    return found ? [found] : [];
  });
}

export function getFallbackSources(): OfficialSource[] {
  const { officialSources, fallbackSourceIds } = getKnowledge();
  return fallbackSourceIds.flatMap((id) => {
    const found = (officialSources as OfficialSource[]).find((s) => s.id === id);
    return found ? [found] : [];
  });
}

// ─── private ──────────────────────────────────────────────────────────────────

function createEmptySnapshot(): KnowledgeSnapshot {
  return {
    version: "0.0.0",
    generatedAt: new Date().toISOString(),
    knowledgeBase: [],
    officialSources: [],
    fallbackSourceIds: [],
  };
}

function loadFromLocalStorage(): KnowledgeSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KnowledgeSnapshot;
  } catch {
    return null;
  }
}

function saveToLocalStorage(snapshot: KnowledgeSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Silently skip if localStorage is unavailable (private browsing, quota exceeded).
  }
}

async function loadFromCacheOrNetwork(): Promise<KnowledgeSnapshot> {
  const cached = loadFromLocalStorage();
  if (cached) return cached;
  const fresh = await fetchFromNetwork();
  saveToLocalStorage(fresh);
  return fresh;
}

async function fetchFromNetwork(): Promise<KnowledgeSnapshot> {
  const url = "/data/knowledge.json";
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      console.error(`[knowledge-service] Failed to fetch ${url}: ${resp.status}`);
      return createEmptySnapshot();
    }
    const json = (await resp.json()) as unknown;
    if (
      !json ||
      typeof json !== "object" ||
      !("version" in json) ||
      !Array.isArray((json as Record<string, unknown>).officialSources)
    ) {
      console.error("[knowledge-service] Invalid knowledge JSON structure.");
      return createEmptySnapshot();
    }
    return json as KnowledgeSnapshot;
  } catch (err) {
    console.error("[knowledge-service] Network error loading knowledge:", err);
    return createEmptySnapshot();
  }
}

/** Force reload, bypassing localStorage cache. */
export async function reloadKnowledge(): Promise<void> {
  const fresh = await fetchFromNetwork();
  saveToLocalStorage(fresh);
  _snapshot = fresh;
}
