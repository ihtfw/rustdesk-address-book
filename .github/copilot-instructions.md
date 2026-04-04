# Project Guidelines

## Tech Stack

- **Client**: Tauri v2 (Rust backend) + React 19 + TypeScript 5.8 + Vite 7
- **Sync server**: Axum 0.8 + SQLite
- **Encryption**: AES-256-GCM + Argon2id KDF
- **Languages**: Russian and English (i18n required for all UI strings)

## Code Style

- Rust: standard rustfmt, `#[serde(default)]` on new optional fields for backward compat
- TypeScript: Prettier, no semicolons in JSX expressions, functional React components with hooks
- CSS: plain CSS in `src/styles/`, CSS variables for theming

## Architecture

- `src-tauri/src/commands.rs` — all Tauri command handlers
- `src-tauri/src/models.rs` — data types, must stay in sync with `src/types.ts`
- `src/api.ts` — thin `invoke()` wrappers, one per Tauri command
- `src/i18n/` — `index.ts` (interface), `en.ts`, `ru.ts` (all keys required in both)
- `sync-server/src/main.rs` — single-file Axum server

## Build and Test

```
cargo check --manifest-path src-tauri/Cargo.toml   # Client backend
cargo check --manifest-path sync-server/Cargo.toml  # Sync server
cargo test --manifest-path src-tauri/Cargo.toml      # Rust tests
npx tsc --noEmit                                     # TypeScript check
npx tauri dev                                        # Dev mode
npx tauri build                                      # Production build
```

## Conventions

- Every new Tauri command must be registered in `src-tauri/src/lib.rs`
- Every user-facing string needs entries in both `en.ts` and `ru.ts`
- Sync data uses blob format: `[4B version][22B salt][12B nonce][ciphertext]`
- Use key caching (`make_key`/`encrypt_with_key`) to avoid repeated Argon2id KDF calls
- Subscriptions have `permissions` field (`admin`/`rw`/`ro`) — respect in UI
- Git branch: `feat/sync` for sync-related work
