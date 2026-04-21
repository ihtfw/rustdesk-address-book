use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, delete},
    Json, Router,
};
use clap::Parser;
use rand::Rng;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tracing::{info, warn, error};
use tracing_subscriber::fmt::writer::MakeWriterExt;

// ── CLI ──

#[derive(Parser)]
#[command(name = "rustdesk-address-book-sync", about = "Sync server for RustDesk Address Book")]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "8080")]
    port: u16,

    /// Bind address
    #[arg(short, long, default_value = "0.0.0.0")]
    bind: String,

    /// Path to SQLite database file
    #[arg(short, long, default_value = "sync.db")]
    db: String,

    /// Directory for log files (default: current directory)
    #[arg(long, default_value = ".")]
    log_dir: String,
}

// ── Types ──

type Db = Arc<Mutex<Connection>>;

#[derive(Deserialize)]
struct PullQuery {
    #[serde(default)]
    after: u64,
}

#[derive(Serialize)]
struct PullResponse {
    changes: Vec<PullEntry>,
}

#[derive(Serialize)]
struct PullEntry {
    id: u64,
    data: String,
}

#[derive(Deserialize)]
struct PushRequest {
    data: String,
}

#[derive(Serialize)]
struct PushResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    admin_token: Option<String>,
}

// ── Token management types ──

#[derive(Deserialize)]
struct CreateTokenRequest {
    label: String,
    permissions: String, // "rw" or "ro"
}

#[derive(Serialize)]
struct CreateTokenResponse {
    id: u64,
    token: String,
    label: String,
    permissions: String,
}

#[derive(Serialize)]
struct TokenInfo {
    id: u64,
    label: String,
    permissions: String,
    created_at: String,
    revoked: bool,
}

#[derive(Serialize)]
struct TokenListResponse {
    tokens: Vec<TokenInfo>,
}

// ── Auth ──

#[derive(Debug, Clone, PartialEq)]
enum Role {
    Admin,
    ReadWrite,
    ReadOnly,
}

struct AuthResult {
    role: Option<Role>,
    channel_exists: bool,
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let val = headers.get("authorization")?.to_str().ok()?;
    let token = val.strip_prefix("Bearer ")
        .or_else(|| val.strip_prefix("bearer "))?;
    Some(token.trim().to_string())
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    hex::encode(bytes)
}

/// Check bearer token against channel's admin_token and access_tokens.
/// Returns role if authenticated, None if no valid token.
fn authenticate(conn: &Connection, guid: &str, token: Option<&str>) -> AuthResult {
    // Check if channel exists
    let channel_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM channels WHERE guid = ?1",
            rusqlite::params![guid],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    let Some(token) = token else {
        return AuthResult { role: None, channel_exists };
    };

    // Check admin_token
    let is_admin: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM channels WHERE guid = ?1 AND admin_token = ?2",
            rusqlite::params![guid, token],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if is_admin {
        return AuthResult { role: Some(Role::Admin), channel_exists };
    }

    // Check access_tokens
    let access_role = conn
        .query_row(
            "SELECT permissions FROM access_tokens WHERE guid = ?1 AND token = ?2 AND revoked = 0",
            rusqlite::params![guid, token],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|p| match p.as_str() {
            "ro" => Role::ReadOnly,
            _ => Role::ReadWrite,
        });

    AuthResult { role: access_role, channel_exists }
}

// ── Handlers ──

async fn pull(
    Path(guid): Path<String>,
    Query(query): Query<PullQuery>,
    headers: HeaderMap,
    State(db): State<Db>,
) -> Result<Json<PullResponse>, AppError> {
    let start = std::time::Instant::now();
    let conn = db.lock().await;

    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());

    // If channel exists, require a valid token
    if auth.channel_exists && auth.role.is_none() {
        warn!(guid = %guid, "pull: unauthorized");
        return Err(AppError::Status(StatusCode::UNAUTHORIZED, "Authentication required".to_string()));
    }

    let mut stmt = conn
        .prepare("SELECT id, data FROM changes WHERE guid = ?1 AND id > ?2 ORDER BY id")
        .map_err(AppError::Db)?;

    let changes = stmt
        .query_map(rusqlite::params![guid, query.after], |row| {
            Ok(PullEntry {
                id: row.get(0)?,
                data: row.get(1)?,
            })
        })
        .map_err(AppError::Db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Db)?;

    let elapsed = start.elapsed();
    info!(guid = %guid, after = query.after, changes = changes.len(), elapsed_ms = elapsed.as_millis(), "pull");
    Ok(Json(PullResponse { changes }))
}

