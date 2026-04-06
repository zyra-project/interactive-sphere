# Desktop App Plan — Tauri

## Overview

Package the existing interactive-sphere web app as a native desktop application using Tauri v2, while preserving the current Cloudflare Pages web deployment. Both targets share the same TypeScript source and Vite build output. The desktop app adds offline capability, persistent local caching, and optional local LLM support.

## Why Tauri

| Consideration | Tauri | Electron |
|---|---|---|
| App shell size | ~5-10 MB | ~150 MB |
| Runtime memory | ~60-100 MB | ~200-400 MB |
| Backend language | Rust | Node.js |
| WebView | OS-native (WebView2, WKWebView) | Bundled Chromium |
| Security model | Capability-based permissions | Full Node.js access by default |
| Mobile support | Tauri v2 (iOS/Android) | Not supported |

Tauri is the better fit because the app has zero Node.js dependencies, minimal backend needs (tile fetching, caching, API proxy), and benefits from a small installer size for museum/exhibit distribution. The main tradeoff is OS webview variance — the custom WebGL2 multi-pass rendering in `earthTileLayer.ts` must be validated on all target platforms early.

## Repository Structure

Tauri is additive. No existing files are modified. The `src-tauri/` directory is the only new top-level addition:

```
interactive-sphere/
├── src/                        # Existing web app (unchanged)
├── src-tauri/                  # NEW — Tauri desktop app
│   ├── Cargo.toml              #   Rust dependencies
│   ├── Cargo.lock
│   ├── tauri.conf.json         #   Window config, app metadata, build hooks
│   ├── capabilities/           #   Permission policies (network, fs, etc.)
│   ├── icons/                  #   App icons (all platforms)
│   └── src/
│       ├── main.rs             #   Entry point
│       ├── tile_cache.rs       #   Local tile cache (SHA-256 flat-file)
│       ├── keychain.rs         #   OS keychain for API key storage
│       ├── download_manager.rs #   Offline dataset download manager
│       └── download_commands.rs#   Tauri commands for download operations
├── public/                     # Shared static assets
├── functions/                  # Cloudflare Functions (web deploy only)
├── vite.config.ts              # Shared Vite config
├── package.json                # Add @tauri-apps/cli as dev dependency
└── dist/                       # Vite output — consumed by both targets
```

## Package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "dev:desktop": "tauri dev",
    "build": "tsc && vite build",
    "build:desktop": "tsc && vite build && tauri build",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`tauri dev` launches Vite's dev server and opens a native window pointing at it. Hot reload works as normal.

## Web vs. Desktop: What Diverges

The TypeScript source is 100% shared. Divergence is handled at runtime via `window.__TAURI__` (injected automatically by Tauri) or at build time via separate entry points.

### Service Worker

The web app registers `sw.js` for tile caching. The desktop app skips it — Tauri's Rust backend handles caching instead.

```typescript
// main.ts — add one guard to existing SW registration
if ('serviceWorker' in navigator && !window.__TAURI__) {
  navigator.serviceWorker.register('/sw.js');
}
```

### Tile Fetching

| Concern | Web | Desktop |
|---|---|---|
| Tile proxy | Cloudflare Function (`/api/tile/`) | Tauri command → Rust HTTP client |
| Cache layer 1 | Service Worker (Cache API) | SHA-256 flat-file cache |
| Cache layer 2 | Cloudflare Edge (1-year TTL) | N/A (local cache is sufficient) |
| Cache layer 3 | MapLibre in-memory LRU | MapLibre in-memory LRU (unchanged) |

The desktop tile cache flow:

```
MapLibre tile request
  → Tauri protocol handler intercepts /api/tile/*
  → Check SHA-256 flat-file cache (hash of path → cached file)
  → Hit: return from local filesystem
  → Miss: fetch from gibs.earthdata.nasa.gov, store locally, return
```

No Cloudflare proxy needed — the desktop app fetches directly from GIBS since there are no CORS restrictions in a native context.

### LLM API Proxy

