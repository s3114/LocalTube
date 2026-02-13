(function attachHomeCards(global) {
  function createHomeCardDurationBadgeElement() {
    const badgeEl = document.createElement("div");
    badgeEl.className = "home-video-card-duration";
    badgeEl.textContent = "";
    return badgeEl;
  }

  function createHomeCardThumbElement(video) {
    const thumbEl = video.thumb
      ? document.createElement("img")
      : document.createElement("div");
    thumbEl.className = "home-video-card-thumb";
    if (video.thumb) {
      thumbEl.dataset.thumbSrc = video.thumb;
      thumbEl.loading = "lazy";
      thumbEl.decoding = "async";
    }
    return thumbEl;
  }

  function createHomeCardThumbWrapElement(video) {
    const wrapEl = document.createElement("div");
    wrapEl.className = "home-video-card-thumb-wrap";

    const thumbEl = createHomeCardThumbElement(video);
    const durationEl = createHomeCardDurationBadgeElement();

    wrapEl.appendChild(thumbEl);
    wrapEl.appendChild(durationEl);

    return { wrapEl, durationEl };
  }

  function createHomeCardMetaElements(video) {
    const metaEl = document.createElement("div");
    metaEl.className = "home-video-card-meta";

    const iconEl = document.createElement("img");
    iconEl.className = "home-video-channel-icon";
    iconEl.src = "/none_icon.jpg";
    iconEl.alt = "channel icon";
    iconEl.loading = "lazy";
    iconEl.onerror = () => {
      iconEl.src = "/none_icon.jpg";
    };

    const textsEl = document.createElement("div");
    textsEl.className = "home-video-card-texts";

    const titleEl = document.createElement("div");
    titleEl.className = "home-video-card-title";
    titleEl.textContent = video.title;

    const channelEl = document.createElement("div");
    channelEl.className = "home-video-card-channel";
    channelEl.textContent = "ローカル動画";

    const statsEl = document.createElement("div");
    statsEl.className = "home-video-card-stats";
    statsEl.textContent = "視聴回数不明 ・ 投稿日不明";

    textsEl.appendChild(titleEl);
    textsEl.appendChild(channelEl);
    textsEl.appendChild(statsEl);
    metaEl.appendChild(iconEl);
    metaEl.appendChild(textsEl);

    return { metaEl, refs: { titleEl, channelEl, statsEl, iconEl } };
  }

  function createHomeVideoCardElement(video, onClick) {
    const item = document.createElement("div");
    item.className = "home-video-card";
    const { wrapEl, durationEl } = createHomeCardThumbWrapElement(video);
    item.appendChild(wrapEl);

    const { metaEl, refs } = createHomeCardMetaElements(video);
    item.appendChild(metaEl);
    item.addEventListener("click", () => onClick(video));

    return { item, refs: { ...refs, durationEl } };
  }

  global.createHomeVideoCardElement = createHomeVideoCardElement;
})(window);
