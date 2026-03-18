import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { resolveModelRef } from "../model-utils.ts";
import { pathForTab } from "../navigation.ts";
import { formatSessionTokens } from "../presenter.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

export type SessionsProps = {
  loading: boolean;
  result: SessionsListResult | null;
  error: string | null;
  activeMinutes: string;
  limit: string;
  includeGlobal: boolean;
  includeUnknown: boolean;
  basePath: string;
  searchQuery: string;
  sortColumn: string;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  actionsOpenKey: string | null;
  onSearchChange: (q: string) => void;
  onSortChange: (col: string, dir: "asc" | "desc") => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  onActionsOpenChange: (key: string | null) => void;
  onFiltersChange: (next: {
    activeMinutes: string;
    limit: string;
    includeGlobal: boolean;
    includeUnknown: boolean;
  }) => void;
  onRefresh: () => void;
  onPatch: (
    key: string,
    patch: {
      label?: string | null;
      thinkingLevel?: string | null;
      verboseLevel?: string | null;
      reasoningLevel?: string | null;
      model?: string | null;
    },
  ) => void;
  onDelete: (key: string) => void;
  modelSuggestions?: string[];
};

const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const BINARY_THINK_LEVELS = ["", "off", "on"] as const;
const VERBOSE_LEVELS = ["", "off", "on", "full"] as const;
const REASONING_LEVELS = ["", "off", "on", "stream"] as const;

function renderSuggestionList(id: string, options: string[]) {
  const clean = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
  if (clean.length === 0) {
    return nothing;
  }
  return html`<datalist id=${id}>
    ${clean.map((value) => html`<option value=${value}></option>`)}
  </datalist>`;
}

function normalizeProviderId(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  return normalized;
}

function isBinaryThinkingProvider(provider?: string | null): boolean {
  return normalizeProviderId(provider) === "zai";
}

function resolveThinkLevelOptions(provider?: string | null): readonly string[] {
  return isBinaryThinkingProvider(provider) ? BINARY_THINK_LEVELS : THINK_LEVELS;
}

function withCurrentOption(options: readonly string[], current: string): string[] {
  if (!current) {
    return [...options];
  }
  if (options.includes(current)) {
    return [...options];
  }
  return [...options, current];
}

function resolveThinkLevelDisplay(value: string, isBinary: boolean): string {
  if (!isBinary) {
    return value;
  }
  if (!value || value === "off") {
    return value;
  }
  return "on";
}

function resolveThinkLevelPatchValue(value: string, isBinary: boolean): string | null {
  if (!value) {
    return null;
  }
  if (!isBinary) {
    return value;
  }
  if (value === "on") {
    return "low";
  }
  return value;
}

function resolveVerboseLabel(value: string): string {
  if (!value) {
    return t("common.inherit");
  }
  if (value === "off") {
    return t("sessions.verboseOffExplicit");
  }
  if (value === "on") {
    return t("sessions.verboseOn");
  }
  if (value === "full") {
    return t("sessions.verboseFull");
  }
  return t("sessions.customValue", { value });
}

