use eyre::Result;
use ordered_float::OrderedFloat;
use std::{
    collections::BTreeMap,
    fmt::{self, Display},
};

use crate::core::scenes::Scenes;

use super::{
    color::{Capabilities, ColorMode, DeviceColor},
    integration::IntegrationId,
    scene::SceneId,
};
use serde::{
    de::{self, Unexpected, Visitor},
    Deserialize, Serialize,
};
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd, Hash, NewtypeDisplay!, NewtypeFrom!)]
    #[ts(export)]
    /// unique identifier for the Device
    pub struct DeviceId(String);
}

impl std::str::FromStr for DeviceId {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(DeviceId::new(s))
    }
}

impl DeviceId {
    pub fn new(id: &str) -> DeviceId {
        DeviceId(String::from(id))
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct ControllableState {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<OrderedFloat<f32>>,

    /// Current color, if supported
    pub color: Option<DeviceColor>,

    /// Transition time in seconds
    pub transition: Option<OrderedFloat<f32>>,
}

impl Display for ControllableState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = {
            let color_str = if !self.power {
                "off".to_string()
            } else if let Some(DeviceColor::Xy(color)) = &self.color {
                format!("xy({}, {})", color.x, color.y,)
            } else if let Some(DeviceColor::Hs(color)) = &self.color {
                format!("hs({}, {})", color.h, color.s,)
            } else if let Some(DeviceColor::Rgb(color)) = &self.color {
                format!("rgb({}, {}, {})", color.r, color.g, color.b)
            } else if let Some(DeviceColor::Ct(ct)) = &self.color {
                format!("ct({})", ct.ct)
            } else {
                "on".to_string()
            };

            if let Some(bri) = self.brightness {
                format!("{}, bri({})", color_str, bri)
            } else {
                color_str
            }
        };

        f.write_str(&s)
    }
}

impl ControllableState {
    pub fn color_to_device_preferred_mode(&self, capabilities: &Capabilities) -> Self {
        let mut state = self.clone();

        if let Some(color) = state.color {
            state.color = color.to_device_preferred_mode(capabilities);
        }

        state
    }

    pub fn is_ct(&self) -> bool {
        self.color
            .as_ref()
            .map(|c| matches!(c, DeviceColor::Ct(_)))
            .unwrap_or_default()
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Default, Hash, Eq)]
#[ts(export)]
pub enum ManageKind {
    /// Device is fully managed by homectl.
    /// Homectl will always correct any drift from expected state.
    ///
    /// This is the best choice for devices that you wish to control exclusively
    /// via homectl.
    ///
    /// Corrects for:
    ///
    /// - Incorrect state due to power loss
    /// - Missed commands due to poor connection
    /// - State changes introduced via other smart home apps
    /// - Changes to expected state introduced via links to other devices
    #[default]
    Full,

    /// Device is partially managed by homectl.
    /// Homectl will make sure that state transitions are completed
    /// successfully, but will not fix any further drift from expected state.
    ///
    /// Useful for devices that you wish to control via homectl, but also via
    /// some other means that you cannot make homectl aware of such as a
    /// physical switch on the device.
    ///
    /// Corrects for:
    ///
    /// - Missed commands due to poor connection
    Partial {
        /// Whether we have seen the device change state since the previously
        /// issued command.
        prev_change_committed: bool,
    },

    /// Device is not managed by homectl.
    /// Homectl will not make any effort to correct state drift, and any
    /// state commands sent to the device will be fire-and-forget.
    Unmanaged,

    /// Device is read-only and external state update events are dropped,
    /// otherwise behaves like ManageKind::Full
    ///
    /// Intended for debugging purposes. (E.g. avoid flashing lights in the
    /// middle of the night)
    FullReadOnly,

    /// Device is read-only and external state update events are dropped,
    /// otherwise behaves like ManageKind::Unmanaged
    ///
    /// Intended for debugging purposes. (E.g. avoid flashing lights in the
    /// middle of the night)
    UnmanagedReadOnly,
}

/// lights with adjustable brightness and/or color
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct ControllableDevice {
    pub scene_id: Option<SceneId>,
    #[serde(default)]
    pub capabilities: Capabilities,
    pub state: ControllableState,
    #[serde(default)]
    pub managed: ManageKind,
}

