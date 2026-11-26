import {
  clearLszUserModelSelected,
  isLszUserModelSelected,
  LSZ_BUILTIN_PROVIDER,
  LSZ_MODEL_SYNC_INTERVAL_MS,
  LSZ_MODEL_SYNC_MIN_GAP_MS,
  markLszBuiltinSeeded,
  markLszUserModelSelected,
  readLszBuiltinSeeded,
  shouldAutoSyncProviderModels,
} from "@liveagent/ui/lib/custom/lszCustomization";
import { mergeFetchedModels } from "@liveagent/ui/pages/settings/providerUtils";
import { type MutableRefObject, useEffect, useRef } from "react";
import { discoverProviderModels } from "../../agent-ui-adapters/providerSettings";
import {
  appProvidersFromKBrain,
  kBrainSettingsUpdateFromLegacyProviders,
  saveKBrainProviderSettings,
} from "../kbrain/providerSettings";
import type { KBrainSettingsDocument } from "../kbrain/types";
import {
  type AppSettings,
  type CustomProvider,
  createProviderModelConfig,
  getDefaultUsageQueryConfig,
  type ProviderModelConfig,
  type SelectedModel,
  updateCustomProviders,
} from "../settings";

function buildFallbackModels(): ProviderModelConfig[] {
  return LSZ_BUILTIN_PROVIDER.fallbackModelIds.map((id) =>
    createProviderModelConfig(LSZ_BUILTIN_PROVIDER.type, id),
  );
}

function createBuiltinProviderRecord(models: ProviderModelConfig[]): CustomProvider {
  return {
    id: LSZ_BUILTIN_PROVIDER.id,
    name: LSZ_BUILTIN_PROVIDER.nameZh,
    type: LSZ_BUILTIN_PROVIDER.type,
    requestFormat: LSZ_BUILTIN_PROVIDER.requestFormat,
    baseUrl: LSZ_BUILTIN_PROVIDER.baseUrl,
    isFullUrl: false,
    apiKey: LSZ_BUILTIN_PROVIDER.apiKey,
    apiKeyConfigured: true,
    models,
    activeModels: models.map((model) => model.id),
    reasoning: "off",
    promptCachingEnabled: true,
    nativeWebSearchEnabled: true,
    useSystemProxy: false,
    usageQuery: getDefaultUsageQueryConfig(),
  };
}

/**
 * Ensures the built-in third-party provider is seeded on fresh profiles (including browser/WebUI
 * or relocated data dirs) without overwriting existing user providers or resurrecting a provider
 * the user deliberately deleted.
 */
export async function ensureLszBuiltinProviderSeeded(input: {
  document: KBrainSettingsDocument;
  providers: CustomProvider[];
}): Promise<{ document: KBrainSettingsDocument; providers: CustomProvider[] }> {
  const { document, providers } = input;
  const alreadyPresent = providers.some((provider) => provider.id === LSZ_BUILTIN_PROVIDER.id);
  if (alreadyPresent) {
    markLszBuiltinSeeded();
    return input;
  }
  if (readLszBuiltinSeeded()) {
    return input;
  }

  let models: ProviderModelConfig[];
  try {
    const discovered = await discoverProviderModels({
      providerId: LSZ_BUILTIN_PROVIDER.id,
      type: LSZ_BUILTIN_PROVIDER.type,
      requestFormat: LSZ_BUILTIN_PROVIDER.requestFormat,
      baseUrl: LSZ_BUILTIN_PROVIDER.baseUrl,
      apiKey: LSZ_BUILTIN_PROVIDER.apiKey,
      useSystemProxy: false,
      isFullUrl: false,
    });
    models = discovered.length > 0 ? discovered : buildFallbackModels();
  } catch {
    models = buildFallbackModels();
  }

  const builtin = createBuiltinProviderRecord(models);
  const existingSelected =
    document.defaultProvider && document.defaultModel
      ? { customProviderId: document.defaultProvider, model: document.defaultModel }
      : undefined;

  try {
    const saved = await saveKBrainProviderSettings(
      kBrainSettingsUpdateFromLegacyProviders(providers, [builtin, ...providers], existingSelected),
    );
    markLszBuiltinSeeded();
    return { document: saved, providers: appProvidersFromKBrain(saved) };
  } catch (error) {
    console.warn("LszAgent built-in provider seed failed", error);
    return input;
  }
}

/**
 * Prevents K-brain's automatic alphabetical defaultModel fallback from locking a model before the
 * user has ever picked one. Once the user explicitly chooses any model, their choice persists.
 */
export function resolveLszEffectiveSelectedModel(
  selectedModel: SelectedModel | undefined,
): SelectedModel | undefined {
  if (!selectedModel) return undefined;
  if (selectedModel.customProviderId !== LSZ_BUILTIN_PROVIDER.id) {
    markLszUserModelSelected();
    return selectedModel;
  }
  return isLszUserModelSelected() ? selectedModel : undefined;
}

