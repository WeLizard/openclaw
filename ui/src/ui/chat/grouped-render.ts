import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import type { AssistantIdentity } from "../assistant-identity.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { MessageGroup, ToolCard } from "../types/chat-types.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

export function renderReadingIndicatorGroup(assistant?: AssistantIdentity) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? t("chat.assistant");

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false },
          onOpenSidebar,
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${name}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? t("chat.assistant");
  const who =
    normalizedRole === "user"
      ? t("chat.you")
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole === "tool"
          ? t("chat.tool")
          : normalizedRole === "system"
            ? t("chat.system")
            : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return html`
    <div class="chat-group ${roleClass}">
      ${renderAvatar(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
            },
            opts.onOpenSidebar,
          ),
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

function renderAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || t("chat.assistant");
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/")
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  const openImage = (url: string) => {
    openExternalUrlSafe(url, { allowDataImage: true });
  };

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? t("chat.attachedImage")}
            class="chat-message-image"
            @click=${() => openImage(img.url)}
          />
        `,
      )}
    </div>
  `;
}

/** Render tool cards inside a collapsed `<details>` element. */
function renderCollapsedToolCards(
  toolCards: ToolCard[],
  onOpenSidebar?: (content: string) => void,
) {
  const calls = toolCards.filter((card) => card.kind === "call");
  const results = toolCards.filter((card) => card.kind === "result");
  const totalTools = Math.max(calls.length, results.length) || toolCards.length;
  const toolNames = [...new Set(toolCards.map((card) => card.name))];
  const summaryLabel =
    toolNames.length <= 3
      ? toolNames.join(", ")
      : `${toolNames.slice(0, 2).join(", ")} +${toolNames.length - 2} more`;

  return html`
    <details class="chat-tools-collapse">
      <summary class="chat-tools-summary">
        <span class="chat-tools-summary__icon">${icons.zap}</span>
        <span class="chat-tools-summary__count">${totalTools} tool${totalTools === 1 ? "" : "s"}</span>
        <span class="chat-tools-summary__names">${summaryLabel}</span>
      </summary>
      <div class="chat-tools-collapse__body">
        ${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar))}
      </div>
    </details>
  `;
}

const MAX_JSON_AUTOPARSE_CHARS = 20_000;

function detectJson(text: string): { parsed: unknown; pretty: string } | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_JSON_AUTOPARSE_CHARS) {
    return null;
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return { parsed, pretty: JSON.stringify(parsed, null, 2) };
    } catch {
      return null;
    }
  }

  return null;
}

function jsonSummaryLabel(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return `Array (${parsed.length} item${parsed.length === 1 ? "" : "s"})`;
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length <= 4) {
      return `{ ${keys.join(", ")} }`;
    }
    return `Object (${keys.length} keys)`;
  }
  return "JSON";
}

function renderExpandButton(markdown: string, onOpenSidebar: (content: string) => void) {
  return html`
    <button
      class="chat-expand-btn"
      type="button"
      title="Open in canvas"
      aria-label="Open in canvas"
      @click=${() => onOpenSidebar(markdown)}
    >
      <span class="chat-expand-btn__icon" aria-hidden="true">${icons.panelRightOpen}</span>
    </button>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: { isStreaming: boolean; showReasoning: boolean },
  onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const normalizedRole = normalizeRoleForGrouping(role);
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;

  const extractedText = extractTextCached(message);
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());
  const canExpand = role === "assistant" && Boolean(onOpenSidebar && markdown?.trim());
  const jsonResult = markdown && !opts.isStreaming ? detectJson(markdown) : null;

  const bubbleClasses = [
    "chat-bubble",
    canCopyMarkdown || canExpand ? "has-copy" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  if (!markdown && hasToolCards && isToolResult) {
    return renderCollapsedToolCards(toolCards, onOpenSidebar);
  }

  if (!markdown && !hasToolCards && !hasImages) {
    return nothing;
  }

  const isToolMessage = normalizedRole === "tool" || isToolResult;
  const toolNames = [...new Set(toolCards.map((card) => card.name))];
  const toolSummaryLabel =
    toolNames.length <= 3
      ? toolNames.join(", ")
      : `${toolNames.slice(0, 2).join(", ")} +${toolNames.length - 2} more`;
  const toolPreview =
    markdown && !toolSummaryLabel ? markdown.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  const hasActions = canCopyMarkdown || canExpand;

  const renderMessageBody = () => html`
    ${renderMessageImages(images)}
    ${
      reasoningMarkdown
        ? html`<div class="chat-thinking">${unsafeHTML(
            toSanitizedMarkdownHtml(reasoningMarkdown),
          )}</div>`
        : nothing
    }
    ${
      jsonResult
        ? html`<details class="chat-json-collapse">
            <summary class="chat-json-summary">
              <span class="chat-json-badge">JSON</span>
              <span class="chat-json-label">${jsonSummaryLabel(jsonResult.parsed)}</span>
            </summary>
            <pre class="chat-json-content"><code>${jsonResult.pretty}</code></pre>
          </details>`
        : markdown
          ? html`<div class="chat-text" dir="${detectTextDirection(markdown)}">${unsafeHTML(
              toSanitizedMarkdownHtml(markdown),
            )}</div>`
          : nothing
    }
    ${hasToolCards ? renderCollapsedToolCards(toolCards, onOpenSidebar) : nothing}
  `;

  return html`
    <div class="${bubbleClasses}">
      ${
        hasActions
          ? html`<div class="chat-bubble-actions">
              ${canExpand ? renderExpandButton(markdown!, onOpenSidebar!) : nothing}
              ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown!) : nothing}
            </div>`
          : nothing
      }
      ${
        isToolMessage
          ? html`
              <details class="chat-tool-msg-collapse">
                <summary class="chat-tool-msg-summary">
                  <span class="chat-tool-msg-summary__icon">${icons.zap}</span>
                  <span class="chat-tool-msg-summary__label">Tool output</span>
                  ${
                    toolSummaryLabel
                      ? html`<span class="chat-tool-msg-summary__names">${toolSummaryLabel}</span>`
                      : toolPreview
                        ? html`<span class="chat-tool-msg-summary__preview">${toolPreview}</span>`
                        : nothing
                  }
                </summary>
                <div class="chat-tool-msg-body">${renderMessageBody()}</div>
              </details>
            `
          : renderMessageBody()
      }
    </div>
  `;
}
