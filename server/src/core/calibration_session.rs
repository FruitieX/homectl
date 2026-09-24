//! Ephemeral physical-output overrides. Normal scene state keeps advancing and
//! is sent again when a session ends; previews never enter persisted devices.
use super::{
    color_calibration::{
        calibrated_device, map_brightness_output, CalibrationChannels, ColorCalibrationPoint,
        DeviceColorCalibration, Uv,
    },
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
    /// Absent for manual-only brightness authoring, where the person enters the
    /// target output without matching another light.
    pub reference: Option<Device>,
    pub touched: Instant,
    /// Which channel this session previews; the other channel of either light is
    /// left exactly as the runtime has it.
    pub channel: CalibrationChannel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalibrationChannel {
    Color,
    Brightness,
}

/// The brightness-only preview request. It carries no color values at all, so a
/// dimmer without color support can be calibrated on the spot.
#[derive(Debug, Clone, Deserialize)]
pub struct BrightnessPreview {
    pub target_key: String,
    #[serde(default)]
    pub reference_key: Option<String>,
    /// Physical output the target is commanded to, as a fraction of full.
    pub output: f32,
    /// Logical level the reference light is set to through its own calibration.
    #[serde(default)]
    pub reference_logical: Option<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::event::{handle_event, tests::test_state, DeferredEventWork};
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
                brightness_points: Vec::new(),
                points: vec![ColorCalibrationPoint {
                    reference: Uv::from_xy(&DeviceColor::new_from_hs(45, 0.3).to_xy().unwrap()),
                    output: Uv::from_xy(&DeviceColor::new_from_hs(80, 0.5).to_xy().unwrap()),
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
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: physical,
                integration_epoch: None,
            },
        )
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
        assert!(restored.iter().any(|device| {
            device.get_device_key() == updated.get_device_key()
                && device.get_controllable_state().unwrap().color
                    == updated.get_controllable_state().unwrap().color
        }));

        let calibration = state
            .runtime_config
            .calibration_for_device(&updated.get_device_key().to_string());
        let expected = calibrated_device(&updated, calibration.as_ref());
        let mut republished_target = None;
        for device in restored {
            let outcome = handle_event(&mut state, &Event::SetExternalState { device })
                .await
                .unwrap();
            for work in outcome.into_deferred_work() {
                if let DeferredEventWork::PublishIntegrationState { device, .. } = work {
                    if device.get_device_key() == updated.get_device_key() {
                        republished_target = Some(device);
                    }
                }
            }
        }
        assert_eq!(
            republished_target
                .expect("finishing calibration should republish the target")
                .get_controllable_state()
                .unwrap()
                .color,
            expected.get_controllable_state().unwrap().color,
        );
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

    #[tokio::test]
    async fn rgb_only_lights_are_calibratable() {
        let (mut state, _rx) = test_state();
        let mut target = lamp("target");
        if let DeviceData::Controllable(data) = &mut target.data {
            data.capabilities.hs = false;
            data.capabilities.rgb = true;
            data.state.color = Some(DeviceColor::new_from_rgb(255, 128, 64));
        }
        state.devices.set_state(&target, true, true);
        state.devices.set_state(&lamp("reference"), true, true);

        assert!(state.calibration_device("dummy/target").is_ok());
        assert!(state
            .preview_calibration("rgb-session".into(), preview(), true)
            .is_ok());
        let physical = state.calibration_preview_device("dummy/target").unwrap();
        assert!(matches!(
            physical.get_controllable_state().unwrap().color,
            Some(DeviceColor::Hs(_))
        ));
    }

    fn dimmer(id: &str) -> Device {
        // A writable dimmer with no color support at all: the light a
        // brightness-only calibration exists for.
        Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new(id),
            id.into(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                false,
                Some(0.4),
                None,
                None,
                Capabilities {
                    brightness: Some(true),
                    ..Default::default()
                },
                ManageKind::Full,
            )),
            None,
        )
    }

    #[tokio::test]
    async fn a_dimmer_without_color_can_be_calibrated_for_brightness() {
        let (mut state, _rx) = test_state();
        let target = dimmer("target");
        let reference = dimmer("reference");
        state.devices.set_state(&target, true, true);
        state.devices.set_state(&reference, true, true);

        // A color session refuses it, plainly.
        let refused = state.calibration_device("dummy/target").unwrap_err();
        assert!(refused.contains("color light"), "{refused}");

        // The brightness session accepts it, with a reference...
        state
            .preview_brightness_calibration(
                "b1".into(),
                BrightnessPreview {
                    target_key: "dummy/target".into(),
                    reference_key: Some("dummy/reference".into()),
                    output: 0.04,
                    reference_logical: Some(0.10),
                },
                true,
            )
            .unwrap();
        let physical = state.calibration_preview_device("dummy/target").unwrap();
        let reported = physical.get_controllable_state().unwrap();
        assert!(reported.power);
        assert_eq!(reported.brightness.map(|value| value.into_inner()), Some(0.04));
        assert_eq!(reported.transition.map(|value| value.into_inner()), Some(0.0));
        // ...and without one, for manual authoring.
        state.finish_calibration("b1");
        state
            .preview_brightness_calibration(
                "b2".into(),
                BrightnessPreview {
                    target_key: "dummy/target".into(),
                    reference_key: None,
                    output: 0.6,
                    reference_logical: None,
                },
                true,
            )
            .unwrap();
        assert!(state.calibration_sessions.get("b2").unwrap().reference.is_none());

        // Zero is never a positive floor, and 100% is the ceiling.
        let zero = state
            .preview_brightness_calibration(
                "b3".into(),
                BrightnessPreview {
                    target_key: "dummy/target".into(),
                    reference_key: None,
                    output: 0.0,
                    reference_logical: None,
                },
                true,
            )
            .unwrap_err();
        assert!(zero.contains("above 0%"), "{zero}");
    }

    #[tokio::test]
    async fn a_brightness_preview_maps_the_reference_and_leaves_colour_alone() {
        let (mut state, _rx) = test_state();
        let target = lamp("target");
        let reference = lamp("reference");
        state.devices.set_state(&target, true, true);
        state.devices.set_state(&reference, true, true);
        // The reference has a brightness curve of its own: 10% logical means
        // 4% on this device.
        state
            .runtime_config
            .device_color_calibrations
            .push(DeviceColorCalibration {
                device_key: "dummy/reference".into(),
                points: Vec::new(),
                brightness_points: vec![
                    crate::core::color_calibration::BrightnessCalibrationPoint {
                        logical: 0.1.into(),
                        output: 0.04.into(),
                    },
                    crate::core::color_calibration::BrightnessCalibrationPoint {
                        logical: 1.0.into(),
                        output: 0.8.into(),
                    },
                ],
            });

        state
            .preview_brightness_calibration(
                "session".into(),
                BrightnessPreview {
                    target_key: "dummy/target".into(),
                    reference_key: Some("dummy/reference".into()),
                    output: 0.25,
                    reference_logical: Some(0.1),
                },
                true,
            )
            .unwrap();

        let target_physical = state.calibration_preview_device("dummy/target").unwrap();
        let target_state = target_physical.get_controllable_state().unwrap();
        // The target keeps its color and takes the candidate output as typed.
        assert_eq!(
            target_state.color,
            Some(DeviceColor::new_from_hs(90, 0.3)),
            "a brightness preview must not touch colour"
        );
        assert_eq!(
            target_state.brightness.map(|value| value.into_inner()),
            Some(0.25)
        );

        let reference_physical = state.calibration_preview_device("dummy/reference").unwrap();
        assert_eq!(
            reference_physical
                .get_controllable_state()
                .unwrap()
                .brightness
                .map(|value| value.into_inner()),
            Some(0.04),
            "the reference is set through its own calibration"
        );

        // Cancel restores what the runtime has, not the preview.
        state.finish_calibration("session");
        assert!(state.calibration_sessions.is_empty());
        assert_eq!(
            state
                .devices
                .get_device(&target.get_device_key())
                .unwrap()
                .get_controllable_state()
                .unwrap()
                .brightness
                .map(|value| value.into_inner()),
            Some(0.5)
        );
    }

    #[tokio::test]
    async fn a_brightness_session_refuses_a_second_light_and_a_channel_switch() {
        let (mut state, _rx) = test_state();
        for id in ["a", "b", "c"] {
            state.devices.set_state(&dimmer(id), true, true);
        }
        state
            .preview_brightness_calibration(
                "session".into(),
                BrightnessPreview {
                    target_key: "dummy/a".into(),
                    reference_key: None,
                    output: 0.5,
                    reference_logical: None,
                },
                true,
            )
            .unwrap();
        let busy = state
            .preview_brightness_calibration(
                "other".into(),
                BrightnessPreview {
                    target_key: "dummy/a".into(),
                    reference_key: None,
                    output: 0.5,
                    reference_logical: None,
                },
                true,
            )
            .unwrap_err();
        assert!(busy.contains("already being calibrated"), "{busy}");

        let switched = state
            .preview_brightness_calibration(
                "session".into(),
                BrightnessPreview {
                    target_key: "dummy/b".into(),
                    reference_key: None,
                    output: 0.5,
                    reference_logical: None,
                },
                false,
            )
            .unwrap_err();
        assert!(switched.contains("cannot switch lights"), "{switched}");

        let expired = state
            .preview_brightness_calibration(
                "gone".into(),
                BrightnessPreview {
                    target_key: "dummy/c".into(),
                    reference_key: None,
                    output: 0.5,
                    reference_logical: None,
                },
                false,
            )
            .unwrap_err();
        assert!(expired.contains("expired"), "{expired}");
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
    /// A light that can be calibrated on the requested channels: enabled,
    /// writable, and able to dim (and mix color, when color is asked for).
    /// Brightness-only dimmers qualify for a brightness session — requiring
    /// color support would exclude them for no reason.
    pub fn calibration_device_for(
        &self,
        key: &str,
        channels: CalibrationChannels,
    ) -> Result<Device, String> {
        let device = self
            .devices
            .get_state()
            .0
            .values()
            .find(|device| device.get_device_key().to_string() == key)
            .cloned()
            .ok_or("Device is no longer available")?;
        let capability = match &device.data {
            DeviceData::Controllable(data) => {
                let color = data.capabilities.xy || data.capabilities.hs || data.capabilities.rgb;
                let brightness = data.capabilities.brightness == Some(true);
                let wanted = (!channels.color || color) && (!channels.brightness || brightness);
                data.disabled != Some(true) && wanted
            }
            _ => false,
        };
        let disabled = self
            .runtime_config
            .integrations
            .iter()
            .find(|row| row.id == device.integration_id.to_string())
            .is_some_and(|row| {
                crate::types::integration::device_is_disabled(&row.config, &device.id.to_string())
            });
        if !capability || device.is_readonly() || disabled {
            return Err(format!(
                "{} must be an enabled, writable {} light",
                device.name,
                match (channels.color, channels.brightness) {
                    (true, true) => "color and dimmable",
                    (true, false) => "color",
                    (false, true) => "dimmable",
                    (false, false) => "controllable",
                }
            ));
        }
        Ok(device)
    }

    pub fn calibration_device(&self, key: &str) -> Result<Device, String> {
        self.calibration_device_for(
            key,
            CalibrationChannels {
                color: true,
                brightness: false,
            },
        )
    }

    pub fn calibration_preview_device(&self, key: &str) -> Option<Device> {
        self.calibration_sessions
            .values()
            .flat_map(|session| {
                std::iter::once(&session.target).chain(session.reference.iter())
            })
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
                reference: Uv::from_xy(
                    &DeviceColor::Hs(preview.reference.clone()).to_xy().unwrap(),
                ),
                output: Uv::from_xy(&DeviceColor::Hs(preview.output.clone()).to_xy().unwrap()),
            }],
            // The color preview authors color points only; brightness is
            // calibrated by its own session.
            brightness_points: Vec::new(),
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
            let current_reference = current
                .reference
                .as_ref()
                .map(|device| device.get_device_key().to_string())
                .unwrap_or_default();
            if current.target.get_device_key().to_string() != preview.target_key
                || current_reference != preview.reference_key
            {
                return Err("A session cannot switch lights".into());
            }
        }
        for (session_id, session) in &self.calibration_sessions {
            if session_id != &id
                && std::iter::once(&session.target)
                    .chain(session.reference.iter())
                    .any(|device| {
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
                reference: Some(reference.clone()),
                touched: Instant::now(),
                channel: CalibrationChannel::Color,
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

    /// Preview one candidate brightness output on the target. The target is
    /// commanded **without** its existing curve, so the number the person typed
    /// is the command the device receives; the reference is set through its own
    /// calibration and never below its own floor.
    pub fn preview_brightness_calibration(
        &mut self,
        id: String,
        preview: BrightnessPreview,
        start: bool,
    ) -> Result<(), String> {
        if id.is_empty() || id.len() > 100 {
            return Err("A calibration session needs an id".into());
        }
        if !preview.output.is_finite() || preview.output <= 0.0 || preview.output > 1.0 {
            return Err("Target output must be above 0% and at most 100%".into());
        }
        if let Some(logical) = preview.reference_logical {
            if !logical.is_finite() || logical <= 0.0 || logical > 1.0 {
                return Err("The reference level must be above 0% and at most 100%".into());
            }
        }
        let reference_key = preview.reference_key.clone().unwrap_or_default();
        if !reference_key.is_empty() && reference_key == preview.target_key {
            return Err("Select two different lights".into());
        }
        if start && self.calibration_sessions.contains_key(&id) {
            return Err("Session already exists".into());
        }
        if !start {
            let current = self
                .calibration_sessions
                .get(&id)
                .ok_or("Calibration session expired; start again")?;
            if current.channel != CalibrationChannel::Brightness {
                return Err("This session previews color; start a brightness session".into());
            }
            let current_reference = current
                .reference
                .as_ref()
                .map(|device| device.get_device_key().to_string())
                .unwrap_or_default();
            if current.target.get_device_key().to_string() != preview.target_key
                || current_reference != reference_key
            {
                return Err("A session cannot switch lights".into());
            }
        }
        for (session_id, session) in &self.calibration_sessions {
            if session_id == &id {
                continue;
            }
            if std::iter::once(&session.target)
                .chain(session.reference.iter())
                .any(|device| {
                    let key = device.get_device_key().to_string();
                    key == preview.target_key || (!reference_key.is_empty() && key == reference_key)
                })
            {
                return Err("One of these lights is already being calibrated".into());
            }
        }

        let channels = CalibrationChannels {
            color: false,
            brightness: true,
        };
        let mut target = self.calibration_device_for(&preview.target_key, channels)?;
        let mut reference = if reference_key.is_empty() {
            None
        } else {
            Some(self.calibration_device_for(&reference_key, channels)?)
        };

        if let DeviceData::Controllable(data) = &mut target.data {
            // Power on, the candidate output, no transition — and the light's
            // own color or temperature stays exactly as it is.
            data.state.power = true;
            data.state.brightness = Some(preview.output.into());
            data.state.transition = Some(0.0.into());
        }
        if let Some(reference_device) = &mut reference {
            let logical = preview.reference_logical.unwrap_or(preview.output);
            let calibration = self.runtime_config.calibration_for_device(&reference_key);
            let mapped = calibration
                .as_ref()
                .map(|calibration| {
                    map_brightness_output(&calibration.brightness_points, logical)
                })
                .unwrap_or(logical);
            if let DeviceData::Controllable(data) = &mut reference_device.data {
                data.state.power = true;
                data.state.brightness = Some(mapped.into());
                data.state.transition = Some(0.0.into());
            }
            reference = Some(calibrated_device(reference_device, calibration.as_ref()));
        }

        self.calibration_sessions.insert(
            id,
            CalibrationSession {
                target: target.clone(),
                reference: reference.clone(),
                touched: Instant::now(),
                channel: CalibrationChannel::Brightness,
            },
        );
        for physical in std::iter::once(target).chain(reference) {
            if let Some(device) = self.devices.get_device(&physical.get_device_key()).cloned() {
                self.event_tx.send(Event::SetExternalState { device });
            }
        }
        Ok(())
    }

    pub fn finish_calibration(&mut self, id: &str) {
        if let Some(session) = self.calibration_sessions.remove(id) {
            for preview in std::iter::once(session.target).chain(session.reference) {
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
