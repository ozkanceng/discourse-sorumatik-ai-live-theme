import { withPluginApi } from "discourse/lib/plugin-api";
import { cook } from "discourse/lib/text";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";

export default {
  name: "sorumatik-ai-live-stream",

  initialize() {
    withPluginApi("0.8.14", (api) => {
      let activeChannel = null;
      let activeSubscription = null;
      let renderThrottleTimer = null;
      let currentRaw = "";
      let isCardMounted = false;
      let currentSourcePostId = null;

      const botUsername = (settings.bot_username || "sorumatik_ai").toLowerCase();
      const cardTitle = settings.card_title || I18n.t("sorumatik_ai.title") || "Sorumatik AI Çözümü Yazıyor...";
      const showPulse = settings.show_pulse_indicator !== false;
      const customAvatar = (settings.bot_avatar_url || "").trim();

      const messageBus = api.container.lookup("service:message-bus") || window.MessageBus;

      function cleanupCurrentSession() {
        if (renderThrottleTimer) {
          clearTimeout(renderThrottleTimer);
          renderThrottleTimer = null;
        }
        if (activeChannel && messageBus) {
          try {
            messageBus.unsubscribe(activeChannel);
          } catch (_) {}
          activeChannel = null;
        }
        activeSubscription = null;
        currentRaw = "";
        currentSourcePostId = null;

        const existingCard = document.querySelector(".sorumatik-ai-live-card");
        if (existingCard) {
          existingCard.remove();
        }
        isCardMounted = false;
      }

      function ensureCardElement(sourcePostNumber = 1) {
        if (isCardMounted && document.querySelector(".sorumatik-ai-live-card")) {
          return document.querySelector(".sorumatik-ai-live-card");
        }

        // Kartı sorunun hemen altına (Post #1 veya kaynak post) yerleştir
        const postElement =
          document.querySelector(`#post_${sourcePostNumber}`) ||
          document.querySelector(".topic-post:first-child") ||
          document.querySelector(".post-stream");

        if (!postElement) return null;

        const card = document.createElement("div");
        card.className = "sorumatik-ai-live-card";
        card.id = `sorumatik-live-card-${currentSourcePostId || "active"}`;

        const avatarHtml = customAvatar
          ? `<img src="${customAvatar}" alt="${botUsername}" />`
          : `🤖`;

        const badgeHtml = showPulse
          ? `<div class="live-badge">
              <span class="pulse-dot"></span>
              <span>${I18n.t("sorumatik_ai.badge") || "CANLI"}</span>
            </div>`
          : "";

        card.innerHTML = `
          <div class="sorumatik-ai-live-header">
            <div class="header-left">
              <div class="bot-avatar">${avatarHtml}</div>
              <div class="title-group">
                <h4 class="card-title">${cardTitle}</h4>
                <span class="card-subtitle status-text">${I18n.t("sorumatik_ai.generating") || "Çözüm adımları canlı hazırlanıyor..."}</span>
              </div>
            </div>
            ${badgeHtml}
          </div>
          <div class="sorumatik-ai-live-body">
            <div class="sorumatik-initial-loading">
              <div class="loading-spinner"></div>
              <span>${I18n.t("sorumatik_ai.generating") || "Çözüm adımları canlı hazırlanıyor..."}</span>
            </div>
          </div>
        `;

        if (postElement.classList.contains("post-stream")) {
          postElement.prepend(card);
        } else if (postElement.parentNode) {
          postElement.parentNode.insertBefore(card, postElement.nextSibling);
        }

        isCardMounted = true;
        return card;
      }

      function renderLiveText(rawText, done = false) {
        currentRaw = rawText;
        if (!currentRaw && !done) return;

        if (renderThrottleTimer) return;

        renderThrottleTimer = setTimeout(async () => {
          renderThrottleTimer = null;
          const card = ensureCardElement();
          if (!card) return;

          const bodyEl = card.querySelector(".sorumatik-ai-live-body");
          if (!bodyEl) return;

          try {
            const cookedHtml = await cook(currentRaw);
            const cursorHtml = done ? "" : `<span class="sorumatik-cursor"></span>`;
            bodyEl.innerHTML = cookedHtml + cursorHtml;

            // KaTeX formülleri sayfada yüklüyse anında matematik formatla
            if (window.renderMathInElement) {
              try {
                window.renderMathInElement(bodyEl, {
                  delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\[", right: "\\]", display: true },
                    { left: "\\(", right: "\\)", display: false }
                  ],
                  throwOnError: false
                });
              } catch (_) {}
            }
          } catch (_) {
            // Basit metin yedeği
            bodyEl.textContent = currentRaw;
          }
        }, 60);
      }

      function handleComplete(postStream) {
        const card = document.querySelector(".sorumatik-ai-live-card");
        if (card) {
          const statusText = card.querySelector(".status-text");
          if (statusText) {
            statusText.textContent = I18n.t("sorumatik_ai.completed") || "Çözüm eklendi!";
          }
          const cursor = card.querySelector(".sorumatik-cursor");
          if (cursor) cursor.remove();

          // 1.5 saniye sonra kartı yumuşakça kaldır ve post stream'i yenile
          setTimeout(() => {
            card.classList.add("fading-out");
            setTimeout(() => {
              card.remove();
              isCardMounted = false;
              if (postStream && typeof postStream.refresh === "function") {
                postStream.refresh();
              }
            }, 500);
          }, 1200);
        }
      }

      function attachToGeneration(topic, sourcePostId, sourcePostNumber = 1) {
        if (!sourcePostId || sourcePostId <= 0) return;
        currentSourcePostId = sourcePostId;

        const channel = `/sorumatik/ai-answer/${sourcePostId}`;
        if (activeChannel === channel) return;

        cleanupCurrentSession();
        activeChannel = channel;
        currentSourcePostId = sourcePostId;

        // Kartı ilk durumla oluştur
        ensureCardElement(sourcePostNumber);

        // Sunucuda zaten üretilmiş kısım varsa hemen çekip ekrana koy
        ajax(`/sorumatik/ai-generations/by-source/${sourcePostId}`, { ignoreUncaught: true })
          .then((res) => {
            if (res && res.raw) {
              renderLiveText(res.raw, res.done === true || res.state === "completed");
              if (res.done === true || res.state === "completed") {
                handleComplete(topic.get("postStream"));
              }
            }
          })
          .catch(() => {});

        // MessageBus canlı yayınını dinle
        if (messageBus) {
          messageBus.subscribe(channel, (data) => {
            if (!data) return;

            if (data.raw) {
              renderLiveText(data.raw, data.done === true || data.state === "completed");
            }

            if (data.done === true || data.state === "completed") {
              handleComplete(topic.get("postStream"));
              if (messageBus && activeChannel) {
                try {
                  messageBus.unsubscribe(activeChannel);
                } catch (_) {}
              }
            }
          }, -1); // -1: En son mesajı kaçırmamak için backlog'u da al
        }
      }

      api.onPageChange((url) => {
        // Topic sayfası kontrolü: /t/:slug/:id
        if (!url || !url.includes("/t/")) {
          cleanupCurrentSession();
          return;
        }

        const topicController = api.container.lookup("controller:topic");
        const topic = topicController?.get("model");
        if (!topic) {
          cleanupCurrentSession();
          return;
        }

        const postStream = topic.get("postStream");
        const posts = postStream?.get("posts") || [];

        // Botun cevabı zaten konuya kalıcı olarak eklenmişse canlı karta gerek yok
        const hasExistingBotReply = posts.some(
          (p) => (p.get ? p.get("username") : p.username)?.toLowerCase() === botUsername
        );

        const pending = topic.get("sorumatik_pending_generation");

        if (pending && pending.source_post_id) {
          // Sunucuda devam eden bir üretim var!
          attachToGeneration(topic, pending.source_post_id, 1);
        } else if (!hasExistingBotReply && posts.length > 0) {
          // Henüz bot cevabı yok, soru konusu ise MessageBus'ı dinle
          const firstPost = posts[0];
          const firstPostId = firstPost.get ? firstPost.get("id") : firstPost.id;
          if (firstPostId) {
            attachToGeneration(topic, firstPostId, 1);
          }
        } else {
          cleanupCurrentSession();
        }
      });
    });
  }
};
