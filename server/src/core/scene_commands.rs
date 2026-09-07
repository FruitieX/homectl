use crate::{
    core::state::AppState,
    types::{
        device::{Device, DeviceData, DeviceKey},
        scene_command::SceneCommand,
    },
};
use ordered_float::OrderedFloat;
use std::collections::BTreeSet;

/// Validate and resolve the complete selection before changing any device.
fn prepare(state: &AppState, command: &SceneCommand) -> Result<Vec<Device>, String> {
    if command.request_id.is_empty() || command.request_id.len() > 128 {
        return Err("A request ID of 1–128 bytes is required".into());
    }
    if command
        .transition
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err("Transition must be a non-negative number".into());
    }
    if state.scenes.find_scene(&command.scene_id).is_none() {
        return Err("Scene not found".into());
    }
    let mut targets = BTreeSet::new();
    if let Some(keys) = &command.device_keys {
        for key in keys {
            let device = state
                .devices
                .get_device(key)
                .ok_or_else(|| format!("Device {key} is unavailable"))?;
            if device.is_readonly() || device.is_sensor() {
                return Err(format!(
                    "Device {} does not accept scene controls",
                    device.name
                ));
            }
            targets.insert(key.clone());
        }
    }
    let resolved = &state.scenes.get_flattened_scenes().0;
    let scene = resolved
        .get(&command.scene_id)
        .ok_or("Scene has no resolved targets")?;
    if let Some(ids) = &command.group_keys {
        for id in ids {
            let group = state
                .groups
                .get_flattened_groups()
                .0
                .get(id)
                .cloned()
                .ok_or_else(|| format!("Group {id} not found"))?;
            for key in group.device_keys {
                if scene.devices.0.contains_key(&key) {
                    targets.insert(key);
                }
            }
        }
    }
    if command.device_keys.is_none() && command.group_keys.is_none() {
        targets.extend(scene.devices.0.keys().cloned());
    }
    let mut prepared = Vec::new();
    for key in targets {
        let device = state
            .devices
            .get_device(&key)
            .ok_or_else(|| format!("Device {key} is unavailable"))?;
        // Group/all-scene scopes can contain read-only devices. Explicit targets
        // were rejected above; implicit targets are limited to writable devices.
        if device.is_readonly() || device.is_sensor() {
            continue;
        }
        let (mut desired, source) = state
            .scenes
            .get_device_scene_state_details(&command.scene_id, device, &state.devices)
            .ok_or_else(|| format!("Scene has no resolved state for {}", device.name))?;
        if let Some(transition) = command.transition {
            desired.transition = Some(OrderedFloat(transition));
        } else if !command.use_scene_transition {
            desired.transition = None;
        }
        let mut device = device.clone();
        if let DeviceData::Controllable(data) = &mut device.data {
            data.scene_id = Some(command.scene_id.clone());
            data.state_source = Some(source);
            data.state = desired;
        }
        prepared.push(device);
    }
    if prepared.is_empty() {
        return Err("No writable devices match this scene and selection".into());
    }
    Ok(prepared)
}