| Concern | Web | Desktop |
|---|---|---|
| Proxy | Cloudflare Function (`/api/chat/completions`) | Tauri command → direct API call |
| API key storage | Server-side (CF environment variable) | OS keychain via `tauri-plugin-keyring` |
| Fallback | Local keyword engine | Local keyword engine (unchanged) |
| Optional | — | Local LLM via Ollama sidecar |

### Bundled Assets (Optional)

The desktop installer can include the 170 low-zoom tiles (z0-z3, ~6 MB) so the globe renders immediately on first launch with no network. The web app continues to fetch these on demand via the preloader.

## CI/CD: Parallel Pipelines

Both targets build from the same repo. The web deploy and desktop builds are independent CI jobs:

```
push to main
  │
  ├── Job: web-deploy
  │     npm run build
  │     → Deploy dist/ to Cloudflare Pages
  │
  └── Job: desktop-build (matrix)
        ├── ubuntu-latest   → .deb, .AppImage
        ├── macos-latest    → .dmg
        └── windows-latest  → .msi, .exe
        npm run build:desktop
        → tauri-apps/tauri-action → GitHub Release
```

Tauri's official GitHub Action (`tauri-apps/tauri-action@v0`) handles:
- Cross-platform compilation (Rust + frontend)
- Code signing (macOS notarization, Windows Authenticode)
- Auto-updater manifest generation
- Upload to GitHub Releases

The web deploy job (`npm run build` + Cloudflare Pages) is completely unchanged.

## Desktop-Specific Features (Post-MVP)

Features that become possible (or significantly better) with a native shell:

| Feature | Benefit |
|---|---|
| **Persistent tile cache** | Tiles survive across sessions with no browser quota limits |
| **Bundled base tiles** | Instant cold start, partial offline support |
| **Unlimited cache size** | Cache entire tile pyramids for offline use |
| **Local LLM (Ollama)** | Orbit works fully offline with a small local model |
| **Native file export** | Save screenshots, dataset metadata, session logs to disk |
| **Kiosk mode** | Fullscreen, no chrome — ideal for museum/exhibit deployments |
| **Multi-monitor exhibit** | Spawn multiple windows across displays — e.g., globe on a large screen, controls/dataset info on a second monitor. Tauri v2 exposes `available_monitors()`, per-monitor positioning, and multiple `WebviewWindow` instances sharing app state |
| **Offline video datasets** | Download Vimeo-hosted dataset videos (MP4) for fully offline playback. The video proxy already returns direct MP4 links at multiple quality levels; the existing `loadDirect()` path handles MP4 playback. Rust backend manages downloads with progress/pause/resume, stores in a local library with metadata index. UI shows download manager, quality selection (720p/1080p/4K), and storage budget. Ideal for exhibit pre-loading a curated dataset collection |
| **System tray** | Background tile prefetching, update notifications |
| **Secure key storage** | API keys in OS keychain instead of localStorage |
| **Auto-updater** | Built-in Tauri updater with delta updates |
| **Deep linking** | `sos://dataset/INTERNAL_SOS_768` opens the app to a specific dataset |

## Risk Mitigation

### WebGL2 on OS Webviews

The custom multi-pass WebGL2 rendering (`earthTileLayer.ts`) is the highest-risk component. It uses framebuffer captures, additive blending passes, and custom shaders.

**Mitigation:** Build a minimal Tauri app in Phase 1 that loads only the MapLibre globe + earthTileLayer. Test on:
- Windows 10/11 (WebView2 — Chromium-based, low risk)
- macOS 13+ (WKWebView — WebKit-based, medium risk for WebGL2 edge cases)
- Ubuntu 22.04+ (WebKitGTK — highest risk, least common target)

### OS Webview Version Skew

Unlike Electron (bundled Chromium), Tauri depends on the user's OS webview version.

**Mitigation:**
- Windows: WebView2 auto-updates via Edge — effectively evergreen
- macOS: WKWebView updates with OS — target macOS 13+ (Safari 16+, full WebGL2)
- Linux: Require WebKitGTK 2.40+ in package dependencies

