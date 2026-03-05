import { parseDurationMs } from "../../cli/parse-duration.js";
import type { OpenClawConfig } from "../../config/config.js";

type SemanticCacheMode = "exact" | "semantic";

type SemanticCacheEntry = {
  normalizedPrompt: string;
  promptTokens: string[];
  responseText: string;
  createdAt: number;
  expiresAt: number;
};

export type SemanticCacheSettings = {
  mode: SemanticCacheMode;
  ttlMs: number;
  maxEntries: number;
  minPromptChars: number;
  minSimilarity: number;
  cacheActions: boolean;
};

export type SemanticCacheHit = {
  responseText: string;
  similarity: number;
  createdAt: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MIN_PROMPT_CHARS = 12;
const DEFAULT_MIN_SIMILARITY = 0.9;

const NON_ALNUM_RE = /[^\p{L}\p{N}\s]+/gu;
const WS_RE = /\s+/g;
const QUESTION_WORDS = new Set([
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "which",
  "сколько",
  "когда",
  "где",
  "кто",
  "что",
  "почему",
  "как",
  "какой",
]);
const ACTION_HINT_RE =
  /(turn on|turn off|set |switch|enable|disable|start|stop|run|execute|open|close|включи|выключи|установи|запусти|останови|открой|закрой|выполни|создай|сделай)/iu;

const cacheByScope = new Map<string, SemanticCacheEntry[]>();

function buildCacheScope(params: {
  sessionKey: string;
  provider?: string;
  model?: string;
}): string | null {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return null;
  }
  const provider = params.provider?.trim().toLowerCase() ?? "";
  const model = params.model?.trim().toLowerCase() ?? "";
  return provider && model ? `${sessionKey}::${provider}/${model}` : sessionKey;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizePrompt(rawPrompt: string): string {
  return rawPrompt
    .toLowerCase()
    .replace(NON_ALNUM_RE, " ")
    .replace(WS_RE, " ")
    .trim();
}

function tokenize(normalizedPrompt: string): string[] {
  return [...new Set(normalizedPrompt.split(" ").filter((token) => token.length >= 2))];
}

function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function isQuestionLike(rawPrompt: string, normalizedPrompt: string): boolean {
  if (/[?？]\s*$/.test(rawPrompt)) {
    return true;
  }
  const firstToken = normalizedPrompt.split(" ")[0] ?? "";
  return QUESTION_WORDS.has(firstToken);
}

function isLikelyActionPrompt(rawPrompt: string, normalizedPrompt: string): boolean {
  if (isQuestionLike(rawPrompt, normalizedPrompt)) {
    return false;
  }
  return ACTION_HINT_RE.test(rawPrompt);
}

function pruneExpiredEntries(entries: SemanticCacheEntry[], now: number): SemanticCacheEntry[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

export function resolveSemanticCacheSettings(
  config: OpenClawConfig | undefined,
): SemanticCacheSettings | null {
  const raw = config?.agents?.defaults?.semanticCache;
  const modeRaw = raw?.mode;
  if (modeRaw !== "exact" && modeRaw !== "semantic") {
    return null;
  }

  let ttlMs = DEFAULT_TTL_MS;
  if (typeof raw?.ttl === "string") {
    try {
      ttlMs = parseDurationMs(raw.ttl, { defaultUnit: "m" });
    } catch {
      ttlMs = DEFAULT_TTL_MS;
    }
  }

  return {
    mode: modeRaw,
    ttlMs: Math.round(clampNumber(ttlMs, DEFAULT_TTL_MS, 1_000, 24 * 60 * 60 * 1000)),
    maxEntries: Math.round(
      clampNumber(raw?.maxEntries, DEFAULT_MAX_ENTRIES, 1, 500),
    ),
    minPromptChars: Math.round(
      clampNumber(raw?.minPromptChars, DEFAULT_MIN_PROMPT_CHARS, 1, 1000),
    ),
    minSimilarity: clampNumber(raw?.minSimilarity, DEFAULT_MIN_SIMILARITY, 0, 1),
    cacheActions: raw?.cacheActions === true,
  };
}

export function lookupSemanticCache(params: {
  settings: SemanticCacheSettings | null;
  sessionKey: string;
  provider?: string;
  model?: string;
  prompt: string;
  now?: number;
}): SemanticCacheHit | null {
  const settings = params.settings;
  if (!settings) {
    return null;
  }
  const cacheScope = buildCacheScope(params);
  if (!cacheScope) {
    return null;
  }
  const normalizedPrompt = normalizePrompt(params.prompt);
  if (!normalizedPrompt || normalizedPrompt.length < settings.minPromptChars) {
    return null;
  }
  if (!settings.cacheActions && isLikelyActionPrompt(params.prompt, normalizedPrompt)) {
    return null;
  }

  const now = params.now ?? Date.now();
  const existing = cacheByScope.get(cacheScope) ?? [];
  const pruned = pruneExpiredEntries(existing, now);
  if (pruned.length !== existing.length) {
    cacheByScope.set(cacheScope, pruned);
  }
  if (pruned.length === 0) {
    return null;
  }

  const promptTokens = settings.mode === "semantic" ? tokenize(normalizedPrompt) : [];
  let best: { entry: SemanticCacheEntry; similarity: number } | null = null;
  for (let i = pruned.length - 1; i >= 0; i -= 1) {
    const entry = pruned[i];
    let similarity = 0;
    if (entry.normalizedPrompt === normalizedPrompt) {
      similarity = 1;
    } else if (settings.mode === "semantic") {
      similarity = jaccardSimilarity(promptTokens, entry.promptTokens);
    }
    if (similarity < settings.minSimilarity) {
      continue;
    }
    if (!best || similarity > best.similarity) {
      best = { entry, similarity };
      if (similarity >= 0.999) {
        break;
      }
    }
  }
  if (!best) {
    return null;
  }
  return {
    responseText: best.entry.responseText,
    similarity: best.similarity,
    createdAt: best.entry.createdAt,
  };
}

export function storeSemanticCacheEntry(params: {
  settings: SemanticCacheSettings | null;
  sessionKey: string;
  provider?: string;
  model?: string;
  prompt: string;
  responseText: string;
  now?: number;
}): void {
  const settings = params.settings;
  if (!settings) {
    return;
  }
  const cacheScope = buildCacheScope(params);
  if (!cacheScope) {
    return;
  }
  const normalizedPrompt = normalizePrompt(params.prompt);
  const responseText = params.responseText.trim();
  if (!normalizedPrompt || normalizedPrompt.length < settings.minPromptChars || !responseText) {
    return;
  }
  if (!settings.cacheActions && isLikelyActionPrompt(params.prompt, normalizedPrompt)) {
    return;
  }

  const now = params.now ?? Date.now();
  const expiresAt = now + settings.ttlMs;
  const nextEntry: SemanticCacheEntry = {
    normalizedPrompt,
    promptTokens: settings.mode === "semantic" ? tokenize(normalizedPrompt) : [],
    responseText,
    createdAt: now,
    expiresAt,
  };

  const existing = cacheByScope.get(cacheScope) ?? [];
  const pruned = pruneExpiredEntries(existing, now).filter(
    (entry) => entry.normalizedPrompt !== normalizedPrompt,
  );
  pruned.push(nextEntry);
  if (pruned.length > settings.maxEntries) {
    const extra = pruned.length - settings.maxEntries;
    pruned.splice(0, extra);
  }
  cacheByScope.set(cacheScope, pruned);
}

export function clearSemanticCacheForTests(): void {
  cacheByScope.clear();
}
