// Home/Comment renderer and filtering module extracted from app.js

const DEFAULT_COMMENT_AVATAR =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='20' r='12' fill='%23999'/%3E%3Cpath d='M12 56c2-14 38-14 40 0' fill='%23ccc'/%3E%3C/svg%3E";

      function normalizeCommentItemForRenderer(comment) {
        if (comment.id && comment.text) {
          if (comment.parent === "root") comment.parent = null;
          return comment;
        }

        const top = comment.comment || comment;
        const parentValue = top.parent;
        return {
          id: top.id || top.comment_id || Math.random().toString(36).slice(2),
          parent: parentValue === "root" ? null : parentValue || null,
          author: top.author || top.author_name || "不明",
          text: top.text || top.content || "",
          like_count: top.like_count || 0,
          _time_text: top._time_text || "",
          author_thumbnail: top.author_thumbnail || null,
          timestamp: top.timestamp || 0,
          is_pinned: top.is_pinned || false,
        };
      }

      function extractRenderableCommentsFromInfo(info) {
        const raw = info.comments || info.comment_threads || [];
        return raw
          .map((comment) => normalizeCommentItemForRenderer(comment))
          .filter((comment) => comment.text && comment.text.trim() !== "");
      }

      function buildCommentTreeFromList(comments) {
        const nodeMap = {};
        comments.forEach((comment) => {
          nodeMap[comment.id] = { ...comment, children: [] };
        });

        comments.forEach((comment) => {
          if (comment.parent && nodeMap[comment.parent]) {
            nodeMap[comment.parent].children.push(nodeMap[comment.id]);
          }
        });

        return comments
          .filter((comment) => !comment.parent)
          .map((comment) => nodeMap[comment.id]);
      }

      function createCommentAvatarLinkElement(comment, defaultCommentAvatar) {
        const avatarLink = document.createElement("a");
        avatarLink.href = "#";
        avatarLink.className = "comment-avatar-link";

        const avatar = document.createElement("img");
        avatar.className = "comment-avatar";
        avatar.loading = "lazy";
        avatar.src =
          comment.author_thumbnail && comment.author_thumbnail !== ""
            ? comment.author_thumbnail
            : defaultCommentAvatar;
        avatar.onerror = () => {
          avatar.src = defaultCommentAvatar;
        };

        avatarLink.appendChild(avatar);
        return avatarLink;
      }

      function createCommentMetaElement(comment) {
        const meta = document.createElement("div");
        meta.className = "comment-meta";

        const author = document.createElement("span");
        author.className = "comment-author";
        author.textContent = comment.author || "@Unknown";

        const time = document.createElement("span");
        time.className = "comment-time";
        time.textContent = comment._time_text || "";

        meta.appendChild(author);
        meta.appendChild(time);
        return meta;
      }

      function createCommentActionsElement(comment) {
        const actions = document.createElement("div");
        actions.className = "comment-actions";

        const btnLike = document.createElement("button");
        btnLike.className = "action-btn";
        btnLike.title = "高評価";
        const likeCountText = comment.like_count > 0 ? comment.like_count : "";
        btnLike.innerHTML = `<i class="fa-regular fa-thumbs-up"></i> ${likeCountText}`;

        const btnReply = document.createElement("button");
        btnReply.className = "action-btn";
        btnReply.textContent = "返信";

        actions.appendChild(btnLike);
        actions.appendChild(btnReply);
        return actions;
      }

      function attachCommentExpandBehavior(textEl, moreBtn) {
        requestAnimationFrame(() => {
          let lineHeight = parseFloat(getComputedStyle(textEl).lineHeight);
          if (isNaN(lineHeight)) lineHeight = 19.6;

          const maxHeight = lineHeight * 4;
          textEl.classList.remove("clamped");

          if (textEl.scrollHeight > maxHeight + 5) {
            textEl.classList.add("clamped");
            moreBtn.style.display = "block";
          }
        });

        moreBtn.addEventListener("click", () => {
          const isClamped = textEl.classList.toggle("clamped");
          moreBtn.textContent = isClamped ? "もっと見る" : "一部を表示";
        });
      }

      function createCommentElementNode(comment, isReply, linkify, defaultCommentAvatar) {
        const item = document.createElement("div");
        item.className = isReply ? "comment-reply" : "comment-item";

        const body = document.createElement("div");
        body.className = "comment-body";

        const text = document.createElement("div");
        text.className = "comment-text";
        text.innerHTML = comment.text ? linkify(comment.text) : "";

        const moreBtn = document.createElement("button");
        moreBtn.className = "comment-more";
        moreBtn.textContent = "もっと見る";
        moreBtn.style.display = "none";

        body.appendChild(createCommentMetaElement(comment));
        body.appendChild(text);
        body.appendChild(moreBtn);
        body.appendChild(createCommentActionsElement(comment));

        item.appendChild(createCommentAvatarLinkElement(comment, defaultCommentAvatar));
        item.appendChild(body);

        attachCommentExpandBehavior(text, moreBtn);
        return item;
      }

      function renderNestedReplyTreeNodes(nodes, container, linkify, defaultCommentAvatar) {
        nodes.forEach((node) => {
          const replyEl = createCommentElementNode(
            node,
            true,
            linkify,
            defaultCommentAvatar,
          );
          container.appendChild(replyEl);

          if (node.children.length > 0) {
            const nested = document.createElement("div");
            nested.className = "comment-replies";
            renderNestedReplyTreeNodes(node.children, nested, linkify, defaultCommentAvatar);
            replyEl.querySelector(".comment-body").appendChild(nested);
          }
        });
      }

      function createReplyControlsForComment(
        parentNode,
        parentEl,
        linkify,
        defaultCommentAvatar,
      ) {
        const replyContainer = document.createElement("div");
        replyContainer.className = "comment-replies";
        replyContainer.id = `replies-${parentNode.id}`;

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "comment-toggle";
        toggleBtn.dataset.parentId = parentNode.id;

        const updateToggleText = (isCollapsed) => {
          toggleBtn.textContent = isCollapsed
            ? `返信${parentNode.children.length}件 ▼`
            : `返信${parentNode.children.length}件 ▲`;
        };
        updateToggleText(true);

        const toggleReplies = () => {
          const container = document.getElementById(
            `replies-${toggleBtn.dataset.parentId}`,
          );
          if (!container) return;
          const isCollapsed = container.classList.toggle("collapsed");
          updateToggleText(isCollapsed);
        };

        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleReplies();
        });

        renderNestedReplyTreeNodes(
          parentNode.children,
          replyContainer,
          linkify,
          defaultCommentAvatar,
        );
        replyContainer.classList.add("collapsed");

        const bodyEl = parentEl.querySelector(".comment-body");
        bodyEl.appendChild(toggleBtn);
        bodyEl.appendChild(replyContainer);

        const threadHitbox = document.createElement("div");
        threadHitbox.className = "thread-hitbox";
        threadHitbox.title = "返信を開閉";
        threadHitbox.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleReplies();
        });
        parentEl.appendChild(threadHitbox);
      }

      function createCommentRenderer(linkify) {
        function renderComments(comments) {
          const list = document.getElementById("comment-list");
          const countDisplay = document.getElementById("comment-count-display");
          const empty = document.querySelector(".comment-empty");
          if (!list) return;

          list.style.display = "block";
          list.innerHTML = "";
          if (countDisplay) {
            countDisplay.textContent = comments ? comments.length : 0;
          }
          if (!Array.isArray(comments) || comments.length === 0) {
            if (empty) empty.style.display = "block";
            return;
          }
          if (empty) empty.style.display = "none";

          const roots = buildCommentTreeFromList(comments);
          roots.forEach((parentNode) => {
            const parentEl = createCommentElementNode(
              parentNode,
              false,
              linkify,
              DEFAULT_COMMENT_AVATAR,
            );
            parentEl.querySelector(".comment-text")?.classList.add("clamped");
            list.appendChild(parentEl);

            if (parentNode.children.length > 0) {
              createReplyControlsForComment(
                parentNode,
                parentEl,
                linkify,
                DEFAULT_COMMENT_AVATAR,
              );
            }
          });
        }

        return {
          extractRenderableComments: extractRenderableCommentsFromInfo,
          renderComments,
        };
      }

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

      function parseNdjsonMessages(text) {
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        const messages = [];
        for (const line of lines) {
          try {
            messages.push(JSON.parse(line));
          } catch (e) {
            console.warn("パース失敗した行:", line, e);
          }
        }
        return messages;
      }

      function extractChatRenderer(msg) {
        const item =
          msg?.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item;
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
              badge?.liveChatAuthorBadgeRenderer?.customThumbnail?.thumbnails?.slice(
                -1,
              )[0],
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
