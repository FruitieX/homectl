use super::*;
use crate::core::color_calibration::{ColorCalibrationAssignment, ColorCalibrationProfile};
use sea_orm::sea_query;
use sea_orm::sea_query::{Expr, Iden, OnConflict, Order, Query};
use sea_orm::TransactionSession;

#[derive(Clone, Copy, Iden)]
pub enum CalibrationProfiles {
    Table,
    Id,
    Config,
}
#[derive(Clone, Copy, Iden)]
pub enum CalibrationAssignments {
    Table,
    DeviceKey,
    ProfileId,
}

pub async fn profiles<C: ConnectionTrait>(db: &C) -> Result<Vec<ColorCalibrationProfile>> {
    all(
        db,
        Query::select()
            .column(CalibrationProfiles::Config)
            .from(CalibrationProfiles::Table)
            .order_by(CalibrationProfiles::Id, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| {
        let json: String = row.try_get("", "config")?;
        Ok(serde_json::from_str(&json)?)
    })
    .collect()
}
pub async fn assignments<C: ConnectionTrait>(db: &C) -> Result<Vec<ColorCalibrationAssignment>> {
    all(
        db,
        Query::select()
            .columns([
                CalibrationAssignments::DeviceKey,
                CalibrationAssignments::ProfileId,
            ])
            .from(CalibrationAssignments::Table)
            .order_by(CalibrationAssignments::DeviceKey, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| {
        Ok(ColorCalibrationAssignment {
            device_key: row.try_get("", "device_key")?,
            profile_id: row.try_get("", "profile_id")?,
        })
    })
    .collect()
}

pub async fn save_profile<C: ConnectionTrait>(
    db: &C,
    profile: &ColorCalibrationProfile,
) -> Result<()> {
    profile.validate().map_err(|error| eyre!(error))?;
    execute(
        db,
        Query::insert()
            .into_table(CalibrationProfiles::Table)
            .columns([CalibrationProfiles::Id, CalibrationProfiles::Config])
            .values_panic([
                Expr::value(profile.id.clone()),
                Expr::value(serde_json::to_string(profile)?),
            ])
            .on_conflict(
                OnConflict::column(CalibrationProfiles::Id)
                    .update_column(CalibrationProfiles::Config)
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;
    Ok(())
}

pub async fn assign<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    keys: &[String],
    profile_id: Option<&str>,
) -> Result<()> {
    let txn = db.begin().await?;
    assign_in_transaction(&txn, keys, profile_id).await?;
    txn.commit().await?;
    Ok(())
}

/// Profile creation/update and its assignments are one persistence operation.
/// A failed assignment must not leave a newly created or changed profile behind.
pub async fn save_and_assign<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    profile: Option<&ColorCalibrationProfile>,
    keys: &[String],
    profile_id: Option<&str>,
) -> Result<()> {
    let txn = db.begin().await?;
    if let Some(profile) = profile {
        save_profile(&txn, profile).await?;
    }
    assign_in_transaction(&txn, keys, profile_id).await?;
    txn.commit().await?;
    Ok(())
}

async fn assign_in_transaction<C: ConnectionTrait>(
    db: &C,
    keys: &[String],
    profile_id: Option<&str>,
) -> Result<()> {
    for key in keys {
        // A profile assignment supersedes any older per-device calibration.
        delete_by_string_key(
            db,
            DeviceColorCalibrations::Table,
            DeviceColorCalibrations::DeviceKey,
            key,
        )
        .await?;
        delete_by_string_key(
            db,
            CalibrationAssignments::Table,
            CalibrationAssignments::DeviceKey,
            key,
        )
        .await?;
        if let Some(id) = profile_id {
            execute(
                db,
                Query::insert()
                    .into_table(CalibrationAssignments::Table)
                    .columns([
                        CalibrationAssignments::DeviceKey,
                        CalibrationAssignments::ProfileId,
                    ])
                    .values_panic([Expr::value(key.clone()), Expr::value(id)])
                    .to_owned(),
            )
            .await?;
        }
    }
    Ok(())
}

pub async fn save_assignment<C: ConnectionTrait>(
    db: &C,
    assignment: &ColorCalibrationAssignment,
) -> Result<()> {
    execute(
        db,
        Query::insert()
            .into_table(CalibrationAssignments::Table)
            .columns([
                CalibrationAssignments::DeviceKey,
                CalibrationAssignments::ProfileId,
            ])
            .values_panic([
                Expr::value(assignment.device_key.clone()),
                Expr::value(assignment.profile_id.clone()),
            ])
            .on_conflict(
                OnConflict::column(CalibrationAssignments::DeviceKey)
                    .update_column(CalibrationAssignments::ProfileId)
                    .to_owned(),
            )
            .to_owned(),
    )
    .await?;

    Ok(())
}

pub async fn import<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &ConfigExport,
) -> Result<()> {
    config
        .validate_calibration_profiles()
        .map_err(|error| eyre!(error))?;
    let txn = db.begin().await?;
    execute(
        &txn,
        Query::delete()
            .from_table(CalibrationAssignments::Table)
            .to_owned(),
    )
    .await?;
    execute(
        &txn,
        Query::delete()
            .from_table(CalibrationProfiles::Table)
            .to_owned(),
    )
    .await?;
    for profile in &config.color_calibration_profiles {
        save_profile(&txn, profile).await?;
    }
    for row in &config.color_calibration_assignments {
        execute(
            &txn,
            Query::insert()
                .into_table(CalibrationAssignments::Table)
                .columns([
                    CalibrationAssignments::DeviceKey,
                    CalibrationAssignments::ProfileId,
                ])
                .values_panic([
                    Expr::value(row.device_key.clone()),
                    Expr::value(row.profile_id.clone()),
                ])
                .to_owned(),
        )
        .await?;
    }
    txn.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{Database, DatabaseConnection};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;

    async fn database() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn calibration_editor_profile_and_assignment_commit_or_roll_back_together() {
        let db = database().await;
        let mut profile: ColorCalibrationProfile = serde_json::from_value(json!({
            "id": "combined", "name": "Combined", "brightness": 0.5,
            "points": [{"reference":{"u":0.20,"v":0.47},"output":{"u":0.21,"v":0.48}}],
            "brightness_points": [{"logical":0.1,"output":0.2},{"logical":1,"output":0.9}]
        }))
        .unwrap();
        let keys = vec!["dummy/a".to_string(), "dummy/b".to_string()];
        save_and_assign(&db, Some(&profile), &keys, Some(&profile.id))
            .await
            .unwrap();
        let before =
            serde_json::to_value(db_export_config_from_connection(&db).await.unwrap()).unwrap();
        assert_eq!(
            before["color_calibration_profiles"][0]["brightness_points"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            before["color_calibration_assignments"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        // Fail after the profile update and the first assignment write, proving
        // rollback includes both collections rather than only validation.
        db.execute_unprepared("CREATE TRIGGER reject_second_assignment BEFORE INSERT ON calibration_assignments WHEN NEW.device_key = 'dummy/b' BEGIN SELECT RAISE(ABORT, 'injected assignment failure'); END").await.unwrap();
        profile.name = "Must not stick".into();
        assert!(
            save_and_assign(&db, Some(&profile), &keys, Some(&profile.id))
                .await
                .is_err()
        );
        assert_eq!(
            serde_json::to_value(db_export_config_from_connection(&db).await.unwrap()).unwrap(),
            before
        );
        profile.id = "new-profile".into();
        assert!(
            save_and_assign(&db, Some(&profile), &keys, Some(&profile.id))
                .await
                .is_err()
        );
        assert_eq!(
            profiles(&db).await.unwrap().len(),
            1,
            "no orphan profile after failure"
        );
        db.execute_unprepared("DROP TRIGGER reject_second_assignment")
            .await
            .unwrap();
        save_and_assign(&db, None, &keys[..1], None).await.unwrap();
        assert_eq!(profiles(&db).await.unwrap().len(), 1);
        let remaining = assignments(&db).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].device_key, "dummy/b");
    }

    #[tokio::test]
    async fn profiles_and_assignments_round_trip_and_failed_batch_rolls_back() {
        let db = database().await;
        let profile: ColorCalibrationProfile = serde_json::from_value(json!({
            "id":"warm-model", "name":"Warm model", "brightness":0.5, "reference_device_key":"dummy/reference",
            "points":[{"reference":{"u":0.20,"v":0.47},"output":{"u":0.21,"v":0.48}}]
        })).unwrap();
        save_profile(&db, &profile).await.unwrap();
        let keys = vec!["dummy/a".to_string(), "dummy/b".to_string()];
        assign(&db, &keys, Some(&profile.id)).await.unwrap();
        let export = db_export_config_from_connection(&db).await.unwrap();
        let encoded = serde_json::to_value(&export).unwrap();
        let restored: ConfigExport = serde_json::from_value(encoded.clone()).unwrap();
        let target = database().await;
        import(&target, &restored).await.unwrap();
        assert_eq!(
            serde_json::to_value(profiles(&target).await.unwrap()).unwrap(),
            encoded["color_calibration_profiles"]
        );
        assert_eq!(
            serde_json::to_value(assignments(&target).await.unwrap()).unwrap(),
            encoded["color_calibration_assignments"]
        );
        assert!(assign(&target, &keys, Some("missing-profile"))
            .await
            .is_err());
        assert_eq!(
            serde_json::to_value(assignments(&target).await.unwrap()).unwrap(),
            encoded["color_calibration_assignments"]
        );
        let mut legacy = encoded;
        legacy
            .as_object_mut()
            .unwrap()
            .remove("color_calibration_profiles");
        legacy
            .as_object_mut()
            .unwrap()
            .remove("color_calibration_assignments");
        let legacy: ConfigExport = serde_json::from_value(legacy).unwrap();
        assert!(legacy.color_calibration_profiles.is_empty());
        assert!(legacy.color_calibration_assignments.is_empty());
        import(&target, &legacy).await.unwrap();
        assert!(profiles(&target).await.unwrap().is_empty());
        assert!(assignments(&target).await.unwrap().is_empty());
    }
}
