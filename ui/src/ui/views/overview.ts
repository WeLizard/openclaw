import { html, nothing } from "lit";
import { t, i18n, SUPPORTED_LOCALES, type Locale, isSupportedLocale } from "../../i18n/index.ts";
import type { EventLogEntry } from "../app-events.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { icons } from "../icons.ts";
import type { UiSettings } from "../storage.ts";
import type {
  AttentionItem,
  CronJob,
  CronStatus,
  ModelsAuthProfileStatus,
  ModelsAuthProviderStatus,
  ModelsAuthStatusResult,
  SessionsListResult,
  SessionsUsageResult,
  SkillStatusReport,
} from "../types.ts";
import { renderOverviewAttention } from "./overview-attention.ts";
import { renderOverviewCards } from "./overview-cards.ts";
import { renderOverviewEventLog } from "./overview-event-log.ts";
import {
  resolveAuthHintKind,
  shouldShowInsecureContextHint,
  shouldShowPairingHint,
} from "./overview-hints.ts";
import { renderOverviewLogTail } from "./overview-log-tail.ts";

export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  // New dashboard data
  usageResult: SessionsUsageResult | null;
  sessionsResult: SessionsListResult | null;
  skillsReport: SkillStatusReport | null;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  attentionItems: AttentionItem[];
  eventLog: EventLogEntry[];
  overviewLogLines: string[];
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onToggleGatewayTokenVisibility: () => void;
  onToggleGatewayPasswordVisibility: () => void;
  onConnect: () => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  onRefreshLogs: () => void;
  // Model auth account cards
  modelAuthLoading: boolean;
  modelAuthBusyKey: string | null;
  modelAuthError: string | null;
  modelAuthStatus: ModelsAuthStatusResult | null;
  modelAuthDeleteConfirmProfileId: string | null;
  wizardOpen: boolean;
  wizardLoading: boolean;
  wizardBusy: boolean;
  onModelAuthRefresh: () => void;
  onPromoteProfile: (provider: string, profileId: string) => void;
  onClearProviderOrder: (provider: string) => void;
  onClearProfileCooldown: (profileId: string) => void;
  onDisableProfile: (profileId: string) => void;
  onEnableProfile: (profileId: string) => void;
  onRequestDeleteProfile: (profileId: string) => void;
  onCancelDeleteProfile: () => void;
  onDeleteProfile: (profileId: string) => void;
  onStartProviderAuth: (provider?: string) => void;
  onStartWizard: (mode: "local" | "remote") => void;
};

// ── Model auth helpers ──

function resolveAuthStatusChipClass(status: ModelsAuthProviderStatus["status"]) {
  switch (status) {
    case "ok":
      return "chip chip-ok";
    case "expiring":
      return "chip chip-warn";
    case "expired":
    case "missing":
      return "chip chip-danger";
    default:
      return "chip";
  }
}

function formatOrderSource(source: ModelsAuthProviderStatus["orderSource"]) {
  switch (source) {
    case "stored":
      return t("overview.accounts.orderStored");
    case "config":
      return t("overview.accounts.orderConfig");
    default:
      return t("overview.accounts.orderDerived");
  }
}

function formatEffectiveSource(entry: ModelsAuthProviderStatus) {
  const kind = entry.effective.kind;
  if (kind === "profiles") {
    return t("overview.accounts.sourceProfiles");
  }
  if (kind === "env") {
    return t("overview.accounts.sourceEnv");
  }
  if (kind === "models.json") {
    return "models.json";
  }
  return t("overview.accounts.sourceMissing");
}

function renderProviderEmptyState(entry: ModelsAuthProviderStatus) {
  if (entry.effective.kind === "models.json") {
    return html`<div class="callout info" style="margin-top: 14px;">
      ${t("overview.accounts.staticConfig")}
    </div>`;
  }
  if (entry.effective.kind === "env") {
    return html`<div class="callout info" style="margin-top: 14px;">
      ${t("overview.accounts.envConfig")}
    </div>`;
  }
  return html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.noProfiles")}</div>`;
}

