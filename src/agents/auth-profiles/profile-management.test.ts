import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../../test-utils/env.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  deleteAuthProfile,
  ensureAuthProfileStore,
  resolveAuthProfileOrder,
  replaceRuntimeAuthProfileStoreSnapshots,
  saveAuthProfileStore,
  setAuthProfileManualDisabled,
  type AuthProfileStore,
} from "../auth-profiles.js";

function makeOauthProfile(provider: string, access: string, refresh: string) {
  return {
    type: "oauth" as const,
    provider,
    access,
    refresh,
    expires: Date.now() + 60_000,
  };
}

describe("auth profile management", () => {
  const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR", "OPENCLAW_AGENT_DIR", "PI_CODING_AGENT_DIR"]);

  let tmpDir: string;
  let mainAgentDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-profile-management-"));
    mainAgentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(mainAgentDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    process.env.OPENCLAW_AGENT_DIR = mainAgentDir;
    process.env.PI_CODING_AGENT_DIR = mainAgentDir;
  });

  afterEach(async () => {
    clearRuntimeAuthProfileStoreSnapshots();
    envSnapshot.restore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("excludes manually disabled profiles from rotation order", async () => {
    const provider = "qwen-portal";
    const a1 = `${provider}:account1`;
    const a2 = `${provider}:account2`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [a1]: makeOauthProfile(provider, "a1", "r1"),
        [a2]: makeOauthProfile(provider, "a2", "r2"),
      },
      order: { [provider]: [a1, a2] },
    };
    saveAuthProfileStore(store, mainAgentDir);

    const disabledStore = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId: a1,
      disabled: true,
    });

    const order = resolveAuthProfileOrder({
      store: disabledStore ?? store,
      provider,
    });
    expect(order).toEqual([a2]);
  });

  it("restores profile in rotation after manual enable", async () => {
    const provider = "qwen-portal";
    const a1 = `${provider}:account1`;
    const a2 = `${provider}:account2`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [a1]: makeOauthProfile(provider, "a1", "r1"),
        [a2]: makeOauthProfile(provider, "a2", "r2"),
      },
      order: { [provider]: [a1, a2] },
    };
    saveAuthProfileStore(store, mainAgentDir);

    const disabledStore = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId: a1,
      disabled: true,
    });
    const enabledStore = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId: a1,
      disabled: false,
    });

    const order = resolveAuthProfileOrder({
      store: enabledStore ?? disabledStore ?? store,
      provider,
    });
    expect(order).toEqual([a1, a2]);
  });

  it("deletes profile and cleans order/lastGood/usage references", async () => {
    const provider = "qwen-portal";
    const a1 = `${provider}:account1`;
    const a2 = `${provider}:account2`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [a1]: makeOauthProfile(provider, "a1", "r1"),
        [a2]: makeOauthProfile(provider, "a2", "r2"),
      },
      order: { [provider]: [a1, a2] },
      lastGood: { [provider]: a1 },
      usageStats: {
        [a1]: { lastUsed: Date.now(), errorCount: 1 },
      },
    };
    saveAuthProfileStore(store, mainAgentDir);

    const updated = await deleteAuthProfile({
      agentDir: mainAgentDir,
      profileId: a1,
    });

    expect(updated?.profiles[a1]).toBeUndefined();
    expect(updated?.order?.[provider]).toEqual([a2]);
    expect(updated?.lastGood?.[provider]).toBeUndefined();
    expect(updated?.usageStats?.[a1]).toBeUndefined();
  });

  it("returns null when manual disable would be a no-op", async () => {
    const provider = "cliproxy";
    const profileId = `${provider}:default`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "api_key",
          provider,
          key: "cliproxy-key",
        },
      },
    };
    saveAuthProfileStore(store, mainAgentDir);

    const firstDisable = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId,
      disabled: true,
    });
    expect(firstDisable?.usageStats?.[profileId]?.disabledReason).toBe("manual");

    const secondDisable = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId,
      disabled: true,
    });
    expect(secondDisable).toBeNull();
  });

  it("syncs runtime snapshot after manual disable", async () => {
    const provider = "cliproxy";
    const profileId = `${provider}:default`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "api_key",
          provider,
          key: "cliproxy-key",
        },
      },
    };
    saveAuthProfileStore(store, mainAgentDir);
    replaceRuntimeAuthProfileStoreSnapshots([{ agentDir: mainAgentDir, store }]);

    const updated = await setAuthProfileManualDisabled({
      agentDir: mainAgentDir,
      profileId,
      disabled: true,
    });

    expect(updated?.usageStats?.[profileId]?.disabledReason).toBe("manual");
    expect(updated?.usageStats?.[profileId]?.disabledUntil).toBeGreaterThan(Date.now());

    const runtimeStore = ensureAuthProfileStore(mainAgentDir);
    expect(runtimeStore.usageStats?.[profileId]?.disabledReason).toBe("manual");

    const onDisk = JSON.parse(
      await fs.readFile(path.join(mainAgentDir, "auth-profiles.json"), "utf8"),
    ) as AuthProfileStore;
    expect(onDisk.usageStats?.[profileId]?.disabledReason).toBe("manual");
  });

  it("syncs runtime snapshot after profile delete", async () => {
    const provider = "cliproxy";
    const profileId = `${provider}:default`;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "api_key",
          provider,
          key: "cliproxy-key",
        },
      },
      order: { [provider]: [profileId] },
      lastGood: { [provider]: profileId },
      usageStats: {
        [profileId]: {
          disabledReason: "manual",
          disabledUntil: Date.now() + 60_000,
        },
      },
    };
    saveAuthProfileStore(store, mainAgentDir);
    replaceRuntimeAuthProfileStoreSnapshots([{ agentDir: mainAgentDir, store }]);

    const updated = await deleteAuthProfile({
      agentDir: mainAgentDir,
      profileId,
    });

    expect(updated?.profiles[profileId]).toBeUndefined();
    expect(updated?.order?.[provider]).toBeUndefined();
    expect(updated?.lastGood?.[provider]).toBeUndefined();
    expect(updated?.usageStats?.[profileId]).toBeUndefined();

    const runtimeStore = ensureAuthProfileStore(mainAgentDir);
    expect(runtimeStore.profiles[profileId]).toBeUndefined();
    expect(runtimeStore.usageStats?.[profileId]).toBeUndefined();

    const onDisk = JSON.parse(
      await fs.readFile(path.join(mainAgentDir, "auth-profiles.json"), "utf8"),
    ) as AuthProfileStore;
    expect(onDisk.profiles[profileId]).toBeUndefined();
    expect(onDisk.usageStats?.[profileId]).toBeUndefined();
  });
});
