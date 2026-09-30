use crate::db::schema::DeviceColorCalibrations;
use sea_orm_migration::prelude::*;

pub struct DeviceCalibrationBrightness;

impl MigrationName for DeviceCalibrationBrightness {
    fn name(&self) -> &str {
        "m20260930000001_device_calibration_brightness"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for DeviceCalibrationBrightness {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(DeviceColorCalibrations::Table)
                    .add_column(
                        ColumnDef::new(DeviceColorCalibrations::BrightnessPoints)
                            .text()
                            .not_null()
                            .default("[]"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(DeviceColorCalibrations::Table)
                    .drop_column(DeviceColorCalibrations::BrightnessPoints)
                    .to_owned(),
            )
            .await
    }
}
