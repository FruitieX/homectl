use std::{
    collections::HashMap,
    fmt::{self, Display},
};

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
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
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

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct ManagedDeviceState {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<f32>,

    /// Current color, if supported
    pub color: Option<DeviceColor>,

    /// Transition time in milliseconds
    pub transition_ms: Option<u64>,
}

impl Display for ManagedDeviceState {
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

impl ManagedDeviceState {
    pub fn color_to_device_preferred_mode(&self, capabilities: &Capabilities) -> Self {
        let mut state = self.clone();

        if let Some(color) = state.color {
            state.color = color.to_device_preferred_mode(capabilities);
        }

        state
    }
}

/// lights with adjustable brightness and/or color
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct ManagedDevice {
    pub scene: Option<SceneId>,
    pub capabilities: Capabilities,
    pub state: ManagedDeviceState,
}

impl ManagedDevice {
    pub fn new(
        scene: Option<SceneId>,
        power: bool,
        brightness: Option<f32>,
        color: Option<DeviceColor>,
        transition_ms: Option<u64>,
        capabilities: Capabilities,
    ) -> ManagedDevice {
        ManagedDevice {
            scene,
            state: ManagedDeviceState {
                power,
                brightness,
                color,
                transition_ms,
            },
            capabilities,
        }
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
#[serde(untagged)]
pub enum SensorDevice {
    Boolean { value: bool },
    Text { value: String },
    Color(ManagedDeviceState),
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub enum DeviceData {
    Managed(ManagedDevice),
    Sensor(SensorDevice),
}

impl Display for DeviceData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            DeviceData::Managed(light) => light.state.to_string(),
            DeviceData::Sensor(_) => "Sensor".to_string(),
        };

        f.write_str(&s)
    }
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
}

impl From<DeviceRow> for Device {
    fn from(row: DeviceRow) -> Self {
        Device {
            id: row.device_id.into(),
            name: row.name,
            integration_id: row.integration_id.into(),
            data: row.state.0,
        }
    }
}

impl Device {
    pub fn new(
        integration_id: IntegrationId,
        id: DeviceId,
        name: String,
        state: DeviceData,
    ) -> Device {
        Device {
            id,
            name,
            integration_id,
            data: state,
        }
    }

    pub fn get_device_key(&self) -> DeviceKey {
        DeviceKey {
            integration_id: self.integration_id.clone(),
            device_id: self.id.clone(),
        }
    }

    pub fn get_scene(&self) -> Option<SceneId> {
        match &self.data {
            DeviceData::Managed(ManagedDevice { scene, .. }) => scene.clone(),
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn set_scene(&self, scene: Option<SceneId>) -> Self {
        let mut device = self.clone();

        if let DeviceData::Managed(ref mut data) = device.data {
            data.scene = scene;
        }

        device
    }

    pub fn is_powered_on(&self) -> Option<bool> {
        match &self.data {
            DeviceData::Managed(data) => Some(data.state.power),
            // Doesn't make sense for sensors
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn get_managed_state(&self) -> Option<&ManagedDeviceState> {
        match self.data {
            DeviceData::Managed(ref data) => Some(&data.state),
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn color_to_mode(&self, mode: ColorMode) -> Device {
        let mut device = self.clone();

        if let DeviceData::Managed(managed) = &mut device.data {
            let converted_state = managed
                .state
                .color_to_device_preferred_mode(&Capabilities::singleton(mode));
            managed.state = converted_state;
        }

        device
    }

    pub fn get_supported_color_modes(&self) -> Option<&Capabilities> {
        match self.data {
            DeviceData::Managed(ref data) => Some(&data.capabilities),
            DeviceData::Sensor(_) => None,
        }
    }

    pub fn is_sensor(&self) -> bool {
        matches!(self.data, DeviceData::Sensor(_))
    }

    pub fn get_sensor_state(&self) -> Option<&SensorDevice> {
        match self.data {
            DeviceData::Managed(_) => None,
            DeviceData::Sensor(ref data) => Some(data),
        }
    }

    pub fn set_managed_state(&self, state: ManagedDeviceState) -> Device {
        let mut device = self.clone();

        if let DeviceData::Managed(ref mut data) = device.data {
            data.state = state;
        }

        device
    }
}

#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[ts(export)]
pub struct DeviceIdRef {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[ts(export)]
pub struct DeviceNameRef {
    pub integration_id: IntegrationId,
    pub name: String,
}

/// A reference to a device, either by name or by id
#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
#[ts(export)]
pub enum DeviceRef {
    Id(DeviceIdRef),
    Name(DeviceNameRef),
}

impl DeviceRef {
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

    pub fn integration_id(&self) -> &IntegrationId {
        match self {
            DeviceRef::Id(id) => &id.integration_id,
            DeviceRef::Name(name) => &name.integration_id,
        }
    }

    pub fn device_id(&self) -> Option<&DeviceId> {
        match self {
            DeviceRef::Id(id) => Some(&id.device_id),
            DeviceRef::Name(_) => None,
        }
    }

    pub fn name(&self) -> Option<&String> {
        match self {
            DeviceRef::Id(_) => None,
            DeviceRef::Name(name) => Some(&name.name),
        }
    }
}

/// A reference to a device, always by id, serializes to `integration_id/device_id`
#[derive(TS, Hash, Clone, Debug, PartialEq, Eq)]
#[ts(export)]
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

impl<'de> Visitor<'de> for DeviceKeyVisitor {
    type Value = DeviceKey;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a colon-separated pair of strings")
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
pub struct DevicesState(pub HashMap<DeviceKey, Device>);
