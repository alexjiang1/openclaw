type PostContentResult = {
  textContent: string;
  imageKeys: string[];
};

/**
 * Parse post (rich text) content and extract embedded image keys.
 * Post structure: { title?: string, content: [[{ tag, text?, image_key?, ... }]] }
 */
export function parsePostContent(content: string): PostContentResult {
  try {
    const parsed = JSON.parse(content) as {
      title?: string;
      content?: Array<Array<Record<string, unknown>>>;
    };
    const title = typeof parsed.title === "string" ? parsed.title : "";
    const contentBlocks = Array.isArray(parsed.content) ? parsed.content : [];
    let textContent = title ? `${title}\n\n` : "";
    const imageKeys: string[] = [];

    for (const paragraph of contentBlocks) {
      if (!Array.isArray(paragraph)) continue;
      for (const element of paragraph) {
        if (!element || typeof element !== "object") continue;
        const tag = typeof element.tag === "string" ? element.tag : "";
        if (tag === "text") {
          textContent += typeof element.text === "string" ? element.text : "";
        } else if (tag === "a") {
          textContent +=
            (typeof element.text === "string" && element.text) ||
            (typeof element.href === "string" ? element.href : "");
        } else if (tag === "at") {
          const userName = typeof element.user_name === "string" ? element.user_name : "";
          const userId = typeof element.user_id === "string" ? element.user_id : "";
          textContent += `@${userName || userId}`;
        } else if (tag === "img" && typeof element.image_key === "string") {
          imageKeys.push(element.image_key);
        }
      }
      textContent += "\n";
    }

    return {
      textContent: textContent.trim() || "[富文本消息]",
      imageKeys,
    };
  } catch {
    return { textContent: "[富文本消息]", imageKeys: [] };
  }
}

function pickInteractiveCardUrl(parsed: Record<string, unknown>): string | undefined {
  const cardLink =
    parsed.card_link && typeof parsed.card_link === "object"
      ? (parsed.card_link as Record<string, unknown>)
      : undefined;

  const candidates = [
    cardLink?.pc_url,
    cardLink?.url,
    cardLink?.ios_url,
    cardLink?.android_url,
    parsed.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function collectInteractiveTextHints(
  value: unknown,
  out: string[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectInteractiveTextHints(item, out, seen, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      if (["text", "content", "title", "subtitle", "description", "desc", "name"].includes(key)) {
        const normalized = child.trim();
        if (normalized && !/^https?:\/\//i.test(normalized) && !seen.has(normalized)) {
          seen.add(normalized);
          out.push(normalized);
        }
      }
      continue;
    }
    collectInteractiveTextHints(child, out, seen, depth + 1);
  }
}

/**
 * Best-effort parse for Feishu interactive/card content.
 * For link cards, prefer title + URL so the message stays readable to the agent.
 */
export function parseInteractiveContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const url = pickInteractiveCardUrl(parsed);

    const parts: string[] = [];
    if (title) {
      parts.push(url ? `[链接卡片] ${title}` : `[卡片消息] ${title}`);
    } else if (url) {
      parts.push("[链接卡片]");
    }
    if (url) parts.push(url);

    if (parts.length === 0) {
      const hints: string[] = [];
      const seen = new Set<string>();
      collectInteractiveTextHints(parsed, hints, seen);
      const hintText = hints.slice(0, 3).join(" ").trim();
      if (hintText) {
        return `[卡片消息] ${hintText}`;
      }
      return "[卡片消息]";
    }

    return parts.join("\n");
  } catch {
    return content;
  }
}

export function parseFeishuMessageBodyContent(content: string, messageType: string): string {
  try {
    if (messageType === "text") {
      const parsed = JSON.parse(content) as { text?: string };
      return parsed.text || "";
    }
    if (messageType === "post") {
      return parsePostContent(content).textContent;
    }
    if (messageType === "interactive") {
      return parseInteractiveContent(content);
    }
    return content;
  } catch {
    return content;
  }
}

export function isFeishuUnsupportedPlaceholder(content: string): boolean {
  const normalized = content.trim();
  return (
    /currently not supported/i.test(normalized) ||
    /message type is not supported/i.test(normalized) ||
    /消息类型.*不支持/.test(normalized)
  );
}
