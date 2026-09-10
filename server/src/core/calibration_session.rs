//! Ephemeral physical-output overrides. Normal scene state keeps advancing and
//! is sent again when a session ends; previews never enter persisted devices.
use super::{
    color_calibration::{calibrated_device, ColorCalibrationPoint, DeviceColorCalibration},
    state::AppState,
};
use crate::types::{
    color::{DeviceColor, Hs},
    device::{Device, DeviceData},
    event::Event,
};
use serde::Deserialize;
use std::time::{Duration, Instant};

pub const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

pub struct CalibrationSession {
    pub target: Device,
    pub reference: Device,
    pub touched: Instant,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::event::{handle_event, tests::test_state};
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, DeviceId, ManageKind},
        integration::IntegrationId,
    };

    fn lamp(id: &str) -> Device {
        Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new(id),
            id.into(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                false,
                Some(0.5),
                Some(DeviceColor::new_from_hs(90, 0.3)),
                None,
                Capabilities {
                    hs: true,
                    ..Default::default()
                },
                ManageKind::Full,
            )),
            None,
        )
    }
    fn preview() -> CalibrationPreview {
        CalibrationPreview {
            target_key: "dummy/target".into(),
            reference_key: "dummy/reference".into(),
            reference: Hs {
                h: 30,
                s: 0.25.into(),
            },
            output: Hs {
                h: 45,
                s: 0.3.into(),
            },
            brightness: 0.5,
        }
    }

    #[tokio::test]
    async fn previews_ignore_existing_target_calibration_and_restore_current_runtime_state() {
        let (mut state, mut rx) = test_state();
        let target = lamp("target");
        let reference = lamp("reference");
        state.devices.set_state(&target, true, true);
        state.devices.set_state(&reference, true, true);
        state
            .runtime_config
            .device_color_calibrations
            .push(DeviceColorCalibration {
                device_key: "dummy/target".into(),
                points: vec![ColorCalibrationPoint {
                    reference: Hs {
                        h: 45,
                        s: 0.3.into(),
                    },
                    output: Hs {
                        h: 80,
                        s: 0.5.into(),
                    },
                }],
            });
        while rx.try_recv().is_ok() {}
        state
            .preview_calibration("session".into(), preview(), true)
            .unwrap();
        let physical = state.calibration_preview_device("dummy/target").unwrap();
        assert_eq!(
            physical.get_controllable_state().unwrap().color,
            Some(DeviceColor::new_from_hs(45, 0.3))
        );
        assert_eq!(
            state.devices.get_device(&target.get_device_key()).unwrap(),
            &target
        );
        // Even a preview queued before Cancel contains the logical color.
        while let Ok(event) = rx.try_recv() {
            if let Event::SetExternalState { device } = event {
                assert_eq!(
                    device.get_controllable_state().unwrap().color,
                    target.get_controllable_state().unwrap().color
                );
            }
        }
        handle_event(&mut state, &Event::ExternalStateUpdate { device: physical })
            .await
            .unwrap();
        assert_eq!(
            state.devices.get_device(&target.get_device_key()).unwrap(),
            &target
        );
        let mut updated = target.clone();
        if let DeviceData::Controllable(data) = &mut updated.data {
            data.state.color = Some(DeviceColor::new_from_hs(120, 0.6));
        }
        state.devices.set_state(&updated, true, true);
        while rx.try_recv().is_ok() {}
        state.finish_calibration("session");
        assert!(state.calibration_sessions.is_empty());
        let mut restored = Vec::new();
        while let Ok(event) = rx.try_recv() {
            if let Event::SetExternalState { device } = event {
                restored.push(device);
            }
        }
        assert_eq!(restored.len(), 2);
        assert!(restored
            .iter()
            .any(|device| device.get_device_key() == updated.get_device_key()
                && device.get_controllable_state().unwrap().color
                    == updated.get_controllable_state().unwrap().color));
    }

    #[tokio::test]
    async fn invalid_or_overlapping_sessions_do_not_change_lights_and_idle_sessions_expire() {
        let (mut state, mut rx) = test_state();
        for id in ["target", "reference"] {
            state.devices.set_state(&lamp(id), true, true);
        }
        while rx.try_recv().is_ok() {}
        let mut invalid = preview();
        invalid.reference_key = invalid.target_key.clone();
        assert!(state
            .preview_calibration("bad".into(), invalid, true)
            .is_err());
        assert!(rx.try_recv().is_err());
        state
            .preview_calibration("one".into(), preview(), true)
            .unwrap();
        assert!(state
            .preview_calibration("two".into(), preview(), true)
            .is_err());
        assert!(!state.expire_calibration_session("one"));
        state.calibration_sessions.get_mut("one").unwrap().touched =
            Instant::now() - SESSION_IDLE_TIMEOUT;
        assert!(state.expire_calibration_session("one"));
        assert!(state.calibration_sessions.is_empty());
        assert!(state
            .preview_calibration("one".into(), preview(), false)
            .is_err());
    }
}

