import { apiInitializer } from "discourse/lib/api";
import I18n from "I18n";

const CTA_CLASS = "sorumatik-video-solution-cta";
const IOS_RETURN_WAIT_MS = 1500;

export default apiInitializer("1.8.0", (api) => {
  const androidStoreUrl =
    settings.android_store_url || "https://play.google.com/store/apps/details?id=com.sorumatik";
  const iosStoreUrl = settings.ios_store_url || "https://apps.apple.com/app/sorumatik/id6474668271";

  function t(key, fallback) {
    let value = null;
    try {
      value = I18n.t(themePrefix(key));
    } catch (_) {}
    const missing = !value || (value.startsWith("[") && value.endsWith("]"));
    return missing ? fallback : value;
  }

  function platform() {
    const agent = navigator.userAgent || "";
    if (/android/i.test(agent)) return "android";
    const isTouchMac = /macintosh/i.test(agent) && navigator.maxTouchPoints > 1;
    return /iphone|ipad|ipod/i.test(agent) || isTouchMac ? "ios" : "desktop";
  }

  function link(label, href) {
    const anchor = document.createElement("a");
    anchor.className = "sorumatik-video-solution-link";
    anchor.textContent = label;
    anchor.href = href;
    return anchor;
  }

  // Android falls back to the store by itself; iOS stays on this page when
  // the app is missing, so the store opens only if the page was not left.
  function appLink(topicId) {
    const label = t("sorumatik_ai.video_solution_watch", "🎬 Video Çözüm Var");
    const path = `t/${topicId}?action=blackboard`;
    if (platform() === "android") {
      const fallback = encodeURIComponent(androidStoreUrl);
      return link(
        label,
        `intent://${path}#Intent;scheme=sorumatik;package=com.sorumatik;S.browser_fallback_url=${fallback};end`,
      );
    }
    const anchor = link(label, `sorumatik://${path}`);
    anchor.addEventListener("click", () => {
      window.setTimeout(() => {
        if (document.visibilityState === "visible") window.location.href = iosStoreUrl;
      }, IOS_RETURN_WAIT_MS);
    });
    return anchor;
  }

  function buildCta(topicId) {
    const cta = document.createElement("div");
    cta.className = CTA_CLASS;

    const hint = document.createElement("span");
    hint.className = "sorumatik-video-solution-hint";

    if (platform() === "desktop") {
      hint.textContent = t(
        "sorumatik_ai.video_solution_desktop_hint",
        "Bu sorunun video çözümü var. Uygulamada ücretsiz izleyebilirsin.",
      );
      cta.append(
        hint,
        link(t("sorumatik_ai.download_android", "🤖 Android İndir"), androidStoreUrl),
        link(t("sorumatik_ai.download_ios", "🍎 iOS İndir"), iosStoreUrl),
      );
    } else {
      hint.textContent = t("sorumatik_ai.video_solution_hint", "Uygulamada ücretsiz izle");
      cta.append(appLink(topicId), hint);
    }
    return cta;
  }

  api.decorateCookedElement(
    (element, helper) => {
      const post = helper?.getModel?.();
      if (post?.post_number !== 1 || post.topic?.has_blackboard_solution !== true) return;
      if (element.querySelector(`.${CTA_CLASS}`)) return;
      element.append(buildCta(post.topic_id));
    },
    { id: "sorumatik-video-solution", onlyStream: true },
  );
});
