import type { CodexRequestFormat, ProviderId } from "../settings/types";

/**
 * Centralized customization config for LszAgent.
 * Keeping brand, security switches, and built-in endpoint settings in one standalone
 * module minimizes touchpoints in upstream files for conflict-free git rebases/merges.
 */
export const LSZ_APP_NAME = "LszAgent";

/** Disables the "eye" button and secret-reveal endpoints for API keys in Settings. */
export const LSZ_DISABLE_API_KEY_REVEAL = true;

/** Disables automatic/manual update checks and release announcements when set to true. */
export const LSZ_DISABLE_AUTO_UPDATE = false;

/** Periodic interval (5 minutes) for refreshing upstream `/models` in the background. */
export const LSZ_MODEL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum gap (60 seconds) between focus/online-triggered model refreshes. */
export const LSZ_MODEL_SYNC_MIN_GAP_MS = 60 * 1000;

/** Set to true if user-added providers should also auto-poll `/models` periodically. */
const LSZ_AUTO_SYNC_USER_PROVIDERS = false;

type ViteImportMetaEnv = {
  VITE_LSZ_BASE_URL?: string;
  VITE_LSZ_API_KEY?: string;
  VITE_LSZ_PROVIDER_NAME?: string;
};

function readViteEnv(): ViteImportMetaEnv {
  try {
    return ((import.meta as unknown as { env?: ViteImportMetaEnv }).env ?? {}) as ViteImportMetaEnv;
  } catch {
    return {};
  }
}

const env = readViteEnv();

// String.fromCharCode(0x9ed8, 0x8ba4, 0x63a5, 0x53e3) === "默认接口"
const DEFAULT_PROVIDER_NAME_ZH = String.fromCharCode(0x9ed8, 0x8ba4, 0x63a5, 0x53e3);

export const LSZ_BUILTIN_PROVIDER = {
  id: "lsz-builtin",
  nameZh: env.VITE_LSZ_PROVIDER_NAME?.trim() || DEFAULT_PROVIDER_NAME_ZH,
  nameEn: env.VITE_LSZ_PROVIDER_NAME?.trim() || "Default API",
  type: "codex" as ProviderId,
  requestFormat: "openai-responses" as CodexRequestFormat,
  baseUrl: env.VITE_LSZ_BASE_URL?.trim() || "http://142.91.102.27:8317/v1",
  apiKey: env.VITE_LSZ_API_KEY?.trim() || "sk-MkSxLRCJmliAoW7QarmxL2FtcHos7C4KmV0fe4CkzdWmfVoD",
  fallbackModelIds: [
    "gpt-6.2-astra",
    "gpt-6.2-sol",
    "gpt-6.1-terra",
    "gpt-6.1-sol",
    "gpt-6-chat-thinking",
    "gpt-6-astra",
    "gpt-6-luna",
    "gpt-6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "codex-auto-review",
    "grok-4.7",
    "grok-4.7-build-fast",
    "grok-4.6",
    "grok-4.5",
    "grok-4.3",
    "grok-4.20-0309-reasoning",
    "grok-4.20-0309-non-reasoning",
    "grok-4.20-multi-agent-0309",
    "grok-3-mini",
    "grok-3-mini-fast",
    "grok-build-0.1",
    "grok-composer-2.5-fast",
    "MiniMax M3.1 Flash Free",
    "MiMo 2.6 Pro Free",
    "MiMo 2.6 Flash Free",
    "GLM 5.3 Flash Free",
    "DeepSeek V4.1 Flash 1017 Free",
    "Qwen 3.8 Flash Free",
    "GPT-6 Luna Free",
    "DeepAI Cyber Free",
    "Solar Mini 4 Free",
    "Glyph Cluster Free",
    "muse-ember",
    "gpt-image-2.6",
    "gpt-image-2.5",
    "gpt-image-2",
    "gpt-image-1.5",
    "grok-imagine-image-2.0",
    "grok-imagine-image-quality",
    "grok-imagine-image",
  ] as readonly string[],
} as const;

const BUILTIN_SEEDED_STORAGE_KEY = "lszagent.builtin-provider-seeded.v1";
const USER_SELECTED_MODEL_STORAGE_KEY = "lszagent.user-selected-model.v1";

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function shouldAutoSyncProviderModels(provider: {
  id: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
}): boolean {
  const hasKey = provider.apiKeyConfigured === true || Boolean(provider.apiKey?.trim());
  if (!provider.baseUrl.trim() || !hasKey) return false;
  if (LSZ_AUTO_SYNC_USER_PROVIDERS) return true;
  return (
    provider.id === LSZ_BUILTIN_PROVIDER.id ||
    normalizeUrl(provider.baseUrl) === normalizeUrl(LSZ_BUILTIN_PROVIDER.baseUrl)
  );
}

export function readLszBuiltinSeeded(): boolean {
  try {
    return globalThis.localStorage?.getItem(BUILTIN_SEEDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLszBuiltinSeeded(): void {
  try {
    globalThis.localStorage?.setItem(BUILTIN_SEEDED_STORAGE_KEY, "1");
  } catch {}
}

export function isLszUserModelSelected(): boolean {
  try {
    return globalThis.localStorage?.getItem(USER_SELECTED_MODEL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLszUserModelSelected(): void {
  try {
    globalThis.localStorage?.setItem(USER_SELECTED_MODEL_STORAGE_KEY, "1");
  } catch {}
}

export function clearLszUserModelSelected(): void {
  try {
    globalThis.localStorage?.removeItem(USER_SELECTED_MODEL_STORAGE_KEY);
  } catch {}
}