function formatProfileType(type: ModelsAuthProfileStatus["type"]) {
  if (type === "oauth") {
    return t("overview.accounts.typeOauth");
  }
  if (type === "token") {
    return t("overview.accounts.typeToken");
  }
  return t("overview.accounts.typeApiKey");
}

function formatProfileState(profile: ModelsAuthProfileStatus) {
  const disabledReason = (() => {
    if (!profile.disabledReason) {
      return "";
    }
    if (profile.disabledReason === "manual") {
      return ` · ${t("overview.accounts.disabledManual")}`;
    }
    return ` · ${profile.disabledReason}`;
  })();
  if (profile.unusableKind === "disabled") {
    const remaining = profile.unusableRemainingMs
      ? profile.disabledReason === "manual"
        ? ""
        : ` · ${formatDurationHuman(profile.unusableRemainingMs)}`
      : "";
    return `${t("overview.accounts.disabled")}${disabledReason}${remaining}`;
  }
  if (profile.unusableKind === "cooldown") {
    const remaining = profile.unusableRemainingMs
      ? ` · ${formatDurationHuman(profile.unusableRemainingMs)}`
      : "";
    return `${t("overview.accounts.cooldown")}${remaining}`;
  }
  if (profile.healthStatus === "expiring" && profile.remainingMs != null) {
    return `${t("overview.accounts.expiring")} · ${formatDurationHuman(profile.remainingMs)}`;
  }
  if (profile.healthStatus === "expired") {
    return t("overview.accounts.expired");
  }
  return t("overview.accounts.available");
}

function renderProfileRow(
  provider: ModelsAuthProviderStatus,
  profile: ModelsAuthProfileStatus,
  props: OverviewProps,
) {
  const isBusy =
    props.modelAuthBusyKey != null &&
    (props.modelAuthBusyKey === `promote:${provider.provider}:${profile.profileId}` ||
      props.modelAuthBusyKey === `clear-cooldown:${profile.profileId}` ||
      props.modelAuthBusyKey === `disable:${profile.profileId}` ||
      props.modelAuthBusyKey === `enable:${profile.profileId}` ||
      props.modelAuthBusyKey === `delete:${profile.profileId}`);
  const isManualDisabled =
    profile.unusableKind === "disabled" && profile.disabledReason === "manual";
  const canDisable = profile.unusableKind === "available" || profile.unusableKind === "cooldown";
  const isDeleteConfirming = props.modelAuthDeleteConfirmProfileId === profile.profileId;
  const makePrimaryDisabled = Boolean(props.modelAuthBusyKey) || profile.isCurrent;
  const makePrimaryTitle = profile.isCurrent
    ? t("overview.accounts.makePrimaryDisabledCurrent")
    : "";
  return html`
    <div
      class="overview-auth-profile ${profile.isCurrent ? "overview-auth-profile--current" : ""} ${profile.unusableKind !== "available" ? "overview-auth-profile--blocked" : ""}"
    >
      <div class="overview-auth-profile__main">
        <div class="overview-auth-profile__title">
          <span>${profile.label}</span>
          <span class="overview-auth-profile__id mono">${profile.profileId}</span>
        </div>
        <div class="chip-row" style="margin-top: 10px;">
          <span class="chip">${formatProfileType(profile.type)}</span>
          ${
            profile.isCurrent
              ? html`<span class="chip chip-ok">${t("overview.accounts.current")}</span>`
              : nothing
          }
          ${
            profile.isLastGood
              ? html`<span class="chip">${t("overview.accounts.lastGood")}</span>`
              : nothing
          }
          <span
            class=${
              profile.unusableKind === "available"
                ? "chip"
                : profile.unusableKind === "cooldown"
                  ? "chip chip-warn"
                  : "chip chip-danger"
            }
            >${formatProfileState(profile)}</span
          >
          <span class="chip"
            >${t("overview.accounts.lastUsed")}: ${
              profile.lastUsed
                ? formatRelativeTimestamp(profile.lastUsed)
                : t("overview.accounts.neverUsed")
            }</span
          >
          ${
            typeof profile.errorCount === "number"
              ? html`<span class="chip">${t("overview.accounts.errors")}: ${profile.errorCount}</span>`
              : nothing
          }
        </div>
      </div>
      <div class="overview-auth-profile__actions">
        <button
          class="btn btn--sm"
          ?disabled=${makePrimaryDisabled}
          title=${makePrimaryTitle}
          @click=${() => props.onPromoteProfile(provider.provider, profile.profileId)}
        >
          ${t("overview.accounts.makePrimary")}
        </button>
        ${
          profile.unusableKind !== "available" && !isManualDisabled
            ? html`<button
              class="btn btn--sm"
              ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
              @click=${() => props.onClearProfileCooldown(profile.profileId)}
            >
              ${t("overview.accounts.clearCooldown")}
            </button>`
            : nothing
        }
        ${
          canDisable
            ? html`<button
              class="btn btn--sm"
              ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
              @click=${() => props.onDisableProfile(profile.profileId)}
            >
              ${t("overview.accounts.disableFromPool")}
            </button>`
            : isManualDisabled
              ? html`<button
                class="btn btn--sm"
                ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
                @click=${() => props.onEnableProfile(profile.profileId)}
              >
                ${t("overview.accounts.enableInPool")}
              </button>`
              : nothing
        }
        ${
          isDeleteConfirming
            ? html`
              <button
                class="btn btn--sm"
                ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
                @click=${() => props.onCancelDeleteProfile()}
              >
                ${t("common.cancel")}
              </button>
              <button
                class="btn btn--sm danger"
                ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
                title=${t("overview.accounts.deleteConfirm", { profileId: profile.profileId })}
                @click=${() => props.onDeleteProfile(profile.profileId)}
              >
                ${t("overview.accounts.deleteProfileConfirm")}
              </button>
            `
            : html`
              <button
                class="btn btn--sm danger"
                ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
                @click=${() => props.onRequestDeleteProfile(profile.profileId)}
              >
                ${t("overview.accounts.deleteProfile")}
              </button>
            `
        }
      </div>
    </div>
  `;
}

