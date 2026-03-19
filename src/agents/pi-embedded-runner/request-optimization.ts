import type { OpenClawConfig } from "../../config/config.js";
import { DEFAULT_PROVIDER } from "../defaults.js";
import { parseModelRef } from "../model-selection.js";

type CascadeSettings = {
  mode: "off" | "auto";
  cheapModel?: string;
  simplePromptChars: number;
  complexPromptChars: number;
  simpleScoreThreshold: number;
};

type PlannerSettings = {
  mode: "off" | "auto" | "always";
  batching: boolean;
  decomposition: boolean;
  decomposeScoreThreshold: number;
  maxSubtasks: number;
};

type InputStructuringSettings = {
  enabled: boolean;
  collapseWhitespace: boolean;
  dedupeLines: boolean;
  maxConsecutiveBlankLines: number;
  minDuplicateLineChars: number;
  parseStateLines: boolean;
  minStateLines: number;
};

export type RequestOptimizationSettings = {
  cascade: CascadeSettings;
  planner: PlannerSettings;
  inputStructuring: InputStructuringSettings;
};

export type RequestRouteDecision = {
  tier: 3 | 4;
  provider: string;
  model: string;
  reason: string;
};

export type RequestOptimizationResult = {
  prompt: string;
  route: RequestRouteDecision;
  complexityScore: number;
  notes: string[];
};

const STATE_LINE_RE = /^\s*([a-z_][a-z0-9_]*\.[a-zA-Z0-9_:-]+)\s*[:=]\s*(.+?)\s*$/;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resolveRequestOptimizationSettings(config?: OpenClawConfig): RequestOptimizationSettings {
  const raw = config?.agents?.defaults?.tokenOptimization;
  const cascadeRaw = raw?.cascade;
  const plannerRaw = raw?.planner;
  const inputRaw = raw?.inputStructuring;
  const inputStructuringConfigured = inputRaw !== undefined;

  const cascadeMode = cascadeRaw?.mode === "auto" ? "auto" : "off";
  const plannerMode =
    plannerRaw?.mode === "auto" || plannerRaw?.mode === "always" ? plannerRaw.mode : "off";

  const simplePromptChars = clampInt(asPositiveInt(cascadeRaw?.simplePromptChars) ?? 220, 40, 4000);
  const complexPromptChars = clampInt(
    asPositiveInt(cascadeRaw?.complexPromptChars) ?? 900,
    simplePromptChars + 1,
    12000,
  );
  const simpleScoreThreshold = clampNumber(
    asFiniteNumber(cascadeRaw?.simpleScoreThreshold) ?? 2.5,
    0,
    20,
  );
  const decomposeScoreThreshold = clampNumber(
    asFiniteNumber(plannerRaw?.decomposeScoreThreshold) ?? 4.0,
    0,
    20,
  );
  const maxSubtasks = clampInt(asPositiveInt(plannerRaw?.maxSubtasks) ?? 8, 1, 20);

  return {
    cascade: {
      mode: cascadeMode,
      cheapModel: asString(cascadeRaw?.cheapModel),
      simplePromptChars,
      complexPromptChars,
      simpleScoreThreshold,
    },
    planner: {
      mode: plannerMode,
      batching: plannerRaw?.batching ?? true,
      decomposition: plannerRaw?.decomposition ?? true,
      decomposeScoreThreshold,
      maxSubtasks,
    },
    inputStructuring: {
      enabled: inputRaw?.enabled ?? inputStructuringConfigured,
      collapseWhitespace: inputRaw?.collapseWhitespace ?? true,
      dedupeLines: inputRaw?.dedupeLines ?? true,
      maxConsecutiveBlankLines: clampInt(
        asPositiveInt(inputRaw?.maxConsecutiveBlankLines) ?? 1,
        1,
        10,
      ),
      minDuplicateLineChars: clampInt(asPositiveInt(inputRaw?.minDuplicateLineChars) ?? 24, 1, 500),
      parseStateLines: inputRaw?.parseStateLines ?? true,
      minStateLines: clampInt(asPositiveInt(inputRaw?.minStateLines) ?? 5, 1, 500),
    },
  };
}

function collapseWhitespaceBlocks(prompt: string, maxConsecutiveBlankLines: number): string {
  const normalized = prompt.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    const trimmedEnd = line.replace(/[ \t]+$/g, "");
    const isBlank = trimmedEnd.trim().length === 0;
    if (isBlank) {
      blankRun += 1;
      if (blankRun <= maxConsecutiveBlankLines) {
        out.push("");
      }
      continue;
    }
    blankRun = 0;
    out.push(trimmedEnd.replace(/[ \t]{2,}/g, " "));
  }
  return out.join("\n").trim();
}