async fn push(
    Path(guid): Path<String>,
    headers: HeaderMap,
    State(db): State<Db>,
    Json(body): Json<PushRequest>,
) -> Result<Json<PushResponse>, AppError> {
    let start = std::time::Instant::now();
    let data_len = body.data.len();
    let conn = db.lock().await;

    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());

    let mut admin_token_out: Option<String> = None;

    if auth.channel_exists {
        // Channel exists — require Admin or ReadWrite
        match auth.role {
            Some(Role::Admin) | Some(Role::ReadWrite) => {}
            Some(Role::ReadOnly) => {
                warn!(guid = %guid, "push: read-only token");
                return Err(AppError::Status(StatusCode::FORBIDDEN, "Read-only access".to_string()));
            }
            None => {
                warn!(guid = %guid, "push: unauthorized");
                return Err(AppError::Status(StatusCode::UNAUTHORIZED, "Authentication required".to_string()));
            }
        }
    } else {
        // Channel doesn't exist — lazy creation
        let new_admin_token = generate_token();
        conn.execute(
            "INSERT INTO channels (guid, admin_token, created_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params![guid, new_admin_token],
        )
        .map_err(AppError::Db)?;
        info!(guid = %guid, "push: channel created (lazy)");
        admin_token_out = Some(new_admin_token);
    }

    // If data is empty this is a channel-creation-only request — skip inserting a change row
    let id = if body.data.is_empty() {
        0
    } else {
        conn.execute(
            "INSERT INTO changes (guid, data, created_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params![guid, body.data],
        )
        .map_err(AppError::Db)?;
        conn.last_insert_rowid() as u64
    };
    let elapsed = start.elapsed();
    info!(guid = %guid, id = id, data_bytes = data_len, elapsed_ms = elapsed.as_millis(), "push");
    Ok(Json(PushResponse { id, admin_token: admin_token_out }))
}

// ── Token management handlers ──

async fn create_token(
    Path(guid): Path<String>,
    headers: HeaderMap,
    State(db): State<Db>,
    Json(body): Json<CreateTokenRequest>,
) -> Result<Json<CreateTokenResponse>, AppError> {
    let conn = db.lock().await;

    // Admin only
    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());
    if auth.role != Some(Role::Admin) {
        return Err(AppError::Status(StatusCode::FORBIDDEN, "Admin access required".to_string()));
    }

    // Validate permissions
    if body.permissions != "rw" && body.permissions != "ro" {
        return Err(AppError::Status(StatusCode::BAD_REQUEST, "permissions must be 'rw' or 'ro'".to_string()));
    }

    let new_token = generate_token();
    conn.execute(
        "INSERT INTO access_tokens (guid, token, label, permissions, created_at, revoked) VALUES (?1, ?2, ?3, ?4, datetime('now'), 0)",
        rusqlite::params![guid, new_token, body.label, body.permissions],
    )
    .map_err(AppError::Db)?;

    let id = conn.last_insert_rowid() as u64;
    info!(guid = %guid, token_id = id, label = %body.label, permissions = %body.permissions, "token created");

    Ok(Json(CreateTokenResponse {
        id,
        token: new_token,
        label: body.label,
        permissions: body.permissions,
    }))
}

