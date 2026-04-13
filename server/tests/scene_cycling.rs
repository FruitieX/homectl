//! Integration tests for scene cycling functionality.
//!
//! These tests verify that the CycleScenes action correctly handles various
//! edge cases including:
//! - Scene detection with online devices
//! - Scene detection with offline/disconnected devices
//! - Scene ID comparison in state equality checks
//! - Mixed scene states across devices

use std::str::FromStr;

use ordered_float::OrderedFloat;

use homectl_server::types::color::{Capabilities, DeviceColor, Hs};
use homectl_server::types::device::{
    ControllableDevice, ControllableState, Device, DeviceData, DeviceId, DeviceKey,
    DeviceStateSource, DeviceStateSourceKind, DeviceStateSourceScope, ManageKind,
};
use homectl_server::types::integration::IntegrationId;
use homectl_server::types::scene::SceneId;

/// Create a test device with the given parameters.
fn create_device(
    integration_id: &str,
    device_id: &str,
    name: &str,
    scene_id: Option<&str>,
    power: bool,
    brightness: f32,
    color_h: u64,
    color_s: f32,
) -> Device {
    Device::new(
        IntegrationId::from(integration_id.to_string()),
        DeviceId::new(device_id),
        name.to_string(),
        DeviceData::Controllable(ControllableDevice {
            scene_id: scene_id.map(|s| SceneId::from_str(s).unwrap()),
            state_source: None,
            capabilities: Capabilities {
                xy: false,
                hs: true,
                rgb: false,
                ct: None,
            },
            state: ControllableState {
                power,
                brightness: Some(OrderedFloat(brightness)),
                color: Some(DeviceColor::Hs(Hs {
                    h: color_h,
                    s: OrderedFloat(color_s),
                })),
                transition: None,
            },
            managed: ManageKind::Full,
        }),
        None,
    )
}

/// Test that is_state_eq correctly identifies different scenes even when
/// visual state (power, color, brightness) is identical.
#[test]
fn test_is_state_eq_compares_scene_id() {
    // Create two identical device states but with different scene_ids
    let device_a = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true,
        0.25,
        25,
        0.95,
    );

    let device_b = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("normal"),
        true,
        0.25,
        25,
        0.95,
    );

    // Same device with same scene should be equal
    assert!(
        device_a.is_state_eq(&device_a),
        "Device should equal itself"
    );

    // Same visual state but different scene_id should NOT be equal
    assert!(
        !device_a.is_state_eq(&device_b),
        "Devices with different scene_ids should not be equal even with same visual state"
    );

    // Create device with no scene
    let device_c = create_device("test", "lamp1", "Test Lamp", None, true, 0.25, 25, 0.95);

    // Device with scene vs without scene should not be equal
    assert!(
        !device_a.is_state_eq(&device_c),
        "Device with scene should not equal device without scene"
    );

    // Two devices with no scene but same visual state should be equal
    let device_d = create_device("test", "lamp1", "Test Lamp", None, true, 0.25, 25, 0.95);
    assert!(
        device_c.is_state_eq(&device_d),
        "Devices with no scene and same visual state should be equal"
    );
}

/// Test that scenes with same visual state but different scene_ids are distinguished.
#[test]
fn test_scene_id_comparison_basic() {
    // Create a device in "dark" scene
    let dark_device = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true,
        0.25,
        25,
        0.95,
    );

    // Same visual appearance, but "normal" scene
    let normal_device = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("normal"),
        true,
        0.25,
        25,
        0.95,
    );

    // These should NOT be equal since scene_id differs
    assert!(
        !dark_device.is_state_eq(&normal_device),
        "Devices with different scene_ids should not be equal"
    );

    // But the same device should equal itself
    assert!(
        dark_device.is_state_eq(&dark_device),
        "Device should equal itself"
    );
}

/// Test that devices with no scene (manually adjusted) are handled correctly.
#[test]
fn test_manual_device_adjustment() {
    // Device with scene set
    let scene_device = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true,
        0.25,
        25,
        0.95,
    );

    // Device with no scene (as if manually adjusted via API)
    let manual_device = create_device("test", "lamp1", "Test Lamp", None, true, 0.25, 25, 0.95);

    // They should not be equal since one has scene and other doesn't
    assert!(
        !scene_device.is_state_eq(&manual_device),
        "Scene device should not equal manually adjusted device"
    );
}

/// Test that changed visual state is detected even with same scene.
#[test]
fn test_visual_state_change_detected() {
    let device_a = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true,
        0.25, // brightness 25%
        25,
        0.95,
    );

    let device_b = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"), // same scene
        true,
        0.50, // brightness 50% - different!
        25,
        0.95,
    );

    // Same scene but different brightness - should NOT be equal
    assert!(
        !device_a.is_state_eq(&device_b),
        "Devices with different brightness should not be equal"
    );
}

/// Test that power state changes are detected.
#[test]
fn test_power_state_change_detected() {
    let device_on = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true, // power on
        0.25,
        25,
        0.95,
    );

    let device_off = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"), // same scene
        false,        // power off
        0.25,
        25,
        0.95,
    );

    // Same scene but different power state - should NOT be equal
    assert!(
        !device_on.is_state_eq(&device_off),
        "Devices with different power state should not be equal"
    );
}

#[test]
fn test_state_source_change_detected() {
    let mut direct_device = create_device(
        "test",
        "lamp1",
        "Test Lamp",
        Some("dark"),
        true,
        0.25,
        25,
        0.95,
    );
    let mut linked_device = direct_device.clone();

    let linked_state_source = DeviceStateSource {
        scope: DeviceStateSourceScope::Device,
        kind: DeviceStateSourceKind::DeviceLink,
        group_id: None,
        linked_scene_id: None,
        linked_device_key: Some(DeviceKey::new(
            IntegrationId::from("circadian".to_string()),
            DeviceId::new("color"),
        )),
    };

    if let DeviceData::Controllable(data) = &mut direct_device.data {
        data.state_source = Some(DeviceStateSource {
            scope: DeviceStateSourceScope::Device,
            kind: DeviceStateSourceKind::DeviceState,
            group_id: None,
            linked_scene_id: None,
            linked_device_key: None,
        });
    }

    if let DeviceData::Controllable(data) = &mut linked_device.data {
        data.state_source = Some(linked_state_source);
    }

    assert!(
        !direct_device.is_state_eq(&linked_device),
        "Devices with different state sources should not be equal"
    );
}
