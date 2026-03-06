import { describe, expect, it } from "vitest";
import { collectChannelUiMetadata } from "./config.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { ChannelConfigUiHint } from "../../channels/plugins/types.plugin.js";

function createRegistryWithChannels(
  channels: Array<{
    id: string;
    label?: string;
    blurb?: string;
    schema?: Record<string, unknown>;
    uiHints?: Record<string, ChannelConfigUiHint>;
  }>,
): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [],
    channels: channels.map((channel) => ({
      pluginId: `${channel.id}-plugin`,
      source: `/plugins/${channel.id}`,
      plugin: {
        id: channel.id,
        meta: {
          id: channel.id,
          label: channel.label ?? channel.id,
          selectionLabel: channel.label ?? channel.id,
          docsPath: `/channels/${channel.id}`,
          blurb: channel.blurb ?? `${channel.id} blurb`,
        },
        capabilities: { chatTypes: ["direct"] },
        config: {
          listAccountIds: () => [],
          resolveAccount: () => ({}),
          defaultAccountId: () => "default",
          isConfigured: () => false,
        },
        ...(channel.schema
          ? {
              configSchema: {
                schema: channel.schema,
                ...(channel.uiHints ? { uiHints: channel.uiHints } : {}),
              },
            }
          : {}),
      },
    })),
    providers: [],
    gatewayHandlers: {},
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}

describe("collectChannelUiMetadata", () => {
  it("uses channel schemas from the freshly loaded plugin registry", () => {
    const registry = createRegistryWithChannels([
      {
        id: "nostr",
        label: "Nostr",
        schema: { type: "object", properties: { enabled: { type: "boolean" } } },
        uiHints: { enabled: { label: "Enable Nostr" } },
      },
    ]);

    const result = collectChannelUiMetadata({
      pluginRegistry: registry,
      runtimeChannels: [],
    });

    expect(result).toEqual([
      {
        id: "nostr",
        label: "Nostr",
        description: "nostr blurb",
        configSchema: { type: "object", properties: { enabled: { type: "boolean" } } },
        configUiHints: { enabled: { label: "Enable Nostr" } },
      },
    ]);
  });

  it("merges runtime channel metadata when runtime has the richer schema", () => {
    const registry = createRegistryWithChannels([
      {
        id: "telegram",
        label: "Telegram",
      },
    ]);

    const result = collectChannelUiMetadata({
      pluginRegistry: registry,
      runtimeChannels: [
        {
          id: "telegram",
          meta: { label: "Telegram", blurb: "Telegram runtime blurb" },
          configSchema: {
            schema: { type: "object", properties: { accounts: { type: "object" } } },
            uiHints: { accounts: { label: "Accounts" } },
          },
        },
      ],
    });

    expect(result).toEqual([
      {
        id: "telegram",
        label: "Telegram",
        description: "Telegram runtime blurb",
        configSchema: { type: "object", properties: { accounts: { type: "object" } } },
        configUiHints: { accounts: { label: "Accounts" } },
      },
    ]);
  });
});