async fn list_tokens(
    Path(guid): Path<String>,
    headers: HeaderMap,
    State(db): State<Db>,
) -> Result<Json<TokenListResponse>, AppError> {
    let conn = db.lock().await;

    // Admin only
    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());
    if auth.role != Some(Role::Admin) {
        return Err(AppError::Status(StatusCode::FORBIDDEN, "Admin access required".to_string()));
    }

    let mut stmt = conn
        .prepare("SELECT id, label, permissions, created_at, revoked FROM access_tokens WHERE guid = ?1 ORDER BY id")
        .map_err(AppError::Db)?;

    let tokens = stmt
        .query_map(rusqlite::params![guid], |row| {
            Ok(TokenInfo {
                id: row.get(0)?,
                label: row.get(1)?,
                permissions: row.get(2)?,
                created_at: row.get(3)?,
                revoked: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(AppError::Db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Db)?;

    Ok(Json(TokenListResponse { tokens }))
}

async fn revoke_token(
    Path((guid, token_id)): Path<(String, u64)>,
    headers: HeaderMap,
    State(db): State<Db>,
) -> Result<StatusCode, AppError> {
    let conn = db.lock().await;

    // Admin only
    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());
    if auth.role != Some(Role::Admin) {
        return Err(AppError::Status(StatusCode::FORBIDDEN, "Admin access required".to_string()));
    }

    let rows = conn
        .execute(
            "UPDATE access_tokens SET revoked = 1 WHERE id = ?1 AND guid = ?2",
            rusqlite::params![token_id, guid],
        )
        .map_err(AppError::Db)?;

    if rows == 0 {
        return Err(AppError::Status(StatusCode::NOT_FOUND, "Token not found".to_string()));
    }

    info!(guid = %guid, token_id = token_id, "token revoked");
    Ok(StatusCode::OK)
}

// ── Permissions check ──

#[derive(Serialize)]
struct MeResponse {
    permissions: String,
}

async fn me(
    Path(guid): Path<String>,
    headers: HeaderMap,
    State(db): State<Db>,
) -> Result<Json<MeResponse>, AppError> {
    let conn = db.lock().await;
    let token = extract_bearer(&headers);
    let auth = authenticate(&conn, &guid, token.as_deref());

    if !auth.channel_exists {
        // Channel doesn't exist yet — caller will become admin on first push
        return Ok(Json(MeResponse { permissions: "admin".to_string() }));
    }

    match auth.role {
        Some(Role::Admin) => Ok(Json(MeResponse { permissions: "admin".to_string() })),
        Some(Role::ReadWrite) => Ok(Json(MeResponse { permissions: "rw".to_string() })),
        Some(Role::ReadOnly) => Ok(Json(MeResponse { permissions: "ro".to_string() })),
        None => Err(AppError::Status(StatusCode::UNAUTHORIZED, "Authentication required".to_string())),
    }
}

// ── Error handling ──

enum AppError {
    Db(rusqlite::Error),
    Status(StatusCode, String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            AppError::Db(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {e}")),
            AppError::Status(s, m) => (*s, m.clone()),
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            error!("{}", msg);
        }
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

// ── Main ──

fn init_db(path: &str) -> Connection {
    let conn = Connection::open(path).expect("Failed to open database");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_changes_guid_id ON changes (guid, id);

        CREATE TABLE IF NOT EXISTS channels (
            guid TEXT PRIMARY KEY,
            admin_token TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS access_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT 'rw',
            created_at TEXT NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_access_tokens_token ON access_tokens (token);
        CREATE INDEX IF NOT EXISTS idx_access_tokens_guid ON access_tokens (guid);",
    )
    .expect("Failed to initialize database");
    conn
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Rolling daily log file, keep last 10 days
    let file_appender = tracing_appender::rolling::daily(&cli.log_dir, "sync-server.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::fmt()
        .with_writer(non_blocking.and(std::io::stdout))
        .with_ansi(false)
        .with_target(false)
        .init();

    // Clean up old log files (keep last 10 days)
    cleanup_old_logs(&cli.log_dir, 10);

    let conn = init_db(&cli.db);
    let db: Db = Arc::new(Mutex::new(conn));

    let app = Router::new()
        .route("/sync/{guid}", get(pull).post(push))
        .route("/sync/{guid}/tokens", get(list_tokens).post(create_token))
        .route("/sync/{guid}/tokens/{token_id}", delete(revoke_token))
        .route("/sync/{guid}/me", get(me))
        .layer(CorsLayer::permissive())
        .with_state(db);

    let addr = format!("{}:{}", cli.bind, cli.port);
    info!("Sync server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server error");
}

fn cleanup_old_logs(dir: &str, keep_days: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(keep_days * 86400);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("sync-server.log.") { continue; }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}