pub fn apply_scene_command(
    state: &mut AppState,
    command: &SceneCommand,
) -> Result<Vec<DeviceKey>, String> {
    let devices = prepare(state, command)?;
    let affected = devices.iter().map(Device::get_device_key).collect();
    for device in devices {
        state.devices.set_state(&device, false, false);
    }
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        core::{event::tests::test_state, state::actor::spawn_state_actor},
        db::config_queries::{GroupDeviceRow, GroupRow, SceneRow},
        types::{
            color::Capabilities,
            device::{ControllableDevice, DeviceId, ManageKind},
            event::RxEventChannel,
            group::GroupId,
            integration::IntegrationId,
            scene::SceneId,
        },
    };
    use serde_json::json;

    fn fixture() -> (AppState, RxEventChannel, SceneCommand) {
        let (mut state, rx) = test_state();
        for (id, managed) in [
            ("a", ManageKind::Unmanaged),
            ("b", ManageKind::Unmanaged),
            ("readonly", ManageKind::UnmanagedReadOnly),
            ("outside", ManageKind::Unmanaged),
        ] {
            let device = Device::new(
                IntegrationId::from("dummy".to_string()),
                DeviceId::new(id),
                id.into(),
                DeviceData::Controllable(ControllableDevice::new(
                    None,
                    false,
                    Some(0.2),
                    None,
                    None,
                    Capabilities {
                        brightness: Some(true),
                        ..Default::default()
                    },
                    managed,
                )),
                Some(json!({"preserve": true})),
            );
            state.devices.set_state(&device, true, true);
        }
        state.runtime_config.groups.push(GroupRow {
            id: "room".into(),
            name: "Room".into(),
            hidden: false,
            linked_groups: vec![],
            devices: ["a", "readonly"]
                .iter()
                .map(|id| GroupDeviceRow {
                    integration_id: "dummy".into(),
                    device_id: (*id).into(),
                })
                .collect(),
        });
        state.apply_runtime_groups();
        state.runtime_config.scenes.push(SceneRow {
            id: "evening".into(),
            name: "Evening".into(),
            hidden: false,
            script: None,
            group_states: Default::default(),
            device_states: ["a", "b", "readonly"]
                .iter()
                .map(|id| {
                    (
                        format!("dummy/{id}"),
                        json!({"power": true, "brightness": 0.6, "transition": 2.0}),
                    )
                })
                .collect(),
        });
        state.apply_runtime_scenes();
        let command = SceneCommand {
            request_id: "scene-test".into(),
            scene_id: SceneId::new("evening".into()),
            device_keys: None,
            group_keys: None,
            use_scene_transition: false,
            transition: None,
        };
        (state, rx, command)
    }
    fn key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
    }

    #[tokio::test]
    async fn group_scope_excludes_readonly_and_outside_devices() {
        let (mut state, _rx, mut command) = fixture();
        command.group_keys = Some(vec![GroupId("room".into())]);
        assert_eq!(
            apply_scene_command(&mut state, &command).unwrap(),
            vec![key("a")]
        );
        assert_eq!(
            state.devices.get_device(&key("a")).unwrap().is_powered_on(),
            Some(true)
        );
        for id in ["b", "readonly", "outside"] {
            assert_eq!(
                state.devices.get_device(&key(id)).unwrap().is_powered_on(),
                Some(false)
            );
        }
        let device = state.devices.get_device(&key("a")).unwrap();
        assert_eq!(device.raw, Some(json!({"preserve": true})));
        assert_eq!(device.get_controllable_state().unwrap().transition, None);
    }

    #[tokio::test]
    async fn invalid_explicit_selection_rejects_before_any_state_changes() {
        let (mut state, _rx, mut command) = fixture();
        let before = state.devices.get_state().clone();
        for invalid in ["outside", "readonly", "missing"] {
            command.device_keys = Some(vec![key("a"), key(invalid)]);
            assert!(apply_scene_command(&mut state, &command).is_err());
            assert_eq!(state.devices.get_state(), &before);
        }
        command.device_keys = Some(vec![]);
        assert!(apply_scene_command(&mut state, &command).is_err());
        command.device_keys = None;
        command.group_keys = Some(vec![]);
        assert!(apply_scene_command(&mut state, &command).is_err());
        command.group_keys = Some(vec![GroupId("missing".into())]);
        assert!(apply_scene_command(&mut state, &command).is_err());
        assert_eq!(state.devices.get_state(), &before);
    }

    #[tokio::test]
    async fn transition_and_scene_validation_preserve_runtime() {
        let (mut state, _rx, mut command) = fixture();
        for value in [-1.0, f32::NAN, f32::INFINITY] {
            command.transition = Some(value);
            assert!(apply_scene_command(&mut state, &command).is_err());
        }
        command.transition = None;
        command.scene_id = SceneId::new("missing".into());
        assert!(apply_scene_command(&mut state, &command).is_err());
        command.scene_id = SceneId::new("evening".into());
        command.use_scene_transition = true;
        let prepared = prepare(&state, &command).unwrap();
        assert!(prepared
            .iter()
            .all(|device| device.get_controllable_state().unwrap().transition
                == Some(OrderedFloat(2.0))));
        command.transition = Some(0.5);
        assert!(prepare(&state, &command)
            .unwrap()
            .iter()
            .all(|device| device.get_controllable_state().unwrap().transition
                == Some(OrderedFloat(0.5))));
    }

    #[tokio::test]
    async fn actor_confirms_after_publishing_all_affected_devices() {
        let (state, _rx, command) = fixture();
        let snapshot = state.snapshot.clone();
        let (work_tx, _work_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), work_tx);
        let result = handle.activate_scene(command).await.unwrap();
        assert!(result.applied, "{:?}", result.error);
        assert_eq!(result.affected_devices, vec![key("a"), key("b")]);
        for key in &result.affected_devices {
            assert_eq!(
                snapshot.load().devices.0.get(key).unwrap().is_powered_on(),
                Some(true)
            );
        }
        assert_eq!(
            snapshot
                .load()
                .devices
                .0
                .get(&key("readonly"))
                .unwrap()
                .is_powered_on(),
            Some(false)
        );
    }
}
