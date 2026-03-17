import { requireActivePluginRegistry } from "../plugins/runtime.js";
import { listChatChannels, normalizeChatChannelId } from "./registry.js";
import type { ChannelCapabilities, ChannelMeta } from "./plugins/types.js";

export type ChannelDock = {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
};

const CHAT_CHANNEL_ORDER = new Map(listChatChannels().map((meta, index) => [meta.id, index]));

function resolveDockOrder(dock: ChannelDock): number {
  const normalizedId = normalizeChatChannelId(dock.id);
  const staticOrder =
    (normalizedId ? CHAT_CHANNEL_ORDER.get(normalizedId) : undefined) ?? Number.MAX_SAFE_INTEGER;
  return dock.meta.order ?? staticOrder;
}

export function listChannelDocks(): ChannelDock[] {
  const registry = requireActivePluginRegistry();
  return registry.channels
    .map(({ plugin }) => ({
      id: String(plugin.id),
      meta: plugin.meta,
      capabilities: plugin.capabilities,
    }))
    .sort((left, right) => resolveDockOrder(left) - resolveDockOrder(right) || left.id.localeCompare(right.id));
}
