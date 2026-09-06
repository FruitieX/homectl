use crate::{
    core::state::AppState,
    types::{color::DeviceColor, device::DeviceData, device_command::DeviceCommand, event::Event},
};
use ordered_float::OrderedFloat;

pub fn prepare_device_command(state: &AppState, command: &DeviceCommand) -> Result<Event, String> {
    if command.request_id.is_empty() || command.request_id.len() > 128 {
        return Err("A request ID of 1–128 bytes is required".into());
    }
    if command.power.is_none()
        && command.brightness.is_none()
        && command.color.is_none()
        && command.transition.is_none()
    {
        return Err("No device changes supplied".into());
    }
    let mut device = state
        .devices
        .get_device(&command.device_key)
        .cloned()
        .ok_or("Device not found")?;
    if device.is_readonly() {
        return Err("This device is read-only".into());
    }
    let DeviceData::Controllable(ref mut data) = device.data else {
        return Err("This device does not accept control commands".into());
    };
    if let Some(brightness) = command.brightness {
        if !brightness.is_finite() || !(0.0..=1.0).contains(&brightness) {
            return Err("Brightness must be between 0 and 1".into());
        }
        if data.capabilities.brightness != Some(true) {
            return Err("This device does not support brightness control".into());
        }
        data.state.brightness = Some(OrderedFloat(brightness));
    }
    if let Some(transition) = command.transition {
        if !transition.is_finite() || transition < 0.0 {
            return Err("Transition must be a non-negative number".into());
        }
        data.state.transition = Some(OrderedFloat(transition));
    }
    if let Some(color) = &command.color {
        let valid = match color {
            DeviceColor::Hs(c) => c.h <= 360 && c.s.is_finite() && (0.0..=1.0).contains(&c.s.0),
            DeviceColor::Xy(c) => {
                c.x.is_finite()
                    && c.y.is_finite()
                    && (0.0..=1.0).contains(&c.x.0)
                    && (0.0..=1.0).contains(&c.y.0)
            }
            DeviceColor::Rgb(c) => c.r <= 255 && c.g <= 255 && c.b <= 255,
            DeviceColor::Ct(c) => c.ct > 0 && c.ct <= u16::MAX as u64,
        };
        if !valid {
            return Err("Invalid color value".into());
        }
        if color.to_device_preferred_mode(&data.capabilities).is_none() {
            return Err("This device does not support color control".into());
        }
        data.state.color = Some(color.clone());
    }
    if let Some(power) = command.power {
        data.state.power = power;
    }
    if !command.preserve_scene {
        data.scene_id = None;
        data.state_source = None;
    }
    Ok(Event::SetInternalState {
        device,
        skip_external_update: Some(false),
        skip_db_update: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{event::tests::test_state, state::actor::spawn_state_actor};
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, Device, DeviceId, ManageKind},
        integration::IntegrationId,
    };

    fn fixture(
        managed: ManageKind,
        dimmable: bool,
    ) -> (AppState, DeviceCommand, crate::types::event::RxEventChannel) {
        let (mut state, event_rx) = test_state();
        let device = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("lamp"),
            "Current name".into(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                false,
                Some(0.7),
                None,
                Some(2.0),
                Capabilities {
                    brightness: Some(dimmable),
                    ..Default::default()
                },
                managed,
            )),
            Some(serde_json::json!({"latest": true})),
        );
        let command = DeviceCommand {
            request_id: "test".into(),
            device_key: device.get_device_key(),
            power: Some(true),
            brightness: None,
            color: None,
            transition: None,
            preserve_scene: false,
        };
        state.devices.set_state(&device, true, true);
        (state, command, event_rx)
    }

    #[tokio::test]
    async fn command_patch_preserves_current_state_and_metadata() {
        let (state, command, _event_rx) = fixture(ManageKind::Unmanaged, true);
        let Event::SetInternalState { device, .. } =
            prepare_device_command(&state, &command).unwrap()
        else {
            panic!("expected device event")
        };
        assert_eq!(device.name, "Current name");
        assert_eq!(device.raw, Some(serde_json::json!({"latest": true})));
        let data = device.get_controllable_state().unwrap();
        assert!(data.power);
        assert_eq!(data.brightness, Some(OrderedFloat(0.7)));
        assert_eq!(data.transition, Some(OrderedFloat(2.0)));
    }

    #[tokio::test]
    async fn command_rejects_readonly_and_unsupported_or_invalid_dimming() {
        for managed in [ManageKind::FullReadOnly, ManageKind::UnmanagedReadOnly] {
            let (state, command, _event_rx) = fixture(managed, true);
            assert!(prepare_device_command(&state, &command)
                .unwrap_err()
                .contains("read-only"));
        }
        let (state, mut command, _event_rx) = fixture(ManageKind::Unmanaged, false);
        command.brightness = Some(0.5);
        assert!(prepare_device_command(&state, &command)
            .unwrap_err()
            .contains("does not support"));
        let (state, mut command, _event_rx) = fixture(ManageKind::Unmanaged, true);
        for value in [-0.1, 1.1, f32::NAN, f32::INFINITY] {
            command.brightness = Some(value);
            assert!(prepare_device_command(&state, &command).is_err());
        }
        command.brightness = None;
        command.device_key.device_id = DeviceId::new("missing");
        assert_eq!(
            prepare_device_command(&state, &command).unwrap_err(),
            "Device not found"
        );
    }

    #[tokio::test]
    async fn capability_and_readonly_updates_apply_even_when_state_is_unchanged() {
        let (mut state, command, _event_rx) = fixture(ManageKind::Unmanaged, true);
        let mut device = state
            .devices
            .get_device(&command.device_key)
            .unwrap()
            .clone();
        let DeviceData::Controllable(ref mut data) = device.data else {
            unreachable!()
        };
        data.capabilities.brightness = Some(false);
        data.managed = ManageKind::UnmanagedReadOnly;
        state.devices.set_state(&device, true, true);
        assert!(prepare_device_command(&state, &command)
            .unwrap_err()
            .contains("read-only"));
        let DeviceData::Controllable(data) =
            &state.devices.get_device(&command.device_key).unwrap().data
        else {
            unreachable!()
        };
        assert_eq!(data.capabilities.brightness, Some(false));
    }

    #[tokio::test]
    async fn command_confirmation_follows_snapshot_publication() {
        let (state, command, _event_rx) = fixture(ManageKind::Unmanaged, true);
        let snapshot = state.snapshot.clone();
        let (work_tx, _work_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), work_tx);
        let result = handle.control_device(command.clone()).await.unwrap();
        assert!(result.applied, "{:?}", result.error);
        assert_eq!(
            snapshot
                .load()
                .devices
                .0
                .get(&command.device_key)
                .unwrap()
                .is_powered_on(),
            Some(true)
        );
    }

    #[tokio::test]
    async fn off_color_lights_keep_dimming_capability_and_explicit_false_wins() {
        for explicit in [None, Some(false)] {
            let data = ControllableDevice::new(
                None,
                false,
                None,
                None,
                None,
                Capabilities {
                    brightness: explicit,
                    hs: true,
                    ..Default::default()
                },
                ManageKind::Unmanaged,
            );
            assert_eq!(data.capabilities.brightness, Some(explicit.is_none()));
        }
    }
}
