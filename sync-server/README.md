# RustDesk Address Book Sync Server

Append-only log server that stores opaque encrypted blobs keyed by subscription GUID.

## Quick Start

```
cargo run -- --port 3001 --db sync.db
```

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port`, `-p` | `8080` | Port to listen on |
| `--bind`, `-b` | `0.0.0.0` | Bind address |
| `--db`, `-d` | `sync.db` | Path to SQLite database file |

## API

### Pull Changes

```
GET /sync/{guid}?after={id}
```

Returns all changes for the given GUID with ID greater than `after` (default `0`).

**Response:**
```json
{
  "changes": [
    { "id": 1, "data": "base64-encoded-encrypted-blob" },
    { "id": 2, "data": "base64-encoded-encrypted-blob" }
  ]
}
```

### Push Change

```
POST /sync/{guid}
Content-Type: application/json

{ "data": "base64-encoded-encrypted-blob" }
```

**Response:**
```json
{ "id": 3 }
```

## How It Works

- The `guid` in the URL acts as both the subscription identifier and the auth token — anyone who knows the GUID can read/write.
- All data is end-to-end encrypted by the client (AES-256-GCM + Argon2id KDF). The server never decrypts anything.
- Each POST appends one entry to an SQLite table. Each GET returns entries after a cursor (`after` parameter).
- Clients pull first, then push. The returned `id` values serve as cursors for the next pull.

## Client Subscription URL

When adding a subscription in the app, use:

```
http://localhost:3001/sync/{guid}
```

Where `{guid}` is any unique string (e.g. a UUID). All clients sharing the same GUID and master key will sync with each other.

