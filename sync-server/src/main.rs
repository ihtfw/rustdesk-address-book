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

    Ok(Json(PullResponse { changes }))
}

async fn push(
    Path(guid): Path<String>,
    State(db): State<Db>,
    Json(body): Json<PushRequest>,
) -> Result<Json<PushResponse>, AppError> {
    let conn = db.lock().await;
    conn.execute(
        "INSERT INTO changes (guid, data, created_at) VALUES (?1, ?2, datetime('now'))",
        rusqlite::params![guid, body.data],
    )
    .map_err(AppError::Db)?;

    let id = conn.last_insert_rowid() as u64;
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

    let conn = init_db(&cli.db);
    let db: Db = Arc::new(Mutex::new(conn));

    let app = Router::new()
        .route("/sync/{guid}", get(pull).post(push))
        .layer(CorsLayer::permissive())
        .with_state(db);

    let addr = format!("{}:{}", cli.bind, cli.port);
    println!("Sync server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server error");
}