function renderProviderRotation(entry: ModelsAuthProviderStatus) {
  if (entry.profiles.length === 0 || entry.currentOrder.length === 0) {
    return nothing;
  }
  const profilesById = new Map(entry.profiles.map((profile) => [profile.profileId, profile]));
  return html`
    <div style="margin-top: 12px;">
      <div class="muted">${t("overview.accounts.rotationOrder")}</div>
      <div class="chip-row" style="margin-top: 8px;">
        ${entry.currentOrder.map((profileId, index) => {
          const profile = profilesById.get(profileId);
          const label = profile?.label || profileId;
          const isActive = entry.activeProfileId === profileId;
          return html`
            <span class=${isActive ? "chip chip-ok" : "chip"}>
              #${index + 1} ${label}
            </span>
          `;
        })}
      </div>
      <div class="muted" style="margin-top: 8px;">${t("overview.accounts.rotationHint")}</div>
    </div>
  `;
}

export function resolveDisplayedProviderStatus(
  entry: ModelsAuthProviderStatus,
): ModelsAuthProviderStatus["status"] {
  if (
    entry.effective.kind === "profiles" &&
    entry.status === "static" &&
    entry.profiles.length > 0
  ) {
    return "ok";
  }
  return entry.status;
}

function renderAuthProviderCard(entry: ModelsAuthProviderStatus, props: OverviewProps) {
  const activeProfile =
    entry.profiles.find((profile) => profile.profileId === entry.activeProfileId) ?? null;
  const displayStatus = resolveDisplayedProviderStatus(entry);
  const authActionLabel =
    entry.effective.kind === "profiles" && entry.profiles.length > 0
      ? t("overview.accounts.addAccount")
      : t("overview.accounts.oauthReauth");
  return html`
    <section class="overview-auth-provider ${entry.inUse ? "overview-auth-provider--in-use" : ""}">
      <div class="overview-auth-provider__header">
        <div>
          <div class="overview-auth-provider__title">
            <span class="mono">${entry.provider}</span>
            ${entry.inUse ? html`<span class="chip chip-ok">${t("overview.accounts.inUse")}</span>` : nothing}
            <span class=${resolveAuthStatusChipClass(displayStatus)}>${t(`overview.accounts.status.${displayStatus}`)}</span>
          </div>
          <div class="overview-auth-provider__meta">
            ${t("overview.accounts.source")}: ${formatEffectiveSource(entry)}
            <span class="muted"> · </span>
            ${t("overview.accounts.order")}: ${formatOrderSource(entry.orderSource)}
          </div>
        </div>
        <div class="overview-auth-provider__actions">
          <button
            class="btn btn--sm"
            ?disabled=${Boolean(props.modelAuthBusyKey) || props.wizardLoading || props.wizardBusy || props.wizardOpen}
            @click=${() => props.onStartProviderAuth(entry.provider)}
          >
            ${authActionLabel}
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${Boolean(props.modelAuthBusyKey) || !entry.hasStoredOrderOverride}
            title=${entry.hasStoredOrderOverride ? "" : t("overview.accounts.resetOrderDisabled")}
            @click=${() => props.onClearProviderOrder(entry.provider)}
          >
            ${t("overview.accounts.resetOrder")}
          </button>
        </div>
      </div>

      <div class="chip-row" style="margin-top: 12px;">
        <span class="chip">${t("overview.accounts.countProfiles")}: ${entry.counts.total}</span>
        <span class="chip">${t("overview.accounts.countAvailable")}: ${entry.counts.available}</span>
        <span class="chip">${t("overview.accounts.countBlocked")}: ${entry.counts.unavailable}</span>
        ${
          activeProfile
            ? html`<span class="chip chip-ok">${t("overview.accounts.activeProfile")}: ${activeProfile.profileId}</span>`
            : nothing
        }
      </div>

      ${renderProviderRotation(entry)}

      ${
        entry.profiles.length === 0
          ? renderProviderEmptyState(entry)
          : html`<div class="overview-auth-profile-list">
            ${entry.profiles.map((profile) => renderProfileRow(entry, profile, props))}
          </div>`
      }
    </section>
  `;
}

