use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::storage::StorageBackend;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct File {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub size: i64,
    pub storage_key: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UploadFile {
    pub name: String,
    // file content will be multipart/form-data
}

pub struct FileService<B: StorageBackend> {
    storage: B,
    pool: sqlx::PgPool,
}

impl<B: StorageBackend> FileService<B> {
    pub fn new(storage: B, pool: sqlx::PgPool) -> Self {
        Self { storage, pool }
    }

    pub async fn upload(&self, project_id: Uuid, name: String, data: Vec<u8>) -> Result<File> {
        let storage_key = self
            .storage
            .put(&name, &data)
            .await
            .map_err(|e| Error::Storage(e.to_string()))?;

        let file = sqlx::query_as::<_, File>(
            r#"
            INSERT INTO files (project_id, name, size, storage_key)
            VALUES ($1, $2, $3, $4)
            RETURNING id, project_id, name, size, storage_key, created_at
            "#,
        )
        .bind(project_id)
        .bind(&name)
        .bind(data.len() as i64)
        .bind(&storage_key)
        .fetch_one(&self.pool)
        .await
        .map_err(Error::Sqlx)?;

        Ok(file)
    }

    pub async fn download(&self, id: Uuid) -> Result<(String, Vec<u8>)> {
        let file = sqlx::query_as::<_, File>(
            r#"
            SELECT id, project_id, name, size, storage_key, created_at
            FROM files
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Error::Sqlx)?
        .ok_or_else(|| Error::NotFound(format!("File with id {} not found", id)))?;

        let data = self
            .storage
            .get(&file.storage_key)
            .await
            .map_err(|e| Error::Storage(e.to_string()))?;

        Ok((file.name, data))
    }
}

async fn upload_file(
    State((pool, storage)): State<(sqlx::PgPool, impl StorageBackend)>,
    Path(_project_id): Path<Uuid>,
    // TODO: implement multipart extraction
) -> Result<Json<File>> {
    let _service = FileService::new(storage, pool);
    // Placeholder: need actual multipart handling
    Err(Error::Internal)
}

async fn download_file(
    State((pool, storage)): State<(sqlx::PgPool, impl StorageBackend)>,
    Path(id): Path<Uuid>,
) -> Result<Vec<u8>> {
    let service = FileService::new(storage, pool);
    let (_name, data) = service.download(id).await?;
    // TODO: set proper Content-Disposition header
    Ok(data)
}

pub fn router<B: StorageBackend + Clone + Send + Sync + 'static>() -> Router<(sqlx::PgPool, B)> {
    Router::new()
        .route("/:project_id", post(upload_file))
        .route("/:id", get(download_file))
}
