import { withPluginApi } from "discourse/lib/plugin-api";
import { default as apiInit } from "../api-initializers/sorumatik-ai-live-stream";

export default {
  name: "sorumatik-ai-live-stream",

  initialize() {
    withPluginApi("1.8.0", (api) => {
      // If apiInitializer has already executed, skip duplicate run
      if (window.__sorumatikLiveStreamInitialized) return;
      if (typeof apiInit === "function") {
        apiInit(api);
      }
    });
  },
};
