use serde_json::json;
use std::fs;
use std::path::Path;

pub const APP_NAME: &str = "LszAgent";
pub const DISABLE_AUTO_UPDATE: bool = false;
pub const UPDATE_REPOSITORY: &str = "lszdevlop/LszAgent";

const BUILTIN_PROVIDER_ID: &str = "lsz-builtin";
const BUILTIN_PROVIDER_NAME: &str = "默认接口";
const BUILTIN_BASE_URL: &str = "http://142.91.102.27:8317/v1";
const BUILTIN_API_KEY: &str = "sk-MkSxLRCJmliAoW7QarmxL2FtcHos7C4KmV0fe4CkzdWmfVoD";

const FALLBACK_MODELS: &[&str] = &[
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
];

pub fn prepare_kbrain_backend_dir(backend_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(backend_dir)
        .map_err(|_| "Unable to create K-brain data root".to_string())?;
    ensure_initial_kbrain_config(backend_dir);
    Ok(())
}

/// Seeds `config.json` before `k-brain` boots on a brand-new installation so `defaultProvider` and
/// `defaultModel` remain empty (`""`) while the built-in provider is immediately ready out-of-the-box.
/// Never touches an existing `config.json` (and skips isolated unit-test fixtures).
pub fn ensure_initial_kbrain_config(backend_dir: &Path) {
    #[cfg(test)]
    {
        let _ = backend_dir;
        return;
    }

    #[cfg(not(test))]
    {
        if std::env::var_os("LIVEAGENT_SKIP_BUILTIN_PROVIDER").is_some() {
            return;
        }
        let config_path = backend_dir.join("config.json");
        if config_path.exists() {
            return;
        }
        let base_url = option_env!("LSZ_BUILTIN_BASE_URL")
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(BUILTIN_BASE_URL);
        let api_key = option_env!("LSZ_BUILTIN_API_KEY")
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(BUILTIN_API_KEY);

        let models: Vec<serde_json::Value> = FALLBACK_MODELS
            .iter()
            .map(|id| {
                json!({
                    "id": id,
                    "contextWindow": 200000,
                    "maxTokens": 32768,
                    "limitsSource": "fallback"
                })
            })
            .collect();

        let payload = json!({
            "defaultModel": "",
            "defaultProvider": "",
            "providers": {
                BUILTIN_PROVIDER_ID: {
                    "name": BUILTIN_PROVIDER_NAME,
                    "type": "codex",
                    "baseUrl": base_url,
                    "api": "openai-responses",
                    "apiKey": api_key,
                    "activeModels": FALLBACK_MODELS,
                    "metadata": {
                        "kbrainProviderOrder": 0
                    },
                    "models": models
                }
            }
        });

        if let Ok(serialized) = serde_json::to_vec_pretty(&payload) {
            let tmp_path = backend_dir.join("config.json.seed.tmp");
            if fs::write(&tmp_path, serialized).is_ok() {
                let _ = fs::rename(&tmp_path, &config_path);
            }
        }
    }
}
