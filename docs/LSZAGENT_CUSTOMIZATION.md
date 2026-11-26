# LszAgent 源码定制与上游同步说明

为保证后续同步上游仓库（`https://github.com/Stack-Cairn/LiveAgent`）时冲突最小，所有核心业务逻辑、品牌常量、内置供应商密钥与定时拉取逻辑均已抽离至 **3 个独立高内聚模块**，原仓库文件仅做 1～4 行的轻量挂载调用。

---

## 一、核心独立定制模块（上游永不触碰，升级零冲突）

1. **`crates/agent-ui/src/lib/custom/lszCustomization.ts`**
   - 全局配置中心（共享 UI、桌面端、WebUI 均可引用）：
     - `LSZ_APP_NAME = "LszAgent"`：软件品牌名。
     - `LSZ_DISABLE_API_KEY_REVEAL = true`：全局禁用设置页“小眼睛查看明文 API Key”及复制明文密钥。
     - `LSZ_DISABLE_AUTO_UPDATE = true`：全局关闭自动更新检测、更新公告弹窗及关于页更新入口。
     - `LSZ_BUILTIN_PROVIDER`：内置第三方接口配置（默认 `http://142.91.102.27:8317/v1` + 对应 `API Key`，支持通过构建环境变量 `VITE_LSZ_BASE_URL` / `VITE_LSZ_API_KEY` / `VITE_LSZ_PROVIDER_NAME` 覆盖）。
     - `LSZ_MODEL_SYNC_INTERVAL_MS = 5 * 60 * 1000`：后台定期拉取上游 `/models` 的间隔（默认 5 分钟，同时支持启动后、窗口切回前台、网络恢复时自动增量同步）。
     - `LSZ_AUTO_SYNC_USER_PROVIDERS = false`：是否对用户自行添加的供应商也执行后台轮询（默认仅轮询内置动态接口，不影响用户自己添加的自定义供应商）。

2. **`crates/agent-gui/src/lib/custom/lszProviderSync.ts`**
   - **首次启动自动注入内置供应商**：不锁定固定默认模型（用户未手动选模型前保持“选择模型”状态，同时满足首次引导 `isAlreadyConfigured` 条件自动跳过新手引导）。
   - **完全兼容用户自行添加供应商**：用户可在“设置 → 模型服务”自由新增、编辑、删除任意供应商。
   - **后台定期同步模型列表**（`useLszPeriodicModelSync`）：定期调用 K-brain 模型发现接口拉取上游最新模型列表，仅在模型列表发生实际增减时无感更新状态；若当前选中的模型被上游下线，自动清空失效选择。

3. **`crates/agent-gui/src-tauri/src/custom.rs`**
   - Rust 侧品牌常量 `APP_NAME`、自动更新总开关 `DISABLE_AUTO_UPDATE` 以及全新数据目录首次启动前的 `config.json` 预置逻辑（同样支持编译期环境变量 `LSZ_BUILTIN_BASE_URL` / `LSZ_BUILTIN_API_KEY` 覆盖）。

---

## 二、原仓库轻量挂载点清单（升级核对表）

| 功能点 | 挂载文件 | 改动说明 |
|---|---|---|
| 软件名称 `LszAgent` | `crates/agent-ui/src/i18n/hostTranslations.ts`<br>`crates/agent-gui/src/i18n/{config,startupTranslations}.ts`<br>`crates/agent-gui/index.html`、`trayMenu.ts`<br>`crates/agent-gui/src-tauri/tauri*.conf.json`、`Info.plist`、`Makefile`<br>`crates/agent-gui/src-tauri/src/{lib.rs,services/tray.rs}` | 读取 `LSZ_APP_NAME` / `custom::APP_NAME` 并将打包 `productName` 设为 `LszAgent`（完全未改动千行大词表 `enUSCommon` / `zhCNCommon`） |
| 禁用小眼睛查看明文 Key | `crates/agent-ui/src/pages/settings/{ProviderCredentialRow,ProviderModal,ProviderModalView,SttSection}.tsx`<br>`crates/agent-gui/src/agent-ui-adapters/providerSettings.tsx` | 依据 `LSZ_DISABLE_API_KEY_REVEAL` 隐藏眼睛按钮、锁定 `type="password"` 并拦截 `revealStoredProviderApiKey` |
| 内置接口 & 定期拉取模型 | `crates/agent-gui/src/lib/settings/storage.ts`<br>`crates/agent-gui/src/App.tsx`<br>`crates/agent-gui/src-tauri/src/services/kbrain_backend.rs` | 各挂载 1～2 行调用 `lszProviderSync` 与 `custom::ensure_initial_kbrain_config` |
| 关闭自动更新 | `crates/agent-gui/src/App.tsx`、`AboutSection.tsx`、`settingsSearch.ts`<br>`crates/agent-gui/src-tauri/src/commands/app/update.rs`、`services/tray.rs`<br>`crates/agent-gui/src-tauri/tauri.*.release.conf.json` | 依据 `LSZ_DISABLE_AUTO_UPDATE` / `DISABLE_AUTO_UPDATE` 彻底关闭网络检查与入口，并关闭 `.sig` 更新清单产物 |
| CI 自动构建安装包 | `.github/workflows/desktop-release.yml` | 产物名统一为 `LszAgent-*`，且无 Apple 证书或 Tauri 签名私钥时仍可正常打出全平台安装包 |

---

## 三、后续如何跟进上游同步更新

```bash
# 1. 首次添加上游远程仓库（仅需执行一次）
git remote add upstream https://github.com/Stack-Cairn/LiveAgent.git

# 2. 拉取上游最新代码并合并（或 rebase）
git fetch upstream main
git merge upstream/main
# 若更习惯线性历史，也可使用：git rebase upstream/main

# 3. 运行本地门禁校验确保升级后无异常
pnpm install --frozen-lockfile
pnpm check:ui-boundaries && pnpm typecheck:ui && pnpm typecheck:gui && pnpm lint
node --test crates/agent-gui/test/custom/lsz-customization.test.mjs
```

---

## 四、使用 GitHub Actions 一键编译全平台安装包

1. 将当前仓库推送到你自己的 GitHub **私有仓库**（因为内置了 API Key，建议使用 Private Repo，或者清空源码默认 Key 改在仓库 Settings → Secrets / Variables 中配置 `VITE_LSZ_API_KEY`、`LSZ_BUILTIN_API_KEY`）。
2. 打标签并推送即可自动触发 `.github/workflows/desktop-release.yml` 编译 Windows (`Setup.exe` / `.msi` / `portable.zip`)、macOS (`aarch64` / `x64`)、Linux (`AppImage` / `.deb` / `.rpm`)：
   ```bash
   git tag v2.0.39
   git push origin main --tags
   ```
