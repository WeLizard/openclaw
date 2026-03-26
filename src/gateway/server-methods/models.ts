import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import {
  clearAuthProfileCooldown,
  deleteAuthProfile,
  ensureAuthProfileStore,
  resolveAuthProfileOrder,
  setAuthProfileManualDisabled,
  setAuthProfileOrder,
} from "../../agents/auth-profiles.js";
import { buildAllowedModelSet, normalizeProviderId } from "../../agents/model-selection.js";
import { getModelsAuthStatus } from "../../commands/models/auth-status.js";
import { loadConfig, readConfigFileSnapshotForWrite, writeConfigFile } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsAuthCooldownClearParams,
  validateModelsAuthProfileDeleteParams,
  validateModelsAuthProfileDisableParams,
  validateModelsAuthProfileEnableParams,
  validateModelsAuthOrderClearParams,
  validateModelsAuthOrderMoveParams,
  validateModelsAuthPromoteParams,
  validateModelsAuthStatusParams,
  validateModelsListParams,
  validateModelsProviderRemoveParams,
  validateModelsProviderDisableParams,
  validateModelsProviderEnableParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.status": ({ params, respond }) => {
    if (!validateModelsAuthStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.status params: ${formatValidationErrors(validateModelsAuthStatusParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
      respond(true, getModelsAuthStatus(agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.promote": async ({ params, respond }) => {
    if (!validateModelsAuthPromoteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.promote params: ${formatValidationErrors(validateModelsAuthPromoteParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const provider = normalizeProviderId(String(params.provider ?? "").trim());
      const profileId = String(params.profileId ?? "").trim();
      const entry = status.providers.find((item) => item.provider === provider);
      if (!entry) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      if (!entry.profiles.some((profile) => profile.profileId === profileId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `profile "${profileId}" is not available for provider "${provider}"`,
          ),
        );
        return;
      }
      const currentOrder = entry.currentOrder.length
        ? entry.currentOrder
        : resolveAuthProfileOrder({
            store: ensureAuthProfileStore(status.agentDir, { allowKeychainPrompt: false }),
            provider,
          });
      const knownProfileIds = [
        ...currentOrder,
        ...entry.profiles
          .map((profile) => profile.profileId)
          .filter((id) => !currentOrder.includes(id)),
      ];
      const nextOrder = [profileId, ...knownProfileIds.filter((id) => id !== profileId)];
      const updated = await setAuthProfileOrder({
        agentDir: status.agentDir,
        provider,
        order: nextOrder,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-profiles.json (lock busy?)."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.order.clear": async ({ params, respond }) => {
    if (!validateModelsAuthOrderClearParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.order.clear params: ${formatValidationErrors(validateModelsAuthOrderClearParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const provider = normalizeProviderId(String(params.provider ?? "").trim());
      const updated = await setAuthProfileOrder({
        agentDir: status.agentDir,
        provider,
        order: null,
      });
      if (
        !updated &&
        !status.providers.some((entry) => entry.provider === provider && entry.hasStoredOrderOverride)
      ) {
        respond(true, status, undefined);
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.order.move": async ({ params, respond }) => {
    if (!validateModelsAuthOrderMoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.order.move params: ${formatValidationErrors(validateModelsAuthOrderMoveParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const provider = normalizeProviderId(String(params.provider ?? "").trim());
      const profileId = String(params.profileId ?? "").trim();
      const direction = params.direction === "down" ? "down" : "up";
      const entry = status.providers.find((item) => item.provider === provider);
      if (!entry) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      if (!entry.profiles.some((profile) => profile.profileId === profileId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `profile "${profileId}" is not available for provider "${provider}"`,
          ),
        );
        return;
      }
      const currentOrder = entry.currentOrder.length
        ? entry.currentOrder
        : resolveAuthProfileOrder({
            store: ensureAuthProfileStore(status.agentDir, { allowKeychainPrompt: false }),
            provider,
          });
      const knownProfileIds = [
        ...currentOrder,
        ...entry.profiles
          .map((profile) => profile.profileId)
          .filter((id) => !currentOrder.includes(id)),
      ];
      const currentIndex = knownProfileIds.indexOf(profileId);
      if (currentIndex < 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `profile "${profileId}" is not available for provider "${provider}"`,
          ),
        );
        return;
      }
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= knownProfileIds.length) {
        respond(true, status, undefined);
        return;
      }
      const nextOrder = [...knownProfileIds];
      [nextOrder[currentIndex], nextOrder[targetIndex]] = [
        nextOrder[targetIndex]!,
        nextOrder[currentIndex]!,
      ];
      const updated = await setAuthProfileOrder({
        agentDir: status.agentDir,
        provider,
        order: nextOrder,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-profiles.json (lock busy?)."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.cooldown.clear": async ({ params, respond }) => {
    if (!validateModelsAuthCooldownClearParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.cooldown.clear params: ${formatValidationErrors(validateModelsAuthCooldownClearParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      const store = ensureAuthProfileStore(status.agentDir, { allowKeychainPrompt: false });
      if (!store.profiles[profileId]) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      await clearAuthProfileCooldown({
        store,
        profileId,
        agentDir: status.agentDir,
      });
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.disable": async ({ params, respond }) => {
    if (!validateModelsAuthProfileDisableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.disable params: ${formatValidationErrors(validateModelsAuthProfileDisableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await setAuthProfileManualDisabled({
        agentDir: status.agentDir,
        profileId,
        disabled: true,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to disable auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.enable": async ({ params, respond }) => {
    if (!validateModelsAuthProfileEnableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.enable params: ${formatValidationErrors(validateModelsAuthProfileEnableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await setAuthProfileManualDisabled({
        agentDir: status.agentDir,
        profileId,
        disabled: false,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to enable auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.delete": async ({ params, respond }) => {
    if (!validateModelsAuthProfileDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.delete params: ${formatValidationErrors(validateModelsAuthProfileDeleteParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await deleteAuthProfile({
        agentDir: status.agentDir,
        profileId,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to delete auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.provider.remove": async ({ params, respond }) => {
    if (!validateModelsProviderRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.provider.remove params: ${formatValidationErrors(validateModelsProviderRemoveParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const provider = String(params.provider ?? "").trim();
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const cfg = snapshot.config;
      if (!cfg.models?.providers?.[provider]) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      // Remove the provider entry.
      const nextProviders = { ...cfg.models.providers };
      delete nextProviders[provider];

      // Remove any fallback entries referencing this provider from agent defaults.
      const providerPrefix = `${provider}/`;
      const agentDefaults = cfg.agents?.defaults;
      const patchModelList = (list: string[] | undefined): string[] | undefined => {
        if (!list) return list;
        const filtered = list.filter((entry) => !entry.startsWith(providerPrefix));
        return filtered.length !== list.length ? filtered : list;
      };
      const nextAgentDefaults = agentDefaults
        ? {
            ...agentDefaults,
            model:
              agentDefaults.model && typeof agentDefaults.model === "object"
                ? {
                    ...agentDefaults.model,
                    fallbacks: patchModelList(
                      (agentDefaults.model as { fallbacks?: string[] }).fallbacks,
                    ),
                  }
                : agentDefaults.model,
            imageModel:
              agentDefaults.imageModel && typeof agentDefaults.imageModel === "object"
                ? {
                    ...agentDefaults.imageModel,
                    fallbacks: patchModelList(
                      (agentDefaults.imageModel as { fallbacks?: string[] }).fallbacks,
                    ),
                  }
                : agentDefaults.imageModel,
            // Remove per-model catalog entries that belong to this provider.
            models: agentDefaults.models
              ? Object.fromEntries(
                  Object.entries(agentDefaults.models).filter(
                    ([key]) => !key.startsWith(providerPrefix),
                  ),
                )
              : agentDefaults.models,
          }
        : agentDefaults;

      // Remove auth profile config entries for this provider.
      const nextAuthProfiles = cfg.auth?.profiles
        ? Object.fromEntries(
            Object.entries(cfg.auth.profiles).filter(
              ([, profileCfg]) => profileCfg.provider !== provider,
            ),
          )
        : cfg.auth?.profiles;

      const nextCfg = {
        ...cfg,
        models: {
          ...cfg.models,
          providers: nextProviders,
        },
        agents: cfg.agents
          ? {
              ...cfg.agents,
              defaults: nextAgentDefaults,
            }
          : cfg.agents,
        auth: cfg.auth
          ? {
              ...cfg.auth,
              profiles: nextAuthProfiles,
            }
          : cfg.auth,
      };

      await writeConfigFile(nextCfg, writeOptions);

      // Also delete all auth profiles for this provider from auth-profiles.json.
      const status = getModelsAuthStatus(undefined);
      const providerEntry = status.providers.find((entry) => entry.provider === provider);
      if (providerEntry) {
        for (const profile of providerEntry.profiles) {
          await deleteAuthProfile({
            agentDir: status.agentDir,
            profileId: profile.profileId,
          });
        }
      }

      respond(true, { ok: true, provider }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.provider.disable": async ({ params, respond }) => {
    if (!validateModelsProviderDisableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.provider.disable params: ${formatValidationErrors(validateModelsProviderDisableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const provider = String(params.provider ?? "").trim();
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const cfg = snapshot.config;
      if (!cfg.models?.providers?.[provider]) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      const nextCfg = {
        ...cfg,
        models: {
          ...cfg.models,
          providers: {
            ...cfg.models.providers,
            [provider]: {
              ...cfg.models.providers[provider],
              disabled: true,
            },
          },
        },
      };
      await writeConfigFile(nextCfg, writeOptions);
      respond(true, getModelsAuthStatus(undefined), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.provider.enable": async ({ params, respond }) => {
    if (!validateModelsProviderEnableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.provider.enable params: ${formatValidationErrors(validateModelsProviderEnableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const provider = String(params.provider ?? "").trim();
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const cfg = snapshot.config;
      if (!cfg.models?.providers?.[provider]) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      const nextProvider = { ...cfg.models.providers[provider] };
      // Remove the disabled flag entirely when enabling.
      delete nextProvider.disabled;
      const nextCfg = {
        ...cfg,
        models: {
          ...cfg.models,
          providers: {
            ...cfg.models.providers,
            [provider]: nextProvider,
          },
        },
      };
      await writeConfigFile(nextCfg, writeOptions);
      respond(true, getModelsAuthStatus(undefined), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
