use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use clap::Parser;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tracing::{info, error};
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
}

// ── Handlers ──

async fn pull(
    Path(guid): Path<String>,
    Query(query): Query<PullQuery>,
    State(db): State<Db>,
) -> Result<Json<PullResponse>, AppError> {
    let start = std::time::Instant::now();
    let conn = db.lock().await;
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
    State(db): State<Db>,
    Json(body): Json<PushRequest>,
) -> Result<Json<PushResponse>, AppError> {
    let start = std::time::Instant::now();
    let data_len = body.data.len();
    let conn = db.lock().await;
    conn.execute(
        "INSERT INTO changes (guid, data, created_at) VALUES (?1, ?2, datetime('now'))",
        rusqlite::params![guid, body.data],
    )
    .map_err(AppError::Db)?;

    let id = conn.last_insert_rowid() as u64;
    let elapsed = start.elapsed();
    info!(guid = %guid, id = id, data_bytes = data_len, elapsed_ms = elapsed.as_millis(), "push");
    Ok(Json(PushResponse { id }))
}

// ── Error handling ──

enum AppError {
    Db(rusqlite::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let msg = match &self {
            AppError::Db(e) => format!("Database error: {e}"),
        };
        error!("{}", msg);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": msg }))).into_response()
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
        CREATE INDEX IF NOT EXISTS idx_changes_guid_id ON changes (guid, id);",
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
