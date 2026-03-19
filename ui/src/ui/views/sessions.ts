import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { resolveModelRef } from "../model-utils.ts";
import { pathForTab } from "../navigation.ts";
import { formatSessionTokens } from "../presenter.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

type SortColumn = "key" | "kind" | "updated" | "tokens";

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
  onSortChange: (col: SortColumn, dir: "asc" | "desc") => void;
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
      fastMode?: boolean | null;
      verboseLevel?: string | null;
      reasoningLevel?: string | null;
      model?: string | null;
    },
  ) => void;
  onDelete: (key: string) => void;
  modelSuggestions?: string[];
  onNavigateToChat?: (sessionKey: string) => void;
};

const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const BINARY_THINK_LEVELS = ["", "off", "on"] as const;
const VERBOSE_LEVELS = [
  { value: "", label: "inherit" },
  { value: "off", label: "off (explicit)" },
  { value: "on", label: "on" },
  { value: "full", label: "full" },
] as const;
const FAST_LEVELS = [
  { value: "", label: "inherit" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
] as const;
const REASONING_LEVELS = ["", "off", "on", "stream"] as const;
const PAGE_SIZES = [10, 25, 50, 100] as const;

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

function withCurrentLabeledOption(
  options: readonly { value: string; label: string }[],
  current: string,
): Array<{ value: string; label: string }> {
  if (!current) {
    return [...options];
  }
  if (options.some((option) => option.value === current)) {
    return [...options];
  }
  return [...options, { value: current, label: current }];
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

function normalizeSortColumn(value: string): SortColumn {
  return value === "key" || value === "kind" || value === "tokens" ? value : "updated";
}

function filterRows(rows: GatewaySessionRow[], query: string): GatewaySessionRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return rows;
  }
  return rows.filter((row) => {
    const key = (row.key ?? "").toLowerCase();
    const label = (row.label ?? "").toLowerCase();
    const kind = (row.kind ?? "").toLowerCase();
    const displayName = (row.displayName ?? "").toLowerCase();
    return (
      key.includes(normalized) ||
      label.includes(normalized) ||
      kind.includes(normalized) ||
      displayName.includes(normalized)
    );
  });
}

function sortRows(rows: GatewaySessionRow[], column: SortColumn, dir: "asc" | "desc") {
  const direction = dir === "asc" ? 1 : -1;
  return [...rows].toSorted((a, b) => {
    let diff = 0;
    switch (column) {
      case "key":
        diff = (a.key ?? "").localeCompare(b.key ?? "");
        break;
      case "kind":
        diff = (a.kind ?? "").localeCompare(b.kind ?? "");
        break;
      case "updated":
        diff = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
        break;
      case "tokens":
        diff =
          (a.totalTokens ?? a.inputTokens ?? a.outputTokens ?? 0) -
          (b.totalTokens ?? b.inputTokens ?? b.outputTokens ?? 0);
        break;
    }
    return diff * direction;
  });
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return rows.slice(start, start + pageSize);
}

