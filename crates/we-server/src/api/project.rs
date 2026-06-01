use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{delete, get, post, put},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{Error, Result};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    pub name: String,
    pub description: Option<String>,
}

impl CreateProject {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(Error::Validation(
                "Project name cannot be empty".to_string(),
            ));
        }
        if self.name.len() > 255 {
            return Err(Error::Validation(
                "Project name cannot exceed 255 characters".to_string(),
            ));
        }
        if let Some(desc) = &self.description
            && desc.len() > 4096 {
                return Err(Error::Validation(
                    "Project description cannot exceed 4096 characters".to_string(),
                ));
            }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub description: Option<String>,
}

impl UpdateProject {
    pub fn validate(&self) -> Result<()> {
        if let Some(name) = &self.name {
            if name.trim().is_empty() {
                return Err(Error::Validation(
                    "Project name cannot be empty".to_string(),
                ));
            }
            if name.len() > 255 {
                return Err(Error::Validation(
                    "Project name cannot exceed 255 characters".to_string(),
                ));
            }
        }
        if let Some(desc) = &self.description
            && desc.len() > 4096 {
                return Err(Error::Validation(
                    "Project description cannot exceed 4096 characters".to_string(),
                ));
            }
        Ok(())
    }
}

pub struct ProjectService {
    pool: PgPool,
}

impl ProjectService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create(&self, input: CreateProject) -> Result<Project> {
        input.validate()?;
        let project = sqlx::query_as::<_, Project>(
            r#"
            INSERT INTO projects (name, description)
            VALUES ($1, $2)
            RETURNING id, name, description, created_at, updated_at
            "#,
        )
        .bind(&input.name)
        .bind(&input.description)
        .fetch_one(&self.pool)
        .await
        .map_err(Error::Sqlx)?;

        Ok(project)
    }

    pub async fn get(&self, id: Uuid) -> Result<Project> {
        let project = sqlx::query_as::<_, Project>(
            r#"
            SELECT id, name, description, created_at, updated_at
            FROM projects
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Error::Sqlx)?
        .ok_or_else(|| Error::NotFound(format!("Project with id {} not found", id)))?;

        Ok(project)
    }

    pub async fn update(&self, id: Uuid, input: UpdateProject) -> Result<Project> {
        input.validate()?;
        let project = sqlx::query_as::<_, Project>(
            r#"
            UPDATE projects
            SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, description, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(&input.name)
        .bind(&input.description)
        .fetch_optional(&self.pool)
        .await
        .map_err(Error::Sqlx)?
        .ok_or_else(|| Error::NotFound(format!("Project with id {} not found", id)))?;

        Ok(project)
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM projects
            WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(Error::Sqlx)?;

        if result.rows_affected() == 0 {
            return Err(Error::NotFound(format!("Project with id {} not found", id)));
        }

        Ok(())
    }
}

async fn create_project(
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<CreateProject>,
) -> Result<Json<Project>> {
    let service = ProjectService::new(pool);
    let project = service.create(input).await?;
    Ok(Json(project))
}

async fn get_project(
    State(pool): State<sqlx::PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Project>> {
    let service = ProjectService::new(pool);
    let project = service.get(id).await?;
    Ok(Json(project))
}

async fn update_project(
    State(pool): State<sqlx::PgPool>,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateProject>,
) -> Result<Json<Project>> {
    let service = ProjectService::new(pool);
    let project = service.update(id, input).await?;
    Ok(Json(project))
}

async fn delete_project(State(pool): State<sqlx::PgPool>, Path(id): Path<Uuid>) -> Result<()> {
    let service = ProjectService::new(pool);
    service.delete(id).await?;
    Ok(())
}

pub fn router() -> Router<sqlx::PgPool> {
    Router::new()
        .route("/", post(create_project))
        .route("/:id", get(get_project))
        .route("/:id", put(update_project))
        .route("/:id", delete(delete_project))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_project_validate_rejects_blank_name() {
        let input = CreateProject {
            name: "   ".to_string(),
            description: None,
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project name cannot be empty"
        ));
    }

    #[test]
    fn test_create_project_validate_rejects_name_longer_than_255_chars() {
        let input = CreateProject {
            name: "a".repeat(256),
            description: None,
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project name cannot exceed 255 characters"
        ));
    }

    #[test]
    fn test_create_project_validate_rejects_description_longer_than_4096_chars() {
        let input = CreateProject {
            name: "Valid Project".to_string(),
            description: Some("d".repeat(4097)),
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project description cannot exceed 4096 characters"
        ));
    }

    #[test]
    fn test_create_project_validate_accepts_boundary_lengths() {
        let input = CreateProject {
            name: "a".repeat(255),
            description: Some("d".repeat(4096)),
        };

        assert!(input.validate().is_ok());
    }

    #[test]
    fn test_update_project_validate_rejects_blank_name() {
        let input = UpdateProject {
            name: Some(" \n\t ".to_string()),
            description: None,
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project name cannot be empty"
        ));
    }

    #[test]
    fn test_update_project_validate_rejects_name_longer_than_255_chars() {
        let input = UpdateProject {
            name: Some("a".repeat(256)),
            description: None,
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project name cannot exceed 255 characters"
        ));
    }

    #[test]
    fn test_update_project_validate_rejects_description_longer_than_4096_chars() {
        let input = UpdateProject {
            name: None,
            description: Some("d".repeat(4097)),
        };

        assert!(matches!(
            input.validate(),
            Err(Error::Validation(message)) if message == "Project description cannot exceed 4096 characters"
        ));
    }

    #[test]
    fn test_update_project_validate_accepts_empty_patch() {
        let input = UpdateProject {
            name: None,
            description: None,
        };

        assert!(input.validate().is_ok());
    }

    #[test]
    fn test_update_project_validate_accepts_boundary_lengths() {
        let input = UpdateProject {
            name: Some("a".repeat(255)),
            description: Some("d".repeat(4096)),
        };

        assert!(input.validate().is_ok());
    }
}