function dedupeConsecutiveLines(prompt: string, minDuplicateLineChars: number): string {
  const lines = prompt.split("\n");
  if (lines.length < 2) {
    return prompt;
  }
  const out: string[] = [];
  let previousKey = "";
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    const canDedupe = normalized.length >= minDuplicateLineChars;
    if (canDedupe && normalized === previousKey) {
      continue;
    }
    out.push(line);
    previousKey = canDedupe ? normalized : "";
  }
  return out.join("\n").trim();
}

function packStateLines(prompt: string, minStateLines: number): { prompt: string; packed: number } {
  const lines = prompt.split("\n");
  const stateEntries: Array<{ entity: string; value: string }> = [];
  const nonStateLines: string[] = [];

  for (const line of lines) {
    const match = line.match(STATE_LINE_RE);
    if (!match) {
      nonStateLines.push(line);
      continue;
    }
    const entity = match[1].trim();
    const value = match[2].replace(/\s+/g, " ").trim();
    if (!entity || !value) {
      nonStateLines.push(line);
      continue;
    }
    stateEntries.push({ entity, value });
  }

  const nonEmptyLineCount = lines.filter((line) => line.trim().length > 0).length;
  const denseStateDump =
    stateEntries.length >= minStateLines &&
    nonEmptyLineCount > 0 &&
    stateEntries.length / nonEmptyLineCount >= 0.6;
  if (!denseStateDump) {
    return { prompt, packed: 0 };
  }

  const parts: string[] = [];
  const textPart = nonStateLines.join("\n").trim();
  if (textPart) {
    parts.push(textPart);
  }
  parts.push(`[ha_state_snapshot]\n${JSON.stringify(stateEntries)}\n[/ha_state_snapshot]`);
  return {
    prompt: parts.join("\n\n").trim(),
    packed: stateEntries.length,
  };
}

function scorePromptComplexity(prompt: string): number {
  const normalized = prompt.trim();
  if (!normalized) {
    return 0;
  }
  const lower = normalized.toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const connectorMatches = lower.match(
    /\b(and|then|also|after|before|next|plus)\b|(?:^|\s)(и|затем|потом|после|далее|также)(?=\s|$)/g,
  ) ?? [];
  const hasCode = normalized.includes("```") || /[{[\]}]/.test(normalized);
  const hasPlanSignal =
    /\b(plan|strategy|workflow|step-by-step)\b/i.test(normalized) ||
    /(план|стратег|пошаг|сценар)/i.test(normalized);
  const questionCount = (normalized.match(/\?/g) ?? []).length;

  let score = 0;
  if (wordCount > 18) score += 1;
  if (wordCount > 50) score += 1.5;
  if (wordCount > 100) score += 2;
  score += Math.min(4, connectorMatches.length * 0.8);
  if (hasCode) score += 1.5;
  if (hasPlanSignal) score += 1.5;
  if (questionCount >= 2) score += 0.8;
  return score;
}

function hasBatchSignal(prompt: string): boolean {
  return (
    /\b(and|then|also|plus)\b/i.test(prompt) ||
    /(?:^|\s)(и|затем|потом|также)(?=\s|$)/i.test(prompt)
  );
}

function hasComplexGoalSignal(prompt: string): boolean {
  return (
    /\b(plan|strategy|workflow|optimi)\b/i.test(prompt) ||
    /(план|стратег|оптимиз|улучш|энергоэффектив)/i.test(prompt)
  );
}

function injectPlannerHints(
  prompt: string,
  settings: PlannerSettings,
  complexityScore: number,
): { prompt: string; injected: boolean } {
  if (settings.mode === "off") {
    return { prompt, injected: false };
  }

  const hints: string[] = [];
  const autoMode = settings.mode === "auto";
  const wantsBatch = settings.batching && (!autoMode || hasBatchSignal(prompt));
  const wantsDecompose =
    settings.decomposition &&
    (!autoMode ||
      complexityScore >= settings.decomposeScoreThreshold ||
      hasComplexGoalSignal(prompt));

  if (wantsBatch) {
    hints.push("Batch related actions into a single execution plan when possible.");
  }
  if (wantsDecompose) {
    hints.push(
      `For complex goals, generate up to ${settings.maxSubtasks} concrete subtasks first, then execute with minimal tool round-trips.`,
    );
  }
  if (hints.length === 0) {
    return { prompt, injected: false };
  }

  return {
    prompt: `[openclaw_planner]\n${hints.join(" ")}\n[/openclaw_planner]\n\n${prompt}`.trim(),
    injected: true,
  };
}

