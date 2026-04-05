// Shared renderer helpers (chat + common metadata formatting)

function getVideoIdFromFilename(filename) {
  return String(filename || "").replace(/\.(mp4|mkv|webm|mov)$/i, "");
}

function formatUploadDateForDescription(uploadDate) {
  const value = String(uploadDate || "");
  if (value.length !== 8) return value;
  return `${value.substring(0, 4)}/${value.substring(4, 6)}/${value.substring(6, 8)}`;
}

function formatVideoTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatChannelSubscribers(subCount) {
  if (typeof subCount !== "number") return "登録者数不明";
  if (subCount < 10000) return `${subCount}人`;
  return `${Math.floor(subCount / 1000) / 10}万人`;
}

function normalizeLiveChatBaseName(videoBaseName) {
  return String(videoBaseName || "")
    .replace(/\.live_chat\.json$/i, "")
    .replace(/\.(mp4|mkv|webm|mov)$/i, "");
}

function extractNonEmptyNdjsonLines(text) {
  const value = String(text || "");
  const lines = [];
  let start = 0;

  for (let index = 0; index <= value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    const isLineBreak =
      index === value.length || charCode === 10 || charCode === 13;
    if (!isLineBreak) continue;

    let end = index;
    while (start < end && /\s/.test(value[start])) start += 1;
    while (end > start && /\s/.test(value[end - 1])) end -= 1;
    if (end > start) {
      lines.push(value.slice(start, end));
    }

    if (charCode === 13 && value.charCodeAt(index + 1) === 10) {
      index += 1;
    }
    start = index + 1;
  }

  return lines;
}

function parseNdjsonMessages(text) {
  const messages = [];
  for (const line of extractNonEmptyNdjsonLines(text)) {
    try {
      messages.push(JSON.parse(line));
    } catch (e) {
      console.warn("パース失敗した行:", line, e);
    }
  }
  return messages;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractChatRenderer(msg) {
  const item = msg?.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item;
  return (
    item?.liveChatTextMessageRenderer ||
    item?.liveChatViewerEngagementMessageRenderer ||
    null
  );
}

function getChatTimeSec(msg) {
  const timeMs = msg?.replayChatItemAction?.videoOffsetTimeMsec;
  return timeMs ? Math.floor(timeMs / 1000) : null;
}

function getChatBadgeInfo(renderer) {
  const badges = renderer?.authorBadges || [];
  const isMember = badges.some(
    (badge) =>
      badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("Member") ||
      badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("メンバー"),
  );
  const isModerator = badges.some(
    (badge) =>
      badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("Moderator") ||
      badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("モデレーター"),
  );
  const badgeImages = badges
    .map(
      (badge) =>
        badge?.liveChatAuthorBadgeRenderer?.customThumbnail?.thumbnails?.slice(-1)[0],
    )
    .filter(Boolean)
    .flat();

  return { isMember, isModerator, badgeImages };
}

function renderChatMessageHtml(message) {
  if (!message) return "";
  if (message.simpleText) return escapeHtml(message.simpleText);
  if (!message.runs) return "";

  return message.runs
    .map((run) => {
      if (run.text) return escapeHtml(run.text);
      if (!run.emoji) return "";

      const thumb = run.emoji.image?.thumbnails?.slice(-1)[0];
      if (!thumb?.url) return "";
      const alt =
        run.emoji.image?.accessibility?.accessibilityData?.label ||
        run.emoji.emojiId ||
        "emoji";
      return `<img src="${thumb.url}" alt="${escapeHtml(alt)}" class="chat-emoji">`;
    })
    .join("");
}

function createChatAvatarElementForRenderer(renderer, author) {
  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";

  const thumbUrl = renderer?.authorPhoto?.thumbnails?.slice(-1)[0]?.url || null;
  if (thumbUrl) {
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = author;
    img.loading = "lazy";
    avatar.appendChild(img);
  } else {
    avatar.innerHTML = `<i class="fa-solid fa-circle-user"></i>`;
  }

  return avatar;
}

function createChatBadgeElementFromImages(badgeImages) {
  const badge = document.createElement("div");
  badge.className = "chat-badge";

  const badgeContainer = document.createElement("div");
  badgeContainer.className = "badge-container";
  badge.appendChild(badgeContainer);

  badgeImages.forEach((thumb) => {
    const img = document.createElement("img");
    img.src = thumb.url;
    img.style.width = "16px";
    img.style.height = "16px";
    badgeContainer.appendChild(img);
  });

  return badge;
}

function createChatLineElementFromMessage(msg) {
  const renderer = extractChatRenderer(msg);
  if (!renderer) return null;

  const author = renderer.authorName?.simpleText || "NoName";
  const { isMember, isModerator, badgeImages } = getChatBadgeInfo(renderer);
  const msgHtml =
    renderChatMessageHtml(renderer.message) ||
    renderer.message?.simpleText ||
    "（メッセージなし）";

  const line = document.createElement("div");
  line.className = "chat-line";
  const timeSec = getChatTimeSec(msg);
  if (timeSec !== null) {
    line.dataset.time = timeSec;
  }

  const nameEl = document.createElement("span");
  nameEl.className = "chat-name";
  nameEl.textContent = author;
  if (isModerator) {
    nameEl.classList.add("moderator");
  } else if (isMember) {
    nameEl.classList.add("member");
  }

  const msgEl = document.createElement("span");
  msgEl.className = "chat-message";
  msgEl.innerHTML = msgHtml;

  line.appendChild(createChatAvatarElementForRenderer(renderer, author));
  line.appendChild(nameEl);
  line.appendChild(createChatBadgeElementFromImages(badgeImages));
  line.appendChild(msgEl);
  return line;
}