#[derive(Clone, Deserialize)]
pub struct CalibrationPreview {
    pub target_key: String,
    pub reference_key: String,
    pub reference: Hs,
    pub output: Hs,
    pub brightness: f32,
}

impl AppState {
    pub fn calibration_device(&self, key: &str) -> Result<Device, String> {
        let device = self
            .devices
            .get_state()
            .0
            .values()
            .find(|device| device.get_device_key().to_string() == key)
            .cloned()
            .ok_or("Device is no longer available")?;
        let supported = matches!(&device.data, DeviceData::Controllable(data) if data.capabilities.hs && data.disabled != Some(true));
        let disabled = self
            .runtime_config
            .integrations
            .iter()
            .find(|row| row.id == device.integration_id.to_string())
            .is_some_and(|row| {
                crate::types::integration::device_is_disabled(&row.config, &device.id.to_string())
            });
        if !supported || device.is_readonly() || disabled {
            return Err(format!(
                "{} must be an enabled, writable HSV light",
                device.name
            ));
        }
        Ok(device)
    }

    pub fn calibration_preview_device(&self, key: &str) -> Option<Device> {
        self.calibration_sessions
            .values()
            .flat_map(|session| [&session.target, &session.reference])
            .find(|device| device.get_device_key().to_string() == key)
            .cloned()
    }

    pub fn preview_calibration(
        &mut self,
        id: String,
        preview: CalibrationPreview,
        start: bool,
    ) -> Result<(), String> {
        if id.is_empty() || id.len() > 100 || preview.target_key == preview.reference_key {
            return Err("Select two different lights".into());
        }
        if !preview.brightness.is_finite() || !(0.01..=1.0).contains(&preview.brightness) {
            return Err("Test brightness must be between 1 and 100%".into());
        }
        DeviceColorCalibration {
            device_key: preview.target_key.clone(),
            points: vec![ColorCalibrationPoint {
                reference: preview.reference.clone(),
                output: preview.output.clone(),
            }],
        }
        .validate()?;
        if start && self.calibration_sessions.contains_key(&id) {
            return Err("Session already exists".into());
        }
        if !start {
            let current = self
                .calibration_sessions
                .get(&id)
                .ok_or("Calibration session expired; start again")?;
            if current.target.get_device_key().to_string() != preview.target_key
                || current.reference.get_device_key().to_string() != preview.reference_key
            {
                return Err("A session cannot switch lights".into());
            }
        }
        for (session_id, session) in &self.calibration_sessions {
            if session_id != &id
                && [&session.reference, &session.target].iter().any(|device| {
                    let key = device.get_device_key().to_string();
                    key == preview.target_key || key == preview.reference_key
                })
            {
                return Err("One of these lights is already being calibrated".into());
            }
        }
        let mut target = self.calibration_device(&preview.target_key)?;
        let mut reference = self.calibration_device(&preview.reference_key)?;
        for (device, color) in [
            (&mut target, preview.output),
            (&mut reference, preview.reference),
        ] {
            if let DeviceData::Controllable(data) = &mut device.data {
                data.state.power = true;
                data.state.color = Some(DeviceColor::Hs(color));
                data.state.brightness = Some(preview.brightness.into());
                data.state.transition = Some(0.0.into());
            }
        }
        let calibration = self
            .runtime_config
            .calibration_for_device(&preview.reference_key);
        let reference = calibrated_device(&reference, calibration.as_ref());
        self.calibration_sessions.insert(
            id,
            CalibrationSession {
                target: target.clone(),
                reference: reference.clone(),
                touched: Instant::now(),
            },
        );
        // Queue logical devices, so even if Cancel overtakes these events they
        // cannot send a raw preview through the normal calibration path.
        for physical in [target, reference] {
            if let Some(device) = self.devices.get_device(&physical.get_device_key()).cloned() {
                self.event_tx.send(Event::SetExternalState { device });
            }
        }
        Ok(())
    }

    pub fn finish_calibration(&mut self, id: &str) {
        if let Some(session) = self.calibration_sessions.remove(id) {
            for preview in [session.target, session.reference] {
                if let Some(device) = self.devices.get_device(&preview.get_device_key()).cloned() {
                    self.event_tx.send(Event::SetExternalState { device });
                }
            }
        }
    }

    pub fn expire_calibration_session(&mut self, id: &str) -> bool {
        let expired = self
            .calibration_sessions
            .get(id)
            .is_none_or(|session| session.touched.elapsed() >= SESSION_IDLE_TIMEOUT);
        if expired {
            self.finish_calibration(id);
        }
        expired
    }
}