function resolveRouteDecision(params: {
  provider: string;
  model: string;
  prompt: string;
  complexityScore: number;
  settings: CascadeSettings;
  plannerNeedsDecomposition: boolean;
}): RequestRouteDecision {
  const base: RequestRouteDecision = {
    tier: 4,
    provider: params.provider,
    model: params.model,
    reason: "tier4-default",
  };
  if (params.settings.mode !== "auto") {
    return base;
  }

  const cheapModel = asString(params.settings.cheapModel);
  if (!cheapModel) {
    return base;
  }
  const parsed = parseModelRef(cheapModel, params.provider);
  if (!parsed) {
    return base;
  }

  const candidateSimple =
    params.prompt.length <= params.settings.simplePromptChars &&
    params.complexityScore <= params.settings.simpleScoreThreshold &&
    !params.plannerNeedsDecomposition;
  const forcedComplex = params.prompt.length >= params.settings.complexPromptChars;

  if (candidateSimple && !forcedComplex) {
    return {
      tier: 3,
      provider: parsed.provider,
      model: parsed.model,
      reason: "tier3-cheap-model-simple-request",
    };
  }
  return base;
}

export function resolveRequestOptimization(params: {
  prompt: string;
  provider: string;
  model: string;
  config?: OpenClawConfig;
}): RequestOptimizationResult {
  const settings = resolveRequestOptimizationSettings(params.config);
  const baselineRoute: RequestRouteDecision = {
    tier: 4,
    provider: params.provider || DEFAULT_PROVIDER,
    model: params.model,
    reason: "tier4-default",
  };
  if (
    settings.cascade.mode === "off" &&
    settings.planner.mode === "off" &&
    !settings.inputStructuring.enabled
  ) {
    return {
      prompt: params.prompt,
      route: baselineRoute,
      complexityScore: scorePromptComplexity(params.prompt),
      notes: [],
    };
  }
  const notes: string[] = [];
  let optimizedPrompt = params.prompt.trim();

  if (settings.inputStructuring.enabled) {
    if (settings.inputStructuring.collapseWhitespace) {
      const next = collapseWhitespaceBlocks(
        optimizedPrompt,
        settings.inputStructuring.maxConsecutiveBlankLines,
      );
      if (next !== optimizedPrompt) {
        optimizedPrompt = next;
        notes.push("input-structuring:collapsed-whitespace");
      }
    }
    if (settings.inputStructuring.dedupeLines) {
      const next = dedupeConsecutiveLines(
        optimizedPrompt,
        settings.inputStructuring.minDuplicateLineChars,
      );
      if (next !== optimizedPrompt) {
        optimizedPrompt = next;
        notes.push("input-structuring:deduped-lines");
      }
    }
    if (settings.inputStructuring.parseStateLines) {
      const packed = packStateLines(optimizedPrompt, settings.inputStructuring.minStateLines);
      if (packed.prompt !== optimizedPrompt) {
        optimizedPrompt = packed.prompt;
        notes.push(`input-structuring:packed-state-lines(${packed.packed})`);
      }
    }
  }

  const complexityScore = scorePromptComplexity(optimizedPrompt);
  const plannerNeedsDecomposition =
    settings.planner.mode !== "off" &&
    settings.planner.decomposition &&
    (settings.planner.mode === "always" ||
      complexityScore >= settings.planner.decomposeScoreThreshold ||
      hasComplexGoalSignal(optimizedPrompt));

  const plannerResult = injectPlannerHints(optimizedPrompt, settings.planner, complexityScore);
  if (plannerResult.injected) {
    optimizedPrompt = plannerResult.prompt;
    notes.push("planner:hints-injected");
  }

  const route = resolveRouteDecision({
    provider: params.provider || DEFAULT_PROVIDER,
    model: params.model,
    prompt: optimizedPrompt,
    complexityScore,
    settings: settings.cascade,
    plannerNeedsDecomposition,
  });
  if (route.tier === 3) {
    notes.push(`cascade:${route.reason}`);
  }

  return {
    prompt: optimizedPrompt,
    route,
    complexityScore,
    notes,
  };
}