impl ControllableDevice {
    pub fn new(
        scene: Option<SceneId>,
        power: bool,
        brightness: Option<f32>,
        color: Option<DeviceColor>,
        transition: Option<f32>,
        capabilities: Capabilities,
        managed: ManageKind,
    ) -> ControllableDevice {
        ControllableDevice {
            scene_id: scene,
            state: ControllableState {
                power,
                brightness: brightness.map(OrderedFloat),
                color,
                transition: transition.map(OrderedFloat),
            },
            capabilities,
            managed,
        }
    }

    pub fn dim(&mut self, amount: f32) {
        if self.state.power {
            let brightness =
                (self.state.brightness.as_deref().unwrap_or(&0.0) - amount).clamp(0.1, 1.0);

            self.state.brightness = Some(OrderedFloat(brightness));
        }
    }

    pub fn has_partial_uncommitted_changes(&self) -> bool {
        matches!(
            self.managed,
            ManageKind::Partial {
                prev_change_committed: false
            }
        )
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
#[serde(untagged)]
pub enum SensorDevice {
    Boolean { value: bool },
    Text { value: String },
    Number { value: f64 },
    Color(ControllableState),
}

impl Display for SensorDevice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            SensorDevice::Boolean { value } => value.to_string(),
            SensorDevice::Text { value } => value.to_string(),
            SensorDevice::Number { value } => value.to_string(),
            SensorDevice::Color(state) => state.to_string(),
        };

        f.write_str(&s)
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub enum DeviceData {
    /// This device type can both be read and written to
    Controllable(ControllableDevice),

    /// This device type can only be read from
    Sensor(SensorDevice),
}

impl Display for DeviceData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            DeviceData::Controllable(light) => light.state.to_string(),
            DeviceData::Sensor(sensor) => sensor.to_string(),
        };

        f.write_str(&s)
    }
}

impl DeviceData {
    pub fn is_state_eq(&self, other: &DeviceData) -> bool {
        match (&self, &other) {
            (DeviceData::Controllable(a), DeviceData::Controllable(b)) => {
                cmp_device_states(a, &b.state)
            }
            (DeviceData::Sensor(a), DeviceData::Sensor(b)) => cmp_sensor_states(a, b),
            _ => false,
        }
    }
}

/// Compares light colors in the color mode as preferred by the device, allowing
/// slight deltas to account for rounding errors.
///
/// If the colors match, the function evaluates to true.
fn cmp_light_color(
    capabilities: &Capabilities,
    incoming: &Option<DeviceColor>,
    incoming_bri: &Option<f32>,
    expected: &Option<DeviceColor>,
    expected_bri: &Option<f32>,
) -> bool {
    // If brightness mismatches, the light state is not equal
    let bri_delta = 0.01;
    if f32::abs(incoming_bri.unwrap_or(1.0) - expected_bri.unwrap_or(1.0)) > bri_delta {
        return false;
    }

    // Convert expected color to supported color mode before performing comparison
    let expected_converted = expected
        .as_ref()
        .and_then(|c| c.to_device_preferred_mode(capabilities));

    // If colors are equal by PartialEq, the light state is equal
    if incoming.as_ref() == expected_converted.as_ref() {
        return true;
    }

    // Otherwise compare colors by components, allow slight deltas to account
    // for rounding errors
    let hue_delta = 1;
    let sat_delta = 0.01;
    let xy_delta = 0.01;
    let cct_delta = 10;

    match (incoming, expected_converted) {
        (Some(DeviceColor::Xy(a)), Some(DeviceColor::Xy(b))) => {
            // Light state is equal if all components differ by less than a given delta
            (f32::abs(*a.x - *b.x) <= xy_delta) && (f32::abs(*a.y - *b.y) <= xy_delta)
        }
        (Some(DeviceColor::Hs(a)), Some(DeviceColor::Hs(b))) => {
            // Light state is equal if all components differ by less than a given delta
            (u64::abs_diff(a.h, b.h) <= hue_delta) && (f32::abs(*a.s - *b.s) <= sat_delta)
        }
        (Some(DeviceColor::Ct(a)), Some(DeviceColor::Ct(b))) => {
            u64::abs_diff(a.ct, b.ct) <= cct_delta
        }
        (_, _) => false,
    }
}