### Rust Learning Curve

Backend code (tile cache, API proxy) requires Rust.

**Mitigation:** The Rust surface area is small — HTTP client (`reqwest`), filesystem caching, and Tauri command handlers. No complex async orchestration or unsafe code needed.

## Implementation Phases

### Phase 1: Scaffold + WebGL Validation (1-2 weeks)

- Initialize `src-tauri/` with `cargo tauri init`
- Configure `tauri.conf.json` to point at Vite dev server
- Add `dev:desktop` and `build:desktop` scripts
- Validate MapLibre globe + earthTileLayer renders correctly on all target platforms
- Gate/no-gate: if WebGL2 rendering fails on any target, evaluate workarounds before proceeding

### Phase 2: Local Tile Cache (1 week)

- Implement Rust tile fetcher (direct GIBS access, no CF proxy needed)
- SHA-256 flat-file cache for tiles (hash of path → local file)
- Tauri protocol handler to intercept `/api/tile/*` requests
- Add `__TAURI__` guard to skip SW registration
- Optional: bundle z0-z3 tiles in the installer

### Phase 3: LLM Proxy + API Key Management (1 week)

- Tauri command for `/api/chat/completions` (direct API call from Rust)
- API key stored in OS keychain via `tauri-plugin-keyring`
- Settings UI updated to detect desktop mode and show key management
- Local keyword engine continues to work as fallback (unchanged)

### Phase 4: CI/CD + Distribution (1 week)

- GitHub Actions workflow: matrix build (Linux, macOS, Windows)
- Code signing setup (macOS notarization, Windows Authenticode)
- Auto-updater configuration
- GitHub Releases as distribution channel

#### Implementation details

**Workflows:**
- `desktop.yml` — CI builds on push/PR to main (artifacts only, no release)
- `release.yml` — triggered by `v*` tags or manual dispatch; builds all platforms, signs with Tauri updater key, creates a draft GitHub Release with `latest.json` for auto-updates

**Auto-updater flow:**
1. App launches → `checkForUpdates()` in `main.ts` calls `@tauri-apps/plugin-updater`
2. Plugin fetches `latest.json` from the latest GitHub Release
3. If a newer version exists, a native dialog prompts the user to update
4. Update downloads, verifies signature against the public key in `tauri.conf.json`, and installs

**Setup steps (one-time, required before first release):**

1. Generate a Tauri signing keypair:
   ```bash
   npx tauri signer generate -w ~/.tauri/interactive-sphere.key
   ```
   This prints a **public key** and saves a **private key** to the file.

2. Copy the public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

3. Add two GitHub repository secrets (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/interactive-sphere.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose during generation

4. (Optional) macOS notarization — add these secrets when you have an Apple Developer certificate:
   - `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
   - `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

5. (Optional) Windows Authenticode — sign the MSI/EXE with a code signing certificate. Not required for distribution but suppresses SmartScreen warnings.

**Release process:**
```bash
# Bump version in src-tauri/tauri.conf.json and package.json
# Commit, then tag:
git tag v0.2.0
git push origin v0.2.0
# → release.yml builds all platforms and creates a draft release
# → Review the draft on GitHub, then publish it
```

### Phase 5: Desktop-Only Features (ongoing)

- Kiosk mode for exhibit deployments
- Offline mode (bundled tiles + local engine)
- Local LLM integration (Ollama sidecar)
- Native file export (screenshots, data)
- Deep linking protocol handler

## Dependencies to Add

### npm (dev only)
```
@tauri-apps/cli          # Tauri CLI (build, dev, init)
@tauri-apps/api          # JS bindings for Tauri commands (invoke, event, etc.)
```

### Cargo (src-tauri/)
```
tauri                    # Core framework
tauri-plugin-keyring     # OS keychain access
reqwest                  # HTTP client (tile fetching, API proxy)
sha2 / hex               # SHA-256 hashing for tile cache filenames
serde / serde_json       # Serialization
```