export function renderSessions(props: SessionsProps) {
  const rows = props.result?.sessions ?? [];
  const defaultModelRef = resolveModelRef(
    props.result?.defaults.modelProvider,
    props.result?.defaults.model,
  );
  const sortColumn = normalizeSortColumn(props.sortColumn);
  const filtered = filterRows(rows, props.searchQuery);
  const sorted = sortRows(filtered, sortColumn, props.sortDir);
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / props.pageSize));
  const page = Math.min(props.page, totalPages - 1);
  const paginated = paginateRows(sorted, page, props.pageSize);

  const sortHeader = (column: SortColumn, label: string) => {
    const isActive = sortColumn === column;
    const nextDir = isActive && props.sortDir === "asc" ? "desc" : "asc";
    return html`
      <th
        data-sortable
        data-sort-dir=${isActive ? props.sortDir : ""}
        @click=${() => props.onSortChange(column, isActive ? nextDir : "desc")}
      >
        ${label}
        <span class="data-table-sort-icon">${icons.arrowUpDown}</span>
      </th>
    `;
  };

  return html`
    ${
      props.actionsOpenKey
        ? html`
            <div
              class="data-table-overlay"
              @click=${() => props.onActionsOpenChange(null)}
              aria-hidden="true"
            ></div>
          `
        : nothing
    }
    <section class="card" style=${props.actionsOpenKey ? "position: relative; z-index: 41;" : ""}>
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

      <div class="data-table-wrapper" style="margin-top: 16px;">
        <div class="data-table-toolbar">
          <div class="data-table-search">
            <input
              type="text"
              placeholder="Filter by key, label, kind…"
              .value=${props.searchQuery}
              @input=${(e: Event) => props.onSearchChange((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="data-table-container">
          <table class="data-table">
            <thead>
              <tr>
                ${sortHeader("key", t("sessions.table.key"))}
                <th>${t("sessions.table.label")}</th>
                ${sortHeader("kind", t("sessions.table.kind"))}
                ${sortHeader("updated", t("sessions.table.updated"))}
                ${sortHeader("tokens", t("sessions.table.tokens"))}
                <th>${t("sessions.table.model")}</th>
                <th>${t("sessions.table.thinking")}</th>
                <th>Fast</th>
                <th>${t("sessions.table.verbose")}</th>
                <th>${t("sessions.table.reasoning")}</th>
                <th style="width: 60px;">${t("sessions.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              ${
                paginated.length === 0
                  ? html`
                      <tr>
                        <td colspan="11" style="text-align: center; padding: 48px 16px; color: var(--muted)">
                          ${t("sessions.empty")}
                        </td>
                      </tr>
                    `
                  : paginated.map((row) =>
                      renderRow(
                        row,
                        props.basePath,
                        props.onPatch,
                        props.onDelete,
                        props.onActionsOpenChange,
                        props.actionsOpenKey,
                        props.loading,
                        defaultModelRef,
                        props.onNavigateToChat,
                      ),
                    )
              }
            </tbody>
          </table>
        </div>

        ${
          totalRows > 0
            ? html`
                <div class="data-table-pagination">
                  <div class="data-table-pagination__info">
                    ${page * props.pageSize + 1}-${Math.min((page + 1) * props.pageSize, totalRows)}
                    of ${totalRows} row${totalRows === 1 ? "" : "s"}
                  </div>
                  <div class="data-table-pagination__controls">
                    <select
                      style="height: 32px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--card);"
                      .value=${String(props.pageSize)}
                      @change=${(e: Event) =>
                        props.onPageSizeChange(Number((e.target as HTMLSelectElement).value))}
                    >
                      ${PAGE_SIZES.map((size) => html`<option value=${size}>${size} per page</option>`)}
                    </select>
                    <button ?disabled=${page <= 0} @click=${() => props.onPageChange(page - 1)}>
                      Previous
                    </button>
                    <button
                      ?disabled=${page >= totalPages - 1}
                      @click=${() => props.onPageChange(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              `
            : nothing
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
  onActionsOpenChange: (key: string | null) => void,
  actionsOpenKey: string | null,
  disabled: boolean,
  defaultModelRef: string,
  onNavigateToChat?: (sessionKey: string) => void,
) {
  const updated = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : t("common.na");
  const rawThinking = row.thinkingLevel ?? "";
  const isBinaryThinking = isBinaryThinkingProvider(row.modelProvider);
  const thinking = resolveThinkLevelDisplay(rawThinking, isBinaryThinking);
  const thinkLevels = withCurrentOption(resolveThinkLevelOptions(row.modelProvider), thinking);
  const fastMode = row.fastMode === true ? "on" : row.fastMode === false ? "off" : "";
  const fastLevels = withCurrentLabeledOption(FAST_LEVELS, fastMode);
  const verbose = row.verboseLevel ?? "";
  const verboseLevels = withCurrentLabeledOption(VERBOSE_LEVELS, verbose);
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
  const isMenuOpen = actionsOpenKey === row.key;
  const badgeClass =
    row.kind === "direct"
      ? "data-table-badge--direct"
      : row.kind === "group"
        ? "data-table-badge--group"
        : row.kind === "global"
          ? "data-table-badge--global"
          : "data-table-badge--unknown";

  return html`
    <tr>
      <td>
        <div class="mono session-key-cell">
          ${
            canLink
              ? html`<a
                  href=${chatUrl}
                  class="session-link"
                  @click=${(e: MouseEvent) => {
                    if (
                      e.defaultPrevented ||
                      e.button !== 0 ||
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey
                    ) {
                      return;
                    }
                    if (onNavigateToChat) {
                      e.preventDefault();
                      onNavigateToChat(row.key);
                    }
                  }}
                >${row.key}</a>`
              : row.key
          }
          ${
            showDisplayName
              ? html`<span class="muted session-key-display-name">${displayName}</span>`
              : nothing
          }
        </div>
      </td>
      <td>
        <input
          .value=${row.label ?? ""}
          ?disabled=${disabled}
          placeholder=${t("sessions.optionalPlaceholder")}
          style="width: 100%; max-width: 140px; padding: 6px 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm);"
          @change=${(e: Event) => {
            const value = (e.target as HTMLInputElement).value.trim();
            onPatch(row.key, { label: value || null });
          }}
        />
      </td>
      <td><span class="data-table-badge ${badgeClass}">${row.kind}</span></td>
      <td>${updated}</td>
      <td>${formatSessionTokens(row)}</td>
      <td>
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
          ${
            usingDefaultModel
              ? defaultModelRef
                ? t("sessions.defaultModel", { model: defaultModelRef })
                : t("sessions.gatewayDefault")
              : currentModelRef
                ? t("sessions.activeModel", { model: currentModelRef })
                : t("sessions.gatewayDefault")
          }
        </div>
      </td>
      <td>
        <select
          ?disabled=${disabled}
          style="padding: 6px 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 90px;"
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
      </td>
      <td>
        <select
          ?disabled=${disabled}
          style="padding: 6px 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 90px;"
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            onPatch(row.key, { fastMode: value === "" ? null : value === "on" });
          }}
        >
          ${fastLevels.map(
            (level) =>
              html`<option value=${level.value} ?selected=${fastMode === level.value}>
                ${level.label}
              </option>`,
          )}
        </select>
      </td>
      <td>
        <select
          ?disabled=${disabled}
          style="padding: 6px 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 90px;"
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            onPatch(row.key, { verboseLevel: value || null });
          }}
        >
          ${verboseLevels.map(
            (level) =>
              html`<option value=${level.value} ?selected=${verbose === level.value}>
                ${resolveVerboseLabel(level.value)}
              </option>`,
          )}
        </select>
      </td>
      <td>
        <select
          ?disabled=${disabled}
          style="padding: 6px 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 90px;"
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
      </td>
      <td>
        <div class="data-table-row-actions">
          <button
            type="button"
            class="data-table-row-actions__trigger"
            aria-label="Open menu"
            @click=${(e: Event) => {
              e.stopPropagation();
              onActionsOpenChange(isMenuOpen ? null : row.key);
            }}
          >
            ${icons.moreHorizontal}
          </button>
          ${
            isMenuOpen
              ? html`
                  <div class="data-table-row-actions__menu">
                    ${
                      canLink
                        ? html`
                            <a
                              href=${chatUrl}
                              style="display: block; padding: 8px 12px; font-size: 13px; text-decoration: none; color: var(--text); border-radius: var(--radius-sm);"
                              @click=${(e: MouseEvent) => {
                                onActionsOpenChange(null);
                                if (
                                  e.defaultPrevented ||
                                  e.button !== 0 ||
                                  e.metaKey ||
                                  e.ctrlKey ||
                                  e.shiftKey ||
                                  e.altKey
                                ) {
                                  return;
                                }
                                if (onNavigateToChat) {
                                  e.preventDefault();
                                  onNavigateToChat(row.key);
                                }
                              }}
                            >
                              Open in Chat
                            </a>
                          `
                        : nothing
                    }
                    <button
                      type="button"
                      class="danger"
                      @click=${() => {
                        onActionsOpenChange(null);
                        onDelete(row.key);
                      }}
                    >
                      ${t("common.delete")}
                    </button>
                  </div>
                `
              : nothing
          }
        </div>
      </td>
    </tr>
  `;
}