/// Compares the state of a ControllableDevice to some given ControllableState.
///
/// If the states match, the function evaluates to true.
pub fn cmp_device_states(device: &ControllableDevice, expected: &ControllableState) -> bool {
    if device.state.power != expected.power {
        return false;
    }

    // If both lights are turned off, state matches
    if !device.state.power && !expected.power {
        return true;
    }

    // If one state has color and the other doesn't, states don't match
    if device.state.color.is_some() != expected.color.is_some() {
        return false;
    }

    // Compare colors if supported
    if device.state.color.is_some() {
        return cmp_light_color(
            &device.capabilities,
            &device.state.color,
            &device.state.brightness.map(|b| b.into_inner()),
            &expected.color,
            &expected.brightness.map(|b| b.into_inner()),
        );
    }

    true
}

/// Compares the state of two sensor devices.
///
/// If the states match, the function evaluates to true.
fn cmp_sensor_states(sensor: &SensorDevice, previous: &SensorDevice) -> bool {
    sensor == previous
}

pub struct DeviceRow {
    pub device_id: String,
    pub name: String,
    pub integration_id: String,
    pub state: sqlx::types::Json<DeviceData>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Device {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub data: DeviceData,

    #[ts(type = "Record<string, any> | null")]
    pub raw: Option<serde_json::Value>,
}

impl Display for Device {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{} [{}]", self.integration_id, self.name, self.data)
    }
}

impl From<DeviceRow> for Device {
    fn from(row: DeviceRow) -> Self {
        Device {
            id: row.device_id.into(),
            name: row.name,
            integration_id: row.integration_id.into(),
            data: row.state.0,
            raw: None,
        }
    }
}

impl Device {
    pub fn new(
        integration_id: IntegrationId,
        id: DeviceId,
        name: String,
        state: DeviceData,
        raw: Option<serde_json::Value>,
    ) -> Device {
        Device {
            id,
            name,
            integration_id,
            data: state,
            raw,
        }
    }

    pub fn is_state_eq(&self, other: &Device) -> bool {
        self.data.is_state_eq(&other.data) && self.raw == other.raw
    }

    pub fn get_device_key(&self) -> DeviceKey {
        DeviceKey {
            integration_id: self.integration_id.clone(),
            device_id: self.id.clone(),
        }
    }

    pub fn get_scene_id(&self) -> Option<SceneId> {
        match &self.data {
            DeviceData::Controllable(ControllableDevice { scene_id, .. }) => scene_id.clone(),
            DeviceData::Sensor(_) => None,
        }
    }

    /// Sets scene to the provided scene_id.
    ///
    /// If scene_id is set, the returned device's state will be computed from
    /// that scene.
    pub fn set_scene(&self, scene_id: Option<&SceneId>, scenes: &Scenes) -> Self {
        let mut device = self.clone();

        if !device.is_managed() {
            return device;
        }

        if let DeviceData::Controllable(ref mut data) = device.data {
            data.scene_id = scene_id.cloned();

            if let Some(scene_id) = scene_id {
                let state = scenes.get_device_scene_state(scene_id, &self.get_device_key());

                if let Some(state) = state {
                    data.state = state.clone();
                } else {
                    warn!(
                        "Could not find device scene state for device: {integration_id}/{name}, scene_id: {scene_id}",
                        integration_id = self.integration_id,
                        name = self.name,
                    );
                }
            }
        }

        device
    }

