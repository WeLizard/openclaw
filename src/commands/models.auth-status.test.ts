import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveAuthProfileStore } from "../agents/auth-profiles.js";
import { clearConfigCache } from "../config/config.js";
import { withEnvAsync } from "../test-utils/env.js";
import { getModelsAuthStatus } from "./models/auth-status.js";

afterEach(() => {
  clearConfigCache();
});

describe("getModelsAuthStatus", () => {
  it("marks inline custom providers as static even without auth-profiles entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-models-auth-status-"));
    try {
      const stateDir = path.join(root, "state");
      const agentDir = path.join(stateDir, "agents", "main", "agent");
      const configPath = path.join(stateDir, "openclaw.json");

      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        configPath,
        `${JSON.stringify(
          {
            models: {
              providers: {
                "qwen-portal": {
                  baseUrl: "https://portal.qwen.ai/v1",
                  api: "openai-completions",
                  apiKey: "qwen-oauth",
                  models: [{ id: "coder-model", name: "Qwen Coder", contextWindow: 1, maxTokens: 1, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false }],
                },
                cliproxy: {
                  baseUrl: "http://192.168.0.52:8317/v1",
                  api: "openai-completions",
                  apiKey: "my-dev-key",
                  models: [{ id: "gpt-5.4", name: "gpt-5.4 (Custom Provider)", contextWindow: 16000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false }],
                },
              },
            },
            agents: {
              defaults: {
                model: {
                  primary: "cliproxy/gpt-5.4",
                },
                models: {
                  "cliproxy/gpt-5.4": { alias: "gpt-5.4" },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            "qwen-portal:default": {
              type: "oauth",
              provider: "qwen-portal",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 86_400_000,
            },
          },
        },
        agentDir,
      );

      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_AGENT_DIR: agentDir,
          PI_CODING_AGENT_DIR: agentDir,
          OPENCLAW_CONFIG_PATH: configPath,
        },
        async () => {
          clearConfigCache();
          const result = getModelsAuthStatus();
          const cliproxy = result.providers.find((entry) => entry.provider === "cliproxy");
          expect(cliproxy).toBeDefined();
          expect(cliproxy?.effective.kind).toBe("models.json");
          expect(cliproxy?.profiles).toHaveLength(0);
          expect(cliproxy?.status).toBe("static");
          expect(cliproxy?.inUse).toBe(true);
        },
      );
    } finally {
      clearConfigCache();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("treats profile-backed api-key providers as ok", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-models-auth-status-"));
    try {
      const stateDir = path.join(root, "state");
      const agentDir = path.join(stateDir, "agents", "main", "agent");
      const configPath = path.join(stateDir, "openclaw.json");

      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        configPath,
        `${JSON.stringify(
          {
            auth: {
              profiles: {
                "cliproxy:default": {
                  provider: "cliproxy",
                  mode: "api_key",
                },
              },
            },
            models: {
              providers: {
                cliproxy: {
                  baseUrl: "http://192.168.0.52:8317/v1",
                  api: "openai-completions",
                  models: [
                    {
                      id: "gpt-5.4",
                      name: "gpt-5.4 (Custom Provider)",
                      contextWindow: 16000,
                      maxTokens: 4096,
                      input: ["text"],
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                      reasoning: false,
                    },
                  ],
                },
              },
            },
            agents: {
              defaults: {
                model: {
                  primary: "cliproxy/gpt-5.4",
                },
                models: {
                  "cliproxy/gpt-5.4": { alias: "gpt-5.4" },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            "cliproxy:default": {
              type: "api_key",
              provider: "cliproxy",
              key: "my-dev-key",
            },
          },
        },
        agentDir,
      );

      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_AGENT_DIR: agentDir,
          PI_CODING_AGENT_DIR: agentDir,
          OPENCLAW_CONFIG_PATH: configPath,
        },
        async () => {
          clearConfigCache();
          const result = getModelsAuthStatus();
          const cliproxy = result.providers.find((entry) => entry.provider === "cliproxy");
          expect(cliproxy).toBeDefined();
          expect(cliproxy?.effective.kind).toBe("profiles");
          expect(cliproxy?.profiles).toHaveLength(1);
          expect(cliproxy?.status).toBe("ok");
          expect(cliproxy?.inUse).toBe(true);
        },
      );
    } finally {
      clearConfigCache();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