function renderAccountsSection(props: OverviewProps) {
  return html`
    <section class="card overview-auth" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="card-title">${t("overview.accounts.title")}</div>
          <div class="card-sub">${t("overview.accounts.subtitle")}</div>
        </div>
        <div class="row" style="gap: 10px; align-items: center;">
          <button
            class="btn btn--sm primary"
            ?disabled=${!props.connected || props.wizardLoading || props.wizardBusy || props.wizardOpen}
            @click=${() => props.onStartProviderAuth()}
          >
            ${t("overview.accounts.addProvider")}
          </button>
          ${
            props.modelAuthStatus
              ? html`<span class="muted mono">${props.modelAuthStatus.authStorePath}</span>`
              : nothing
          }
          <button class="btn btn--sm" ?disabled=${props.modelAuthLoading || Boolean(props.modelAuthBusyKey)} @click=${() => props.onModelAuthRefresh()}>
            ${props.modelAuthLoading ? t("overview.accounts.refreshing") : t("common.refresh")}
          </button>
        </div>
      </div>

      ${
        props.modelAuthError
          ? html`<div class="callout danger" style="margin-top: 14px;">${props.modelAuthError}</div>`
          : nothing
      }

      ${
        props.modelAuthStatus?.missingProvidersInUse?.length
          ? html`<div class="callout danger" style="margin-top: 14px;">
            ${t("overview.accounts.missingProviders", {
              providers: props.modelAuthStatus.missingProvidersInUse.join(", "),
            })}
          </div>`
          : nothing
      }

      <div class="muted" style="margin-top: 12px;">
        ${t("overview.accounts.addProviderHint")}
        <br />
        ${t("overview.accounts.multiAccountHint")}
      </div>

      ${
        !props.modelAuthStatus
          ? html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.empty")}</div>`
          : props.modelAuthStatus.providers.length === 0
            ? html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.noProviders")}</div>`
            : html`<div class="overview-auth-grid">
              ${props.modelAuthStatus.providers.map((entry) => renderAuthProviderCard(entry, props))}
            </div>`
      }
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="card-title">${t("overview.setup.title")}</div>
          <div class="card-sub">${t("overview.setup.subtitle")}</div>
        </div>
        ${
          props.wizardOpen
            ? html`<span class="chip chip-ok">${t("overview.setup.running")}</span>`
            : nothing
        }
      </div>
      <div class="row" style="margin-top: 16px; gap: 10px; flex-wrap: wrap;">
        <button
          class="btn primary"
          ?disabled=${!props.connected || props.wizardLoading || props.wizardBusy || props.wizardOpen}
          @click=${() => props.onStartWizard("local")}
        >
          ${t("overview.setup.local")}
        </button>
        <button
          class="btn"
          ?disabled=${!props.connected || props.wizardLoading || props.wizardBusy || props.wizardOpen}
          @click=${() => props.onStartWizard("remote")}
        >
          ${t("overview.setup.remote")}
        </button>
      </div>
      <div class="muted" style="margin-top: 12px;">
        ${t("overview.setup.hint")}
      </div>
    </section>
  `;
}

// ── Main render ──

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tickIntervalMs = props.hello?.policy?.tickIntervalMs;
  const tick = tickIntervalMs
    ? `${(tickIntervalMs / 1000).toFixed(tickIntervalMs % 1000 === 0 ? 0 : 1)}s`
    : t("common.na");
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";

  const pairingHint = (() => {
    if (!shouldShowPairingHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.pairing.hint")}
        <div style="margin-top: 6px">
          <span class="mono">openclaw devices list</span><br />
          <span class="mono">openclaw devices approve &lt;requestId&gt;</span>
        </div>
        <div style="margin-top: 6px; font-size: 12px;">
          ${t("overview.pairing.mobileHint")}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Device pairing docs (opens in new tab)"
            >Docs: Device pairing</a
          >
        </div>
      </div>
    `;
  })();

  const authHint = (() => {
    const authHintKind = resolveAuthHintKind({
      connected: props.connected,
      lastError: props.lastError,
      lastErrorCode: props.lastErrorCode,
      hasToken: Boolean(props.settings.token.trim()),
      hasPassword: Boolean(props.password.trim()),
    });
    if (authHintKind == null) {
      return null;
    }
    if (authHintKind === "required") {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">openclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "openclaw dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/dashboard"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    if (!shouldShowInsecureContextHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", { config: "gateway.controlUi.allowInsecureAuth: true" })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/gateway/tailscale"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#insecure-http"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  const currentLocale = isSupportedLocale(props.settings.locale)
    ? props.settings.locale
    : i18n.getLocale();

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">${t("overview.access.title")}</div>
        <div class="card-sub">${t("overview.access.subtitle")}</div>
        <div class="ov-access-grid" style="margin-top: 16px;">
          <label class="field ov-access-grid__full">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({
                  ...props.settings,
                  gatewayUrl: v,
                  token: v.trim() === props.settings.gatewayUrl.trim() ? props.settings.token : "",
                });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${
            isTrustedProxy
              ? ""
              : html`
                <label class="field">
                  <span>${t("overview.access.token")}</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input
                      type=${props.showGatewayToken ? "text" : "password"}
                      autocomplete="off"
                      style="flex: 1;"
                      .value=${props.settings.token}
                      @input=${(e: Event) => {
                        const v = (e.target as HTMLInputElement).value;
                        props.onSettingsChange({ ...props.settings, token: v });
                      }}
                      placeholder="OPENCLAW_GATEWAY_TOKEN"
                    />
                    <button
                      type="button"
                      class="btn btn--icon ${props.showGatewayToken ? "active" : ""}"
                      style="width: 36px; height: 36px;"
                      title=${props.showGatewayToken ? "Hide token" : "Show token"}
                      aria-label="Toggle token visibility"
                      aria-pressed=${props.showGatewayToken}
                      @click=${props.onToggleGatewayTokenVisibility}
                    >
                      ${props.showGatewayToken ? icons.eye : icons.eyeOff}
                    </button>
                  </div>
                </label>
                <label class="field">
                  <span>${t("overview.access.password")}</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input
                      type=${props.showGatewayPassword ? "text" : "password"}
                      autocomplete="off"
                      style="flex: 1;"
                      .value=${props.password}
                      @input=${(e: Event) => {
                        const v = (e.target as HTMLInputElement).value;
                        props.onPasswordChange(v);
                      }}
                      placeholder="system or shared password"
                    />
                    <button
                      type="button"
                      class="btn btn--icon ${props.showGatewayPassword ? "active" : ""}"
                      style="width: 36px; height: 36px;"
                      title=${props.showGatewayPassword ? "Hide password" : "Show password"}
                      aria-label="Toggle password visibility"
                      aria-pressed=${props.showGatewayPassword}
                      @click=${props.onToggleGatewayPasswordVisibility}
                    >
                      ${props.showGatewayPassword ? icons.eye : icons.eyeOff}
                    </button>
                  </div>
                </label>
              `
          }
          <label class="field">
            <span>${t("overview.access.sessionKey")}</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
          <label class="field">
            <span>${t("overview.access.language")}</span>
            <select
              .value=${currentLocale}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value as Locale;
                void i18n.setLocale(v);
                props.onSettingsChange({ ...props.settings, locale: v });
              }}
            >
              ${SUPPORTED_LOCALES.map((loc) => {
                const key = loc.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
                return html`<option value=${loc} ?selected=${currentLocale === loc}>
                  ${t(`languages.${key}`)}
                </option>`;
              })}
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
          <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
          <span class="muted">${
            isTrustedProxy ? t("overview.access.trustedProxy") : t("overview.access.connectHint")
          }</span>
        </div>
        ${
          !props.connected
            ? html`
                <div class="login-gate__help" style="margin-top: 16px;">
                  <div class="login-gate__help-title">${t("overview.connection.title")}</div>
                  <ol class="login-gate__steps">
                    <li>${t("overview.connection.step1")}<code>openclaw gateway run</code></li>
                    <li>${t("overview.connection.step2")}<code>openclaw dashboard --no-open</code></li>
                    <li>${t("overview.connection.step3")}</li>
                    <li>${t("overview.connection.step4")}<code>openclaw doctor --generate-gateway-token</code></li>
                  </ol>
                  <div class="login-gate__docs">
                    ${t("overview.connection.docsHint")}
                    <a
                      class="session-link"
                      href="https://docs.openclaw.ai/web/dashboard"
                      target="_blank"
                      rel="noreferrer"
                    >${t("overview.connection.docsLink")}</a>
                  </div>
                </div>
              `
            : nothing
        }
      </div>

      <div class="card">
        <div class="card-title">${t("overview.snapshot.title")}</div>
        <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.status")}</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? t("common.ok") : t("common.offline")}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.uptime")}</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh ? formatRelativeTimestamp(props.lastChannelsRefresh) : t("common.na")}
            </div>
          </div>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${pairingHint ?? ""}
              ${authHint ?? ""}
              ${insecureContextHint ?? ""}
            </div>`
            : html`
                <div class="callout" style="margin-top: 14px">
                  ${t("overview.snapshot.channelsHint")}
                </div>
              `
        }
      </div>
    </section>

    <div class="ov-section-divider"></div>

    ${renderOverviewCards({
      usageResult: props.usageResult,
      sessionsResult: props.sessionsResult,
      skillsReport: props.skillsReport,
      cronJobs: props.cronJobs,
      cronStatus: props.cronStatus,
      presenceCount: props.presenceCount,
      onNavigate: props.onNavigate,
    })}

    ${renderOverviewAttention({ items: props.attentionItems })}

    ${renderAccountsSection(props)}

    <div class="ov-section-divider"></div>

    <div class="ov-bottom-grid" style="margin-top: 18px;">
      ${renderOverviewEventLog({
        events: props.eventLog,
      })}

      ${renderOverviewLogTail({
        lines: props.overviewLogLines,
        onRefreshLogs: props.onRefreshLogs,
      })}
    </div>

  `;
}