    pub fn is_powered_on(&self) -> Option<bool> {
        match &self.data {
            DeviceData::Controllable(data) => Some(data.state.power),
            // Doesn't make sense for sensors
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn get_controllable_state(&self) -> Option<&ControllableState> {
        match self.data {
            DeviceData::Controllable(ref data) => Some(&data.state),
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn dim_device(&mut self, amount: f32) -> Self {
        let mut device = self.clone();

        if let DeviceData::Controllable(ref mut data) = device.data {
            data.dim(amount);
        }
        device
    }

    pub fn color_to_mode(&self, mode: ColorMode, skip_ct_conversion: bool) -> Device {
        let mut device = self.clone();

        if let DeviceData::Controllable(controllable) = &mut device.data {
            if skip_ct_conversion && controllable.state.is_ct() {
                return device;
            }

            let converted_state = controllable
                .state
                .color_to_device_preferred_mode(&Capabilities::singleton(mode));
            controllable.state = converted_state;
        }

        device
    }

    pub fn get_supported_color_modes(&self) -> Option<&Capabilities> {
        match self.data {
            DeviceData::Controllable(ref data) => Some(&data.capabilities),
            DeviceData::Sensor(_) => None,
        }
    }

    /// Converts device color to the preferred color mode of the device
    pub fn color_to_preferred_mode(&self) -> Device {
        let state = self.get_controllable_state();
        let capabilities = self.get_supported_color_modes();

        if let (Some(state), Some(capabilities)) = (state, capabilities) {
            let converted_state = state.color_to_device_preferred_mode(capabilities);

            self.set_controllable_state(converted_state)
        } else {
            self.clone()
        }
    }

    pub fn is_sensor(&self) -> bool {
        matches!(self.data, DeviceData::Sensor(_))
    }

    pub fn is_readonly(&self) -> bool {
        matches!(
            self.data,
            DeviceData::Controllable(ControllableDevice {
                managed: ManageKind::UnmanagedReadOnly | ManageKind::FullReadOnly,
                ..
            })
        )
    }

    pub fn get_sensor_state(&self) -> Option<&SensorDevice> {
        match self.data {
            DeviceData::Controllable(_) => None,
            DeviceData::Sensor(ref data) => Some(data),
        }
    }

    pub fn set_controllable_state(&self, state: ControllableState) -> Device {
        let mut device = self.clone();

        if let DeviceData::Controllable(ref mut data) = device.data {
            data.state = state;
        }

        device
    }

    pub fn set_transition(&self, transition: Option<f32>) -> Device {
        let mut device = self.clone();

        if let DeviceData::Controllable(ref mut data) = device.data {
            data.state.transition = transition.map(OrderedFloat);
        }

        device
    }

    pub fn get_value(&self) -> serde_json::Value {
        match self.data {
            DeviceData::Controllable(ref data) => serde_json::to_value(data).unwrap(),
            DeviceData::Sensor(ref data) => serde_json::to_value(data).unwrap(),
        }
    }

    pub fn get_raw_value(&self) -> &Option<serde_json::Value> {
        &self.raw
    }

    pub fn is_managed(&self) -> bool {
        match self.data {
            DeviceData::Controllable(ref data) => {
                matches!(
                    data.managed,
                    ManageKind::Full
                        | ManageKind::FullReadOnly
                        | ManageKind::Partial {
                            prev_change_committed: false
                        }
                )
            }
            DeviceData::Sensor(_) => false,
        }
    }

    pub fn set_value(&self, value: &serde_json::Value) -> Result<Device> {
        let mut device = self.clone();

        if let DeviceData::Controllable(ref mut data) = device.data {
            if let Some(brightness) = value.get("brightness").and_then(|b| b.as_f64()) {
                data.state.brightness = Some(OrderedFloat(brightness as f32));
                data.scene_id = None;
            }
            if let Some(power) = value.get("power").and_then(|b| b.as_bool()) {
                data.state.power = power;
                data.scene_id = None;
            }
            if let Some(transition) = value.get("transition_ms").and_then(|b| b.as_f64()) {
                data.state.transition = Some(OrderedFloat(transition as f32));
                data.scene_id = None;
            }
            if let Some(color) = value.get("color") {
                data.state.color = Some(serde_json::from_value(color.clone())?);
                data.scene_id = None;
            }
        }

        Ok(device)
    }
}

#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize, PartialOrd, Ord)]
#[ts(export)]
pub struct DeviceIdRef {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

impl DeviceIdRef {
    pub fn into_device_key(self) -> DeviceKey {
        DeviceKey {
            integration_id: self.integration_id,
            device_id: self.device_id,
        }
    }
}

#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize, PartialOrd, Ord)]
#[ts(export)]
pub struct DeviceNameRef {
    pub integration_id: IntegrationId,
    pub name: String,
}

/// A reference to a device, either by name or by id
#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize, PartialOrd, Ord)]
#[serde(untagged)]
#[ts(export)]
pub enum DeviceRef {
    Id(DeviceIdRef),
    Name(DeviceNameRef),
}

impl DeviceRef {
    #[allow(dead_code)]
    pub fn new_with_id(integration_id: IntegrationId, device_id: DeviceId) -> DeviceRef {
        DeviceRef::Id(DeviceIdRef {
            integration_id,
            device_id,
        })
    }

    pub fn new_with_name(integration_id: IntegrationId, name: String) -> DeviceRef {
        DeviceRef::Name(DeviceNameRef {
            integration_id,
            name,
        })
    }
}

impl From<&DeviceKey> for DeviceRef {
    fn from(value: &DeviceKey) -> Self {
        DeviceRef::Id(DeviceIdRef {
            integration_id: value.integration_id.clone(),
            device_id: value.device_id.clone(),
        })
    }
}

/// A reference to a device, always by id, serializes to `integration_id/device_id`
#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Ord, PartialOrd)]
#[ts(type = "string")]
pub struct DeviceKey {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

impl DeviceKey {
    pub fn new(integration_id: IntegrationId, device_id: DeviceId) -> DeviceKey {
        DeviceKey {
            integration_id,
            device_id,
        }
    }
}

impl Display for DeviceKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.integration_id, self.device_id)
    }
}

impl Serialize for DeviceKey {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct DeviceKeyVisitor;

impl Visitor<'_> for DeviceKeyVisitor {
    type Value = DeviceKey;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a pair of strings separated by a forward slash")
    }

    fn visit_str<E>(self, s: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if let Some((integration_id, device_id)) = s.split_once('/') {
            let integration_id = IntegrationId::from(integration_id.to_string());
            let device_id = DeviceId::from(device_id.to_string());

            Ok(DeviceKey::new(integration_id, device_id))
        } else {
            Err(de::Error::invalid_value(Unexpected::Str(s), &self))
        }
    }
}

impl<'de> Deserialize<'de> for DeviceKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_string(DeviceKeyVisitor)
    }
}

