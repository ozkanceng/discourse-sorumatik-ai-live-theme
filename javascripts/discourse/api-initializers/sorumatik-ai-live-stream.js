import { apiInitializer } from "discourse/lib/api";
import { cook } from "discourse/lib/text";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";

export default apiInitializer("1.8.0", (api) => {
  if (window.__sorumatikLiveStreamInitialized) return;
  window.__sorumatikLiveStreamInitialized = true;

  let activeTopicId = null;
  let activeSourcePostId = null;
  let activeSourcePostNumber = 1;
  const subscribedChannels = new Set();
  let currentRaw = "";
  let isGenerating = false;
  let renderThrottleTimer = null;
  let autoScrollThrottleTimer = null;
  let isUserScrolledUp = false;
  let lastScrollY = window.pageYOffset;
  let scrollListenersAttached = false;
  let hasScrolledToCard = false;
  let domRetryTimer = null;
  let domGuardInterval = null;
  let katexReadyPromise = null;
  let touchStartY = 0;

  // Güvenli yerelleştirme yardımcısı: Eğer çeviri anahtarı bulunamazsa
  // [tr_TR...] gibi ham anahtar yerine doğrudan temiz Türkçe yedeği döndürür.
  function t(key, fallback) {
    let val = null;
    try {
      if (typeof themePrefix === "function") {
        val = I18n.t(themePrefix(key));
      }
    } catch (_) {}

    if (!val || (typeof val === "string" && val.startsWith("[") && val.endsWith("]"))) {
      try {
        val = I18n.t(key);
      } catch (_) {}
    }

    if (!val || (typeof val === "string" && val.startsWith("[") && val.endsWith("]"))) {
      return fallback;
    }
    return val;
  }

  const botUsername = (settings.bot_username || "sorumatik_ai").toLowerCase();
  const cardTitle = settings.card_title || t("sorumatik_ai.title", "Sorumatik AI Çözümü Yazıyor...");
  const showPulse = settings.show_pulse_indicator !== false;
  const autoScrollToAnswer = settings.auto_scroll_to_answer !== false;
  const autoScrollFollow = settings.auto_scroll_follow_stream !== false;

  // sorumatik_ai resmi bot profil avatarı
  const defaultBotAvatar = `/user_avatar/sorumatik.co/${botUsername}/90/235405_2.png`;
  const botAvatarUrl = (settings.bot_avatar_url || "").trim() || defaultBotAvatar;

  function getMessageBus() {
    return window.MessageBus || (api.container?.lookup ? api.container.lookup("service:message-bus") : null);
  }

  function getTopicIdFromUrl(url) {
    const targetUrl = url || window.location.pathname;
    const match = targetUrl.match(/\/t\/(?:[^\/]+\/)?(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // KaTeX kütüphanesini ve CSS stilini yükle
  function ensureKaTeX() {
    if (window.katex && typeof window.katex.render === "function") {
      return Promise.resolve(window.katex);
    }
    if (katexReadyPromise) return katexReadyPromise;

    katexReadyPromise = new Promise((resolve) => {
      if (!document.querySelector("#sorumatik-katex-css") && !document.querySelector("link[href*='katex']")) {
        const link = document.createElement("link");
        link.id = "sorumatik-katex-css";
        link.rel = "stylesheet";
        link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
        document.head.appendChild(link);
      }

      if (window.katex && typeof window.katex.render === "function") {
        resolve(window.katex);
        return;
      }

      if (!document.querySelector("#sorumatik-katex-js") && !document.querySelector("script[src*='katex']")) {
        const script = document.createElement("script");
        script.id = "sorumatik-katex-js";
        script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
        script.async = true;
        script.onload = () => resolve(window.katex);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      } else {
        const checkTimer = setInterval(() => {
          if (window.katex && typeof window.katex.render === "function") {
            clearInterval(checkTimer);
            resolve(window.katex);
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkTimer);
          resolve(window.katex || null);
        }, 2500);
      }
    });

    return katexReadyPromise;
  }

  // Canlı yazılan metin içindeki LaTeX matematik formüllerini KaTeX ile biçimlendir
  function renderMathInContainer(container) {
    if (!container || !window.katex || typeof window.katex.render !== "function") return;

    const mathElements = container.querySelectorAll(".math");
    mathElements.forEach((el) => {
      const isDisplay = el.tagName === "DIV" || el.classList.contains("math-block");
      let tex = el.getAttribute("data-original-tex");
      if (!tex) {
        tex = el.textContent || "";
        el.setAttribute("data-original-tex", tex);
      }
      if (!tex.trim()) return;

      try {
        window.katex.render(tex, el, {
          displayMode: isDisplay,
          throwOnError: false,
        });
      } catch (_) {}
    });

    if (typeof window.renderMathInElement === "function") {
      try {
        window.renderMathInElement(container, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
        });
      } catch (_) {}
    }
  }

  function handleUserScroll() {
    const currentY = window.pageYOffset;
    if (currentY < lastScrollY - 15) {
      isUserScrolledUp = true;
    } else {
      const viewportBottom = currentY + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight - viewportBottom < 120) {
        isUserScrolledUp = false;
      }
    }
    lastScrollY = currentY;
  }

  function handleWheel(e) {
    if (e.deltaY < -5) {
      isUserScrolledUp = true;
    } else if (e.deltaY > 5) {
      const viewportBottom = window.pageYOffset + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight - viewportBottom < 120) {
        isUserScrolledUp = false;
      }
    }
  }

  function handleTouchStart(e) {
    if (e.touches && e.touches[0]) {
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e) {
    if (e.touches && e.touches[0]) {
      const currentY = e.touches[0].clientY;
      if (currentY > touchStartY + 15) {
        isUserScrolledUp = true;
      }
    }
  }

  function attachScrollListeners() {
    if (scrollListenersAttached) return;
    scrollListenersAttached = true;
    lastScrollY = window.pageYOffset;
    window.addEventListener("scroll", handleUserScroll, { passive: true });
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
  }

  function detachScrollListeners() {
    if (!scrollListenersAttached) return;
    scrollListenersAttached = false;
    window.removeEventListener("scroll", handleUserScroll, { passive: true });
    window.removeEventListener("wheel", handleWheel, { passive: true });
    window.removeEventListener("touchstart", handleTouchStart, { passive: true });
    window.removeEventListener("touchmove", handleTouchMove, { passive: true });
    isUserScrolledUp = false;
  }

  function scrollToCard(card) {
    if (!card || hasScrolledToCard || !autoScrollToAnswer) return;
    hasScrolledToCard = true;

    setTimeout(() => {
      if (!card || !card.isConnected) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
  }

  function autoScrollFollowCard(card) {
    if (!card || isUserScrolledUp || !autoScrollFollow) return;

    if (autoScrollThrottleTimer) return;
    autoScrollThrottleTimer = setTimeout(() => {
      autoScrollThrottleTimer = null;
      if (!card || !card.isConnected || isUserScrolledUp) return;

      const cursor = card.querySelector(".sorumatik-cursor");
      const targetEl = cursor || card;
      const rect = targetEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

      if (rect.bottom > viewportHeight - 85) {
        const scrollDelta = rect.bottom - (viewportHeight - 85);
        window.scrollBy({
          top: scrollDelta,
          behavior: "smooth",
        });
      }
    }, 80);
  }

  function buildFooterHtml() {
    const showBranding = settings.show_branding !== false;
    const brandingUrl = settings.branding_url || "https://sorumatik.co";
    const brandingText = settings.branding_text || t("sorumatik_ai.branding", "sorumatik.co Yapay Zeka Motoru");

    const showApp = settings.show_app_download !== false;
    const useDirect = settings.use_direct_store_links === true;
    const appLandingUrl = settings.app_landing_url || "https://sorumatik.co/t/app";
    const androidUrl = settings.android_store_url || "https://play.google.com/store/apps/details?id=com.sorumatik";
    const iosUrl = settings.ios_store_url || "https://apps.apple.com/app/sorumatik/id6474668271";

    if (!showBranding && !showApp) return "";

    let leftHtml = "";
    if (showBranding) {
      leftHtml = `
        <div class="footer-left">
          <a href="${brandingUrl}" target="_blank" rel="noopener noreferrer" class="branding-link" title="sorumatik.co">
            <span class="lightning-icon">⚡</span>
            <span><strong>${brandingText}</strong></span>
          </a>
        </div>
      `;
    }

    let rightHtml = "";
    if (showApp) {
      if (useDirect) {
        rightHtml = `
          <div class="footer-right">
            <span class="app-hint">${t("sorumatik_ai.download_app_hint", "Mobilde kesintisiz & sesli soru çözümü için:")}</span>
            <a href="${androidUrl}" target="_blank" rel="noopener noreferrer" class="app-download-btn android-btn">
              ${t("sorumatik_ai.download_android", "🤖 Android İndir")}
            </a>
            <a href="${iosUrl}" target="_blank" rel="noopener noreferrer" class="app-download-btn ios-btn">
              ${t("sorumatik_ai.download_ios", "🍎 iOS İndir")}
            </a>
          </div>
        `;
      } else {
        rightHtml = `
          <div class="footer-right">
            <a href="${appLandingUrl}" target="_blank" rel="noopener noreferrer" class="app-download-btn" title="Sorumatik Mobil Uygulamasını İndir">
              ${t("sorumatik_ai.download_app_button", "📱 Sorumatik Uygulamasını İndir")}
            </a>
          </div>
        `;
      }
    }

    return `
      <div class="sorumatik-ai-live-footer">
        ${leftHtml}
        ${rightHtml}
      </div>
    `;
  }

  function cleanupCurrentSession() {
    if (renderThrottleTimer) {
      clearTimeout(renderThrottleTimer);
      renderThrottleTimer = null;
    }
    if (autoScrollThrottleTimer) {
      clearTimeout(autoScrollThrottleTimer);
      autoScrollThrottleTimer = null;
    }
    if (domRetryTimer) {
      clearTimeout(domRetryTimer);
      domRetryTimer = null;
    }
    if (domGuardInterval) {
      clearInterval(domGuardInterval);
      domGuardInterval = null;
    }

    const mb = getMessageBus();
    if (mb && subscribedChannels.size > 0) {
      subscribedChannels.forEach((ch) => {
        try {
          mb.unsubscribe(ch);
        } catch (_) {}
      });
      subscribedChannels.clear();
    }

    activeTopicId = null;
    activeSourcePostId = null;
    activeSourcePostNumber = 1;
    currentRaw = "";
    isGenerating = false;
    hasScrolledToCard = false;
    detachScrollListeners();

    const existingCard = document.querySelector(".sorumatik-ai-live-card");
    if (existingCard) {
      existingCard.remove();
    }
  }

  function subscribeChannel(channel, onMessage) {
    const mb = getMessageBus();
    if (!mb || !channel || subscribedChannels.has(channel)) return;

    subscribedChannels.add(channel);
    mb.subscribe(
      channel,
      (data) => {
        if (!subscribedChannels.has(channel) || !data) return;
        onMessage(data);
      },
      0
    );
  }

  function ensureCardElement(sourcePostNumber = activeSourcePostNumber || 1) {
    const existing = document.querySelector(".sorumatik-ai-live-card");
    if (existing && existing.isConnected) {
      return existing;
    }

    let anchor = null;
    if (sourcePostNumber) {
      anchor =
        document.querySelector(`#post_${sourcePostNumber}`) ||
        document.querySelector(`[data-post-number="${sourcePostNumber}"]`);
    }

    if (!anchor && activeSourcePostId) {
      anchor =
        document.querySelector(`.topic-post[data-post-id="${activeSourcePostId}"]`) ||
        document.querySelector(`#post_${activeSourcePostId}`);
    }

    if (!anchor) {
      anchor =
        document.querySelector("#post_1") ||
        document.querySelector('[data-post-number="1"]') ||
        document.querySelector(".topic-post:first-child");
    }

    const postStream =
      document.querySelector(".post-stream") ||
      document.querySelector("#topic-posts") ||
      document.querySelector(".topic-area");

    if (!anchor && !postStream) {
      // DOM henüz hazır değilse yeniden dene
      if (!domRetryTimer && isGenerating) {
        domRetryTimer = setTimeout(() => {
          domRetryTimer = null;
          if (isGenerating) {
            ensureCardElement(sourcePostNumber);
            if (currentRaw) {
              renderLiveText(currentRaw, false);
            }
          }
        }, 120);
      }
      return null;
    }

    const card = document.createElement("div");
    card.className = "sorumatik-ai-live-card";
    card.id = `sorumatik-live-card-${activeSourcePostId || "active"}`;

    const fallbackSvg =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'><path d='M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5Z'/></svg>";
    const avatarHtml = `<img src="${botAvatarUrl}" alt="${botUsername}" class="sorumatik-bot-avatar-img" onerror="this.onerror=null;this.src='${fallbackSvg}';" />`;

    const badgeHtml = showPulse
      ? `<div class="live-badge">
          <span class="pulse-dot"></span>
          <span>${t("sorumatik_ai.badge", "CANLI")}</span>
        </div>`
      : "";

    card.innerHTML = `
      <div class="sorumatik-ai-live-header">
        <div class="header-left">
          <div class="bot-avatar">${avatarHtml}</div>
          <div class="title-group">
            <h4 class="card-title">${cardTitle}</h4>
            <span class="card-subtitle status-text">${t("sorumatik_ai.generating", "Çözüm adımları canlı hazırlanıyor...")}</span>
          </div>
        </div>
        ${badgeHtml}
      </div>
      <div class="sorumatik-ai-live-body">
        <div class="sorumatik-initial-loading">
          <div class="loading-spinner"></div>
          <span>${t("sorumatik_ai.generating", "Çözüm adımları canlı hazırlanıyor...")}</span>
        </div>
      </div>
      ${buildFooterHtml()}
    `;

    if (anchor && anchor.parentNode) {
      anchor.insertAdjacentElement("afterend", card);
    } else if (postStream) {
      const firstPost = postStream.querySelector(".topic-post") || postStream.firstElementChild;
      if (firstPost && firstPost.nextSibling) {
        postStream.insertBefore(card, firstPost.nextSibling);
      } else {
        postStream.appendChild(card);
      }
    }

    attachScrollListeners();
    scrollToCard(card);

    // Ember virtual scroll sırasında kartın DOM'dan düşmesini engelle
    if (!domGuardInterval) {
      domGuardInterval = setInterval(() => {
        if (!isGenerating) {
          clearInterval(domGuardInterval);
          domGuardInterval = null;
          return;
        }
        const liveCard = document.querySelector(".sorumatik-ai-live-card");
        if (!liveCard || !liveCard.isConnected) {
          ensureCardElement(activeSourcePostNumber);
          if (currentRaw) {
            renderLiveText(currentRaw, false);
          }
        }
      }, 500);
    }

    return card;
  }

  function renderLiveText(rawText, done = false) {
    currentRaw = rawText;
    if (!currentRaw && !done) return;

    if (renderThrottleTimer) return;

    renderThrottleTimer = setTimeout(async () => {
      renderThrottleTimer = null;
      const card = ensureCardElement(activeSourcePostNumber);
      if (!card) return;

      const bodyEl = card.querySelector(".sorumatik-ai-live-body");
      if (!bodyEl) return;

      try {
        const cookedHtml = await cook(currentRaw);
        const cursorHtml = done ? "" : `<span class="sorumatik-cursor"></span>`;
        bodyEl.innerHTML = cookedHtml + cursorHtml;

        // Formülleri KaTeX ile anında render et
        await ensureKaTeX();
        renderMathInContainer(bodyEl);

        // Canlı yazma sırasında imleci takip et
        if (!done) {
          autoScrollFollowCard(card);
        }
      } catch (_) {
        bodyEl.textContent = currentRaw;
      }
    }, 50);
  }

  function handleComplete(postStream) {
    detachScrollListeners();
    isGenerating = false;
    if (domGuardInterval) {
      clearInterval(domGuardInterval);
      domGuardInterval = null;
    }

    const card = document.querySelector(".sorumatik-ai-live-card");
    if (card) {
      const statusText = card.querySelector(".status-text");
      if (statusText) {
        statusText.textContent = t("sorumatik_ai.completed", "Çözüm başarıyla eklendi!");
      }
      const cursor = card.querySelector(".sorumatik-cursor");
      if (cursor) cursor.remove();

      // 1.5 saniye sonra kartı yumuşakça kaldır ve post stream'i yenile
      setTimeout(() => {
        card.classList.add("fading-out");
        setTimeout(() => {
          card.remove();
          if (postStream && typeof postStream.refresh === "function") {
            postStream.refresh();
          }
          try {
            api.container?.lookup?.("service:app-events")?.trigger("post-stream:refresh");
          } catch (_) {}
        }, 500);
      }, 1400);
    }
  }

  function handleLiveSnapshot(data, topic) {
    if (!data) return;

    if (data.source_post_number) {
      activeSourcePostNumber = data.source_post_number;
    }
    if (data.source_post_id) {
      activeSourcePostId = data.source_post_id;
    }

    // Üretim tamamlanmışsa: bot cevabı zaten DOM'da/post stream'de var mı kontrol et
    if (data.done === true || data.state === "completed") {
      const posts = topic?.get ? topic.get("postStream.posts") || [] : [];
      const botPostExists = posts.some(
        (p) =>
          (p.get ? p.get("username") : p.username)?.toLowerCase() === botUsername &&
          (activeSourcePostNumber ? (p.get ? p.get("post_number") : p.post_number) > activeSourcePostNumber : true)
      );

      if (botPostExists) {
        cleanupCurrentSession();
        return;
      }

      if (data.raw) {
        renderLiveText(data.raw, true);
      }
      handleComplete(topic?.get ? topic.get("postStream") : null);
      return;
    }

    if (data.state === "failed") {
      cleanupCurrentSession();
      return;
    }

    isGenerating = true;
    ensureCardElement(activeSourcePostNumber);

    if (data.raw) {
      renderLiveText(data.raw, false);
    }
  }

  function attachToTopic(topicId, initialSourcePostId = null, initialSourcePostNumber = 1) {
    if (!topicId || topicId <= 0) return;

    if (activeTopicId === topicId && isGenerating) {
      return;
    }

    cleanupCurrentSession();
    activeTopicId = topicId;
    activeSourcePostId = initialSourcePostId;
    activeSourcePostNumber = initialSourcePostNumber;

    const topicController = api.container?.lookup ? api.container.lookup("controller:topic") : null;
    const topic = topicController?.get ? topicController.get("model") : null;

    // 1. Konu bazlı canlı MessageBus kanalını anında dinle
    subscribeChannel(`/sorumatik/ai-answer/topic/${topicId}`, (data) => {
      handleLiveSnapshot(data, topic);
    });

    // 2. Eğer kaynak post ID biliniyorsa doğrudan post kanalını da dinle
    if (initialSourcePostId) {
      subscribeChannel(`/sorumatik/ai-answer/${initialSourcePostId}`, (data) => {
        handleLiveSnapshot(data, topic);
      });
    }

    // 3. Sunucudan konudaki aktif üretim durumunu sorgula
    ajax(`/sorumatik/ai-generations/by-topic/${topicId}.json`, { ignoreUncaught: true })
      .then((res) => {
        if (activeTopicId !== topicId || !res) return;
        if (res.success && res.generation) {
          const gen = res.generation;
          if (gen.source_post_id && !subscribedChannels.has(`/sorumatik/ai-answer/${gen.source_post_id}`)) {
            subscribeChannel(`/sorumatik/ai-answer/${gen.source_post_id}`, (data) => {
              handleLiveSnapshot(data, topic);
            });
          }
          handleLiveSnapshot(gen, topic);
        }
      })
      .catch(() => {
        if (initialSourcePostId) {
          ajax(`/sorumatik/ai-generations/by-source/${initialSourcePostId}.json`, { ignoreUncaught: true })
            .then((gen) => {
              if (activeTopicId !== topicId || !gen) return;
              handleLiveSnapshot(gen, topic);
            })
            .catch(() => {});
        }
      });
  }

  // A. Sayfa / Konu geçişi dinleyicisi
  api.onPageChange((url) => {
    const topicId = getTopicIdFromUrl(url);
    if (!topicId) {
      cleanupCurrentSession();
      return;
    }

    setTimeout(() => {
      attachToTopic(topicId);
    }, 60);
  });

  // B. Konu modeli tam yüklendiğinde tetiklenen Discourse appEvent
  api.onAppEvent("page:topic-loaded", (topic) => {
    const topicId = topic?.get ? topic.get("id") : topic?.id || getTopicIdFromUrl();
    if (topicId) {
      attachToTopic(topicId);
    }
  });

  // C. Kullanıcı web editöründen yeni soru veya cevap gönderdiğinde ANINDA tetikleme
  api.onAppEvent("composer:created-post", (result) => {
    if (!result) return;
    const postId = result.postId || result.id || (result.post ? result.post.id : null);
    const topicId = result.topicId || (result.post ? result.post.topic_id : null) || getTopicIdFromUrl();
    const postNumber = result.postNumber || (result.post ? result.post.post_number : 1);

    if (topicId) {
      attachToTopic(topicId, postId, postNumber);
      ensureCardElement(postNumber);
    }
  });
});
