import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

const iconSetMock = new Proxy({}, { get: () => () => null });

let discoveredModels = [];
let savedUpdates = [];

const env = await createDomTestEnv({
  mocks: {
    "@liveagent/ui/components/IconSet": iconSetMock,
    [fileURLToPath(new URL("../../../agent-ui/src/components/IconSet.tsx", import.meta.url))]:
      iconSetMock,
    "../../agent-ui-adapters/providerSettings": {
      discoverProviderModels: async (input) => discoveredModels(input),
    },
    "../kbrain/providerSettings": {
      appProvidersFromKBrain: (doc) => doc.providers,
      kBrainSettingsUpdateFromLegacyProviders: (_prev, next, selected) => ({
        defaultProvider: selected?.customProviderId ?? "",
        defaultModel: selected?.model ?? "",
        providers: next,
      }),
      saveKBrainProviderSettings: async (update) => {
        savedUpdates.push(update);
        return {
          defaultProvider: update.defaultProvider || update.providers[0]?.id || "",
          defaultModel: update.defaultModel || update.providers[0]?.models?.[0]?.id || "",
          providers: update.providers,
        };
      },
    },
  },
});

const custom = env.loadModule("@liveagent/ui/lib/custom/lszCustomization.ts");
const sync = env.loadModule("src/lib/custom/lszProviderSync.ts");
const settingsMod = env.loadModule("src/lib/settings/index.ts");
const { ProviderCredentialRow } = env.loadModule(
  "@liveagent/ui/pages/settings/ProviderCredentialRow.tsx",
);

test("LszAgent brand and security switches are configured", () => {
  assert.equal(custom.LSZ_APP_NAME, "LszAgent");
  assert.equal(custom.LSZ_DISABLE_API_KEY_REVEAL, true);
  assert.equal(custom.LSZ_DISABLE_AUTO_UPDATE, false);
  assert.equal(custom.LSZ_BUILTIN_PROVIDER.baseUrl, "http://142.91.102.27:8317/v1");
});

test("ProviderCredentialRow hides the eye reveal button and keeps input masked", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = env.createRoot(host);
  try {
    await env.act(async () =>
      root.render(
        env.React.createElement(ProviderCredentialRow, {
          viewModel: {
            apiKey: "••••••••",
            apiKeyIsRedactedDisplay: true,
            geminiApiPlatform: "aistudio",
            geminiApiPlatformIsLocked: false,
            providerType: "codex",
            requestFormat: "openai-responses",
            revealApiKeyError: null,
            revealingApiKey: false,
            selectGeminiApiPlatform: () => {},
            setApiKey: () => {},
            setRequestFormat: () => {},
            showApiKey: true,
            t: (key) => key,
            toggleShowApiKey: async () => {},
          },
        }),
      ),
    );
    const input = host.querySelector("#modal-apikey");
    assert.equal(input.type, "password", "input stays masked even if showApiKey were true");
    assert.equal(
      input.parentElement.querySelectorAll("button").length,
      0,
      "no eye toggle button is rendered inside the API key field",
    );
  } finally {
    await env.act(async () => root.unmount());
    host.remove();
  }
});

test("built-in provider seeds once, avoids forcing a default model, and syncs dynamic upstream models while preserving user providers", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  savedUpdates = [];
  discoveredModels = () => [
    settingsMod.createProviderModelConfig("codex", "dynamic-model-a"),
    settingsMod.createProviderModelConfig("codex", "dynamic-model-b"),
  ];

  // 1. Fresh boot seeds lsz-builtin while keeping user's custom providers intact
  const userProvider = {
    id: "user-own-provider",
    name: "My Own Relay",
    type: "claude_code",
    baseUrl: "https://user-relay.example.com",
    isFullUrl: false,
    apiKey: "",
    apiKeyConfigured: true,
    models: [settingsMod.createProviderModelConfig("claude_code", "claude-sonnet-4-5")],
    activeModels: ["claude-sonnet-4-5"],
    reasoning: "off",
    promptCachingEnabled: true,
    nativeWebSearchEnabled: true,
    useSystemProxy: false,
    usageQuery: settingsMod.getDefaultUsageQueryConfig(),
  };

  const seeded = await sync.ensureLszBuiltinProviderSeeded({
    document: { defaultProvider: "", defaultModel: "", providers: [userProvider] },
    providers: [userProvider],
  });
  assert.equal(seeded.providers.length, 2);
  assert.equal(seeded.providers[0].id, "lsz-builtin");
  assert.equal(seeded.providers[1].id, "user-own-provider");

  // Even if K-brain filled defaultProvider/defaultModel alphabetically, no model is selected before user picks one
  assert.equal(
    sync.resolveLszEffectiveSelectedModel({
      customProviderId: "lsz-builtin",
      model: "dynamic-model-a",
    }),
    undefined,
  );

  // Once user explicitly chooses a model, their selection sticks
  sync.recordLszModelSelectionChange(undefined, {
    customProviderId: "lsz-builtin",
    model: "dynamic-model-b",
  });
  assert.deepEqual(
    sync.resolveLszEffectiveSelectedModel({
      customProviderId: "lsz-builtin",
      model: "dynamic-model-b",
    }),
    { customProviderId: "lsz-builtin", model: "dynamic-model-b" },
  );

  // 2. Periodic sync updates lsz-builtin when upstream rotates models (drops dynamic-model-b, adds dynamic-model-c)
  let currentSettings = settingsMod.normalizeSettings({
    ...settingsMod.getDefaultSettings(),
    customProviders: seeded.providers,
    selectedModel: { customProviderId: "lsz-builtin", model: "dynamic-model-b" },
  });
  const settingsRef = { current: currentSettings };
  const setSettings = (updater) => {
    currentSettings = settingsMod.normalizeSettings(updater(currentSettings));
    settingsRef.current = currentSettings;
  };

  discoveredModels = () => [
    settingsMod.createProviderModelConfig("codex", "dynamic-model-a"),
    settingsMod.createProviderModelConfig("codex", "dynamic-model-c"),
  ];
  await sync.syncUpstreamProviderModelsOnce(settingsRef, setSettings);

  const updatedBuiltin = currentSettings.customProviders.find((p) => p.id === "lsz-builtin");
  assert.deepEqual(updatedBuiltin.activeModels, ["dynamic-model-a", "dynamic-model-c"]);
  assert.equal(
    currentSettings.selectedModel,
    undefined,
    "removed upstream model clears stale selection cleanly",
  );
  assert.equal(
    currentSettings.customProviders.find((p) => p.id === "user-own-provider")?.activeModels[0],
    "claude-sonnet-4-5",
    "user-added provider remains untouched",
  );
});