#[derive(TS, Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[ts(export)]
pub struct DevicesState(pub BTreeMap<DeviceKey, Device>);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::color::Rgb;
    use serde_json;

    #[test]
    fn test_sensor_device_serialization() {
        // Test Boolean variant
        let boolean_sensor = SensorDevice::Boolean { value: true };
        let serialized = serde_json::to_string(&boolean_sensor).unwrap();
        println!("Boolean sensor serialized: {}", serialized);
        assert_eq!(serialized, r#"{"value":true}"#);

        // Test Text variant
        let text_sensor = SensorDevice::Text {
            value: "test".to_string(),
        };
        let serialized = serde_json::to_string(&text_sensor).unwrap();
        println!("Text sensor serialized: {}", serialized);
        assert_eq!(serialized, r#"{"value":"test"}"#);

        // Test Number variant
        let number_sensor = SensorDevice::Number { value: 42.5 };
        let serialized = serde_json::to_string(&number_sensor).unwrap();
        println!("Number sensor serialized: {}", serialized);
        assert_eq!(serialized, r#"{"value":42.5}"#);

        // Test Color variant
        let color_sensor = SensorDevice::Color(ControllableState {
            power: true,
            brightness: Some(OrderedFloat(0.8)),
            color: Some(DeviceColor::Rgb(Rgb { r: 255, g: 0, b: 0 })),
            transition: Some(OrderedFloat(1.0)),
        });
        let serialized = serde_json::to_string(&color_sensor).unwrap();
        println!("Color sensor serialized: {}", serialized);
        assert_eq!(
            serialized,
            r#"{"power":true,"brightness":0.8,"color":{"r":255,"g":0,"b":0},"transition":1.0}"#
        );
    }

    #[test]
    fn test_sensor_device_deserialization() {
        // Test Boolean variant
        let json = r#"{"value":true}"#;
        let deserialized: SensorDevice = serde_json::from_str(json).unwrap();
        assert_eq!(deserialized, SensorDevice::Boolean { value: true });

        // Test Text variant
        let json = r#"{"value":"test"}"#;
        let deserialized: SensorDevice = serde_json::from_str(json).unwrap();
        assert_eq!(
            deserialized,
            SensorDevice::Text {
                value: "test".to_string()
            }
        );

        // Test Number variant
        let json = r#"{"value":42.5}"#;
        let deserialized: SensorDevice = serde_json::from_str(json).unwrap();
        assert_eq!(deserialized, SensorDevice::Number { value: 42.5 });

        // Test Color variant
        let json =
            r#"{"power":true,"brightness":0.8,"color":{"r":255,"g":0,"b":0},"transition":1.0}"#;
        let deserialized: SensorDevice = serde_json::from_str(json).unwrap();
        assert_eq!(
            deserialized,
            SensorDevice::Color(ControllableState {
                power: true,
                brightness: Some(OrderedFloat(0.8)),
                color: Some(DeviceColor::Rgb(Rgb { r: 255, g: 0, b: 0 })),
                transition: Some(OrderedFloat(1.0)),
            })
        );
    }
}