export function renderSessions(props: SessionsProps) {
  const rows = props.result?.sessions ?? [];
  const defaultModelRef = resolveModelRef(
    props.result?.defaults.modelProvider,
    props.result?.defaults.model,
  );
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("sessions.title")}</div>
          <div class="card-sub">${t("sessions.subtitle")}</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field">
          <span>${t("sessions.filters.activeWithinMinutes")}</span>
          <input
            .value=${props.activeMinutes}
            @input=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: (e.target as HTMLInputElement).value,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field">
          <span>${t("sessions.filters.limit")}</span>
          <input
            .value=${props.limit}
            @input=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: (e.target as HTMLInputElement).value,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>${t("sessions.filters.includeGlobal")}</span>
          <input
            type="checkbox"
            .checked=${props.includeGlobal}
            @change=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: (e.target as HTMLInputElement).checked,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>${t("sessions.filters.includeUnknown")}</span>
          <input
            type="checkbox"
            .checked=${props.includeUnknown}
            @change=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: (e.target as HTMLInputElement).checked,
              })}
          />
        </label>
      </div>

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }

      <div class="muted" style="margin-top: 12px;">
        ${props.result ? t("sessions.storePath", { path: props.result.path }) : ""}
      </div>

      <div class="table" style="margin-top: 16px;">
        <div class="table-head">
          <div>${t("sessions.table.key")}</div>
          <div>${t("sessions.table.label")}</div>
          <div>${t("sessions.table.kind")}</div>
          <div>${t("sessions.table.updated")}</div>
          <div>${t("sessions.table.tokens")}</div>
          <div>${t("sessions.table.model")}</div>
          <div>${t("sessions.table.thinking")}</div>
          <div>${t("sessions.table.verbose")}</div>
          <div>${t("sessions.table.reasoning")}</div>
          <div>${t("sessions.table.actions")}</div>
        </div>
        ${
          rows.length === 0
            ? html`
                <div class="muted">${t("sessions.empty")}</div>
              `
            : rows.map((row) =>
                renderRow(
                  row,
                  props.basePath,
                  props.onPatch,
                  props.onDelete,
                  props.loading,
                  defaultModelRef,
                ),
              )
        }
      </div>
      ${renderSuggestionList("sessions-model-suggestions", props.modelSuggestions ?? [])}
    </section>
  `;
}

function renderRow(
  row: GatewaySessionRow,
  basePath: string,
  onPatch: SessionsProps["onPatch"],
  onDelete: SessionsProps["onDelete"],
  disabled: boolean,
  defaultModelRef: string,
) {
  const updated = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : t("common.na");
  const rawThinking = row.thinkingLevel ?? "";
  const isBinaryThinking = isBinaryThinkingProvider(row.modelProvider);
  const thinking = resolveThinkLevelDisplay(rawThinking, isBinaryThinking);
  const thinkLevels = withCurrentOption(resolveThinkLevelOptions(row.modelProvider), thinking);
  const verbose = row.verboseLevel ?? "";
  const verboseLevels = withCurrentOption(VERBOSE_LEVELS, verbose);
  const reasoning = row.reasoningLevel ?? "";
  const reasoningLevels = withCurrentOption(REASONING_LEVELS, reasoning);
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim().length > 0
      ? row.displayName.trim()
      : null;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const currentModelRef = resolveModelRef(row.modelProvider, row.model);
  const usingDefaultModel =
    !currentModelRef ||
    !defaultModelRef ||
    currentModelRef.toLowerCase() === defaultModelRef.toLowerCase();
  const showDisplayName = Boolean(displayName && displayName !== row.key && displayName !== label);
  const canLink = row.kind !== "global";
  const chatUrl = canLink
    ? `${pathForTab("chat", basePath)}?session=${encodeURIComponent(row.key)}`
    : null;

  return html`
    <div class="table-row">
      <div class="mono session-key-cell">
        ${canLink ? html`<a href=${chatUrl} class="session-link">${row.key}</a>` : row.key}
        ${showDisplayName ? html`<span class="muted session-key-display-name">${displayName}</span>` : nothing}
      </div>
      <div>
        <input
          .value=${row.label ?? ""}
          ?disabled=${disabled}
          placeholder=${t("sessions.optionalPlaceholder")}
          @change=${(e: Event) => {
            const value = (e.target as HTMLInputElement).value.trim();
            onPatch(row.key, { label: value || null });
          }}
        />
      </div>
      <div>${row.kind}</div>
      <div>${updated}</div>
      <div>${formatSessionTokens(row)}</div>
      <div>
        <div class="session-model-control">
          <input
            .value=${currentModelRef}
            list="sessions-model-suggestions"
            ?disabled=${disabled}
            placeholder=${defaultModelRef || t("sessions.modelPlaceholder")}
            title=${currentModelRef || defaultModelRef || t("sessions.gatewayDefault")}
            @change=${(e: Event) => {
              const value = (e.target as HTMLInputElement).value.trim();
              onPatch(row.key, { model: value || null });
            }}
          />
          <button
            class="btn btn--sm"
            ?disabled=${disabled || usingDefaultModel}
            @click=${() => onPatch(row.key, { model: null })}
          >
            ${t("sessions.useDefault")}
          </button>
        </div>
        <div class="muted session-model-meta">
          ${usingDefaultModel
            ? defaultModelRef
              ? t("sessions.defaultModel", { model: defaultModelRef })
              : t("sessions.gatewayDefault")
            : currentModelRef
              ? t("sessions.activeModel", { model: currentModelRef })
              : t("sessions.gatewayDefault")}
        </div>
      </div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            onPatch(row.key, {
              thinkingLevel: resolveThinkLevelPatchValue(value, isBinaryThinking),
            });
          }}
        >
          ${thinkLevels.map(
            (level) =>
              html`<option value=${level} ?selected=${thinking === level}>
                ${level || t("common.inherit")}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            onPatch(row.key, { verboseLevel: value || null });
          }}
        >
          ${verboseLevels.map(
            (level) =>
              html`<option value=${level} ?selected=${verbose === level}>
                ${resolveVerboseLabel(level)}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            onPatch(row.key, { reasoningLevel: value || null });
          }}
        >
          ${reasoningLevels.map(
            (level) =>
              html`<option value=${level} ?selected=${reasoning === level}>
                ${level || t("common.inherit")}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <button class="btn danger" ?disabled=${disabled} @click=${() => onDelete(row.key)}>
          ${t("common.delete")}
        </button>
      </div>
    </div>
  `;
}