export function recordLszModelSelectionChange(
  prev: SelectedModel | undefined,
  next: SelectedModel | undefined,
): void {
  if (!next) return;
  if (!prev || prev.customProviderId !== next.customProviderId || prev.model !== next.model) {
    markLszUserModelSelected();
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function reconcileSyncedProviderModels(
  provider: CustomProvider,
  fetched: ProviderModelConfig[],
): CustomProvider | null {
  if (fetched.length === 0) return null;

  const fetchedIds = new Set(fetched.map((model) => model.id));
  const prevKnownIds = new Set(provider.models.map((model) => model.id));
  const prevActiveIds = new Set(provider.activeModels);
  const isStrictDynamicEndpoint = provider.id === LSZ_BUILTIN_PROVIDER.id;

  const mergedAll = mergeFetchedModels(fetched, provider.models);
  const nextModels = isStrictDynamicEndpoint
    ? mergedAll.filter((model) => fetchedIds.has(model.id))
    : mergedAll;

  const nextActiveModels: string[] = [];
  for (const model of nextModels) {
    const wasKnown = prevKnownIds.has(model.id);
    const shouldBeActive = wasKnown ? prevActiveIds.has(model.id) : true;
    if (shouldBeActive) nextActiveModels.push(model.id);
  }

  const prevModelIds = provider.models.map((model) => model.id);
  const nextModelIds = nextModels.map((model) => model.id);
  if (
    sameStringList(prevModelIds, nextModelIds) &&
    sameStringList(provider.activeModels, nextActiveModels)
  ) {
    return null;
  }

  return {
    ...provider,
    models: nextModels,
    ...(provider.modelOrder
      ? {
          modelOrder: provider.modelOrder.filter((id) =>
            nextModels.some((model) => model.id === id),
          ),
        }
      : {}),
    activeModels: nextActiveModels,
  };
}

export async function syncUpstreamProviderModelsOnce(
  settingsRef: MutableRefObject<AppSettings>,
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void,
): Promise<void> {
  const snapshot = settingsRef.current;
  const targets = snapshot.customProviders.filter(shouldAutoSyncProviderModels);
  if (targets.length === 0) return;

  const updatesById = new Map<string, ProviderModelConfig[]>();
  await Promise.all(
    targets.map(async (provider) => {
      try {
        const models = await discoverProviderModels({
          providerId: provider.id,
          type: provider.type,
          requestFormat: provider.requestFormat,
          baseUrl: provider.baseUrl,
          // Stored credential on K-brain is reused when apiKey is empty.
          apiKey: provider.apiKey?.trim() ? provider.apiKey.trim() : "",
          useSystemProxy: provider.useSystemProxy,
          isFullUrl: provider.isFullUrl,
          modelsUrl: provider.modelsUrl,
          customHeaders: provider.customHeaders,
        });
        if (models.length > 0) {
          updatesById.set(provider.id, models);
        }
      } catch {
        // Silent: transient upstream outage must never disrupt active chat sessions.
      }
    }),
  );

  if (updatesById.size === 0) return;

  setSettings((prev) => {
    let anyChanged = false;
    const nextProviders = prev.customProviders.map((provider) => {
      const fetched = updatesById.get(provider.id);
      if (!fetched) return provider;
      const updated = reconcileSyncedProviderModels(provider, fetched);
      if (!updated) return provider;
      anyChanged = true;
      return updated;
    });
    if (!anyChanged) return prev;

    const next = updateCustomProviders(prev, nextProviders);
    if (prev.selectedModel && !next.selectedModel) {
      clearLszUserModelSelected();
    }
    return next;
  });
}

/**
 * Periodically pulls upstream `/models` in the background (on startup, interval, window focus, and
 * network recovery) so dynamic model catalogs stay fresh without manual refreshes.
 */
export function useLszPeriodicModelSync(options: {
  enabled: boolean;
  settingsRef: MutableRefObject<AppSettings>;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}): void {
  const { enabled, settingsRef, setSettings } = options;
  const inFlightRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let disposed = false;

    const triggerSync = (respectMinGap: boolean) => {
      if (disposed || inFlightRef.current) return;
      const now = Date.now();
      if (respectMinGap && now - lastSyncAtRef.current < LSZ_MODEL_SYNC_MIN_GAP_MS) {
        return;
      }
      inFlightRef.current = true;
      lastSyncAtRef.current = now;
      void syncUpstreamProviderModelsOnce(settingsRef, setSettings).finally(() => {
        inFlightRef.current = false;
      });
    };

    const initialTimer = window.setTimeout(() => triggerSync(false), 2_500);
    const intervalTimer = window.setInterval(() => triggerSync(false), LSZ_MODEL_SYNC_INTERVAL_MS);
    const onFocus = () => triggerSync(true);
    const onOnline = () => triggerSync(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, setSettings, settingsRef]);
}
