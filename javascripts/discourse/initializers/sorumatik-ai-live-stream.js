import { withPluginApi } from "discourse/lib/plugin-api";
import { cook } from "discourse/lib/text";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";

export default {
  name: "sorumatik-ai-live-stream",

  initialize() {
    withPluginApi("0.8.14", (api) => {
      let activeChannel = null;
      let renderThrottleTimer = null;
      let currentRaw = "";
      let isCardMounted = false;
      let currentSourcePostId = null;
      let katexReadyPromise = null;

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

      // sorumatik_ai resmi bot profil avatarı
      const defaultBotAvatar = `/user_avatar/sorumatik.co/${botUsername}/90/235405_2.png`;
      const botAvatarUrl = (settings.bot_avatar_url || "").trim() || defaultBotAvatar;

      const messageBus = api.container.lookup("service:message-bus") || window.MessageBus;

      // KaTeX kütüphanesini ve CSS stilini garantiye al
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

        // 1. Discourse Markdown'ın oluşturduğu .math etiketlerini biçimlendir
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
              throwOnError: false
            });
          } catch (_) {}
        });

        // 2. Eğer sayfada renderMathInElement (auto-render) varsa ham $...$ ve $$...$$ ifadelerini de yakala
        if (typeof window.renderMathInElement === "function") {
          try {
            window.renderMathInElement(container, {
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
      }

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
        currentRaw = "";
        currentSourcePostId = null;

        const existingCard = document.querySelector(".sorumatik-ai-live-card");
        if (existingCard) {
          existingCard.remove();
        }
        isCardMounted = false;
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

      function ensureCardElement(sourcePostNumber = 1) {
        if (isCardMounted && document.querySelector(".sorumatik-ai-live-card")) {
          return document.querySelector(".sorumatik-ai-live-card");
        }

        // Kartı sorunun hemen altına (Post #1 veya ilgili kaynak post) yerleştir
        const postElement =
          document.querySelector(`#post_${sourcePostNumber}`) ||
          document.querySelector(`[data-post-number="${sourcePostNumber}"]`) ||
          document.querySelector(`.topic-post[data-post-id="${currentSourcePostId}"]`) ||
          document.querySelector(".topic-post:first-child") ||
          document.querySelector(".post-stream") ||
          document.querySelector("#topic-posts") ||
          document.querySelector(".topic-area");

        if (!postElement) return null;

        const card = document.createElement("div");
        card.className = "sorumatik-ai-live-card";
        card.id = `sorumatik-live-card-${currentSourcePostId || "active"}`;

        const avatarHtml = `<img src="${botAvatarUrl}" alt="${botUsername}" class="sorumatik-bot-avatar-img" onerror="this.onerror=null;this.src='/uploads/default/original/2X/b/bfa9260de78d71e38ac0b7ec2e03a8e53e4ddcfb_2_32x32.png';" />`;

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

        if (postElement.id === `post_${sourcePostNumber}` || postElement.classList.contains("topic-post")) {
          if (postElement.nextSibling) {
            postElement.parentNode.insertBefore(card, postElement.nextSibling);
          } else {
            postElement.parentNode.appendChild(card);
          }
        } else if (postElement.classList.contains("post-stream") || postElement.id === "topic-posts") {
          const firstArticle = postElement.querySelector(".topic-post") || postElement.firstElementChild;
          if (firstArticle && firstArticle.nextSibling) {
            postElement.insertBefore(card, firstArticle.nextSibling);
          } else {
            postElement.prepend(card);
          }
        } else {
          postElement.appendChild(card);
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

            // Formülleri anında KaTeX ile render et
            await ensureKaTeX();
            renderMathInContainer(bodyEl);
          } catch (_) {
            bodyEl.textContent = currentRaw;
          }
        }, 50);
      }

      function handleComplete(postStream) {
        const card = document.querySelector(".sorumatik-ai-live-card");
        if (card) {
          const statusText = card.querySelector(".status-text");
          if (statusText) {
            statusText.textContent = t("sorumatik_ai.completed", "Çözüm eklendi!");
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

        const channel = `/sorumatik/ai-answer/${sourcePostId}`;
        if (activeChannel === channel) return;

        cleanupCurrentSession();
        activeChannel = channel;
        currentSourcePostId = sourcePostId;

        // Kartı ilk postun altına yerleştirmeyi dene
        ensureCardElement(sourcePostNumber);

        // Sunucuda devam eden veya üretilmiş bir durum var mı kontrol et
        ajax(`/sorumatik/ai-generations/by-source/${sourcePostId}`, { ignoreUncaught: true })
          .then((res) => {
            if (activeChannel !== channel || !res) return;

            if (res.state === "completed" && res.post_id) {
              const posts = topic.get("postStream.posts") || [];
              const hasBot = posts.some(
                (p) => (p.get ? p.get("username") : p.username)?.toLowerCase() === botUsername
              );
              if (hasBot) {
                cleanupCurrentSession();
                return;
              }
            }

            if (res.state === "failed") {
              cleanupCurrentSession();
              return;
            }

            if (res.raw) {
              ensureCardElement(sourcePostNumber);
              renderLiveText(res.raw, res.done === true || res.state === "completed");
              if (res.done === true || res.state === "completed") {
                handleComplete(topic.get("postStream"));
              }
            } else if (res.state === "queued" || res.state === "generating" || res.state === "persisting") {
              ensureCardElement(sourcePostNumber);
            }
          })
          .catch(() => {});

        // MessageBus canlı yayınını dinle
        if (messageBus) {
          messageBus.subscribe(channel, (data) => {
            if (activeChannel !== channel || !data) return;

            ensureCardElement(sourcePostNumber);

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
          }, -1);
        }
      }

      let pageChangeCheckTimer = null;

      function inspectTopicAndAttach(retries = 20) {
        if (pageChangeCheckTimer) {
          clearTimeout(pageChangeCheckTimer);
          pageChangeCheckTimer = null;
        }

        const topicController = api.container.lookup("controller:topic");
        const topic = topicController?.get("model");
        if (!topic) {
          if (retries > 0) {
            pageChangeCheckTimer = setTimeout(() => inspectTopicAndAttach(retries - 1), 100);
          }
          return;
        }

        const postStream = topic.get("postStream");
        const posts = postStream?.get("posts") || [];

        // Botun cevabı zaten konuya kalıcı olarak eklenmişse canlı karta gerek yok
        const hasExistingBotReply = posts.some(
          (p) => (p.get ? p.get("username") : p.username)?.toLowerCase() === botUsername
        );
        if (hasExistingBotReply) {
          cleanupCurrentSession();
          return;
        }

        // İlk post ID'sini güvenilir kaynaklardan al
        const pending = topic.get("sorumatik_pending_generation");
        const firstPostId =
          pending?.source_post_id ||
          topic.get("first_post_id") ||
          postStream?.get("firstPostId") ||
          postStream?.get("stream.firstObject") ||
          postStream?.stream?.[0] ||
          (posts.length > 0 ? (posts[0].get ? posts[0].get("id") : posts[0].id) : null);

        if (!firstPostId) {
          if (retries > 0) {
            pageChangeCheckTimer = setTimeout(() => inspectTopicAndAttach(retries - 1), 150);
          }
          return;
        }

        attachToGeneration(topic, firstPostId, 1);
      }

      api.onPageChange((url) => {
        // Topic sayfası kontrolü: /t/:slug/:id
        if (!url || !url.includes("/t/")) {
          if (pageChangeCheckTimer) {
            clearTimeout(pageChangeCheckTimer);
            pageChangeCheckTimer = null;
          }
          cleanupCurrentSession();
          return;
        }

        inspectTopicAndAttach(20);
      });
    });
  }
};
