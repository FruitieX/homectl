use std::{
    collections::HashMap,
    fmt::{self, Display},
    ops::Range,
};

use super::{integration::IntegrationId, scene::SceneId};
use chrono::{DateTime, Utc};
use palette::Hsv;
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

/// simple on/off devices such as relays, lights
#[derive(TS, Copy, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct OnOffDevice {
    pub power: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub enum DeviceColor {
    // TODO: use Lch, or Yxy?
    Hsv(Hsv),

    Cct(CorrelatedColorTemperature),
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct CorrelatedColorTemperature {
    cct: f32,

    #[ts(skip)]
    device_range: Range<f32>,
}

impl CorrelatedColorTemperature {
    pub fn new(cct: f32, device_range: Range<f32>) -> CorrelatedColorTemperature {
        CorrelatedColorTemperature { cct, device_range }
    }

    pub fn get_cct(&self) -> f32 {
        self.cct
    }

    pub fn get_device_range(&self) -> &Range<f32> {
        &self.device_range
    }
}

impl Default for CorrelatedColorTemperature {
    fn default() -> Self {
        Self {
            cct: 4000.0,
            device_range: Range {
                start: 2000.0,
                end: 6500.0,
            },
        }
    }
}

/// lights with adjustable brightness and/or color
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Light {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<f32>,

    /// Current color, if supported
    #[ts(
        type = "{ Hsv: { hue: number, saturation: number, value: number } } | { Cct: { cct: number } } | null"
    )]
    pub color: Option<DeviceColor>,

    /// Transition time in milliseconds
    pub transition_ms: Option<u64>,
}

impl Light {
    pub fn new(
        power: bool,
        brightness: Option<f32>,
        color: Option<DeviceColor>,
        transition_ms: Option<u64>,
    ) -> Light {
        Light {
            power,
            brightness,
            color,
            transition_ms,
        }
    }
}

/// lights with multiple individually adjustable light sources
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct MultiSourceLight {
    pub power: bool,

    /// Global brightness control for all lights in this MultiSourceLight
    pub brightness: Option<f32>,

    /// List of colors, one for each light in this MultiSourceLight
    #[ts(type = "String")]
    pub lights: Vec<DeviceColor>,
}

/// button sensors, motion sensors
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub enum SensorKind {
    OnOffSensor {
        value: bool,
    },
    DimmerSwitch {
        on: bool,
        up: bool,
        down: bool,
        off: bool,
    },
    StringValue {
        value: String,
    },
    Temperature {
        value: f64,
    },
    LightLevel {
        lightlevel: f64,
        dark: bool,
        daylight: bool,
    },
    Unknown,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub enum DeviceState {
    OnOffDevice(OnOffDevice),
    Light(Light),
    MultiSourceLight(MultiSourceLight),
    Sensor(SensorKind),
}

impl Display for DeviceState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            DeviceState::OnOffDevice(_) => "OnOffDevice".to_string(),
            DeviceState::Light(light) => {
                if !light.power {
                    "off".to_string()
                } else if let Some(DeviceColor::Hsv(color)) = light.color {
                    format!(
                        "hsv({}, {}, {})",
                        color.hue.into_positive_degrees(),
                        color.saturation,
                        color.value
                    )
                } else if let Some(DeviceColor::Cct(cct)) = &light.color {
                    format!("cct({})", cct.get_cct())
                } else if let Some(bri) = light.brightness {
                    format!("bri({})", bri)
                } else {
                    "on".to_string()
                }
            }
            DeviceState::MultiSourceLight(_) => "MultiSourceLight".to_string(),
            DeviceState::Sensor(_) => "Sensor".to_string(),
        };

        f.write_str(&s)
    }
}

impl DeviceState {
    pub fn is_powered_on(&self) -> Option<bool> {
        match self {
            DeviceState::OnOffDevice(device) => Some(device.power),
            DeviceState::Light(device) => Some(device.power),
            DeviceState::MultiSourceLight(device) => Some(device.power),
            // Doesn't make sense for sensors
            DeviceState::Sensor(_) => None,
        }
    }
}

/// active scene that's controlling the device state, if any
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct DeviceSceneState {
    pub scene_id: SceneId,

    #[ts(type = "String")]
    pub activation_time: DateTime<Utc>,
}

impl DeviceSceneState {
    pub fn new(scene_id: SceneId) -> DeviceSceneState {
        DeviceSceneState {
            scene_id,
            activation_time: Utc::now(),
        }
    }
}

pub struct DeviceRow {
    pub device_id: String,
    pub name: String,
    pub integration_id: String,
    pub scene_id: Option<String>,
    pub state: sqlx::types::Json<DeviceState>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Device {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub state: DeviceState,
}

impl From<DeviceRow> for Device {
    fn from(row: DeviceRow) -> Self {
        Device {
            id: row.device_id.into(),
            name: row.name,
            integration_id: row.integration_id.into(),
            scene: row.scene_id.map(SceneId::new).map(DeviceSceneState::new),
            state: row.state.0,
        }
    }
}

impl Device {
    pub fn new(
        integration_id: IntegrationId,
        id: DeviceId,
        name: String,
        state: DeviceState,
    ) -> Device {
        Device {
            id,
            name,
            integration_id,
            scene: None,
            state,
        }
    }

    pub fn get_device_key(&self) -> DeviceKey {
        DeviceKey {
            integration_id: self.integration_id.clone(),
            device_id: self.id.clone(),
        }
    }

    pub fn get_scene_id(&self) -> Option<&SceneId> {
        self.scene.as_ref().map(|scene| &scene.scene_id)
    }
}

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
        formatter.write_str("a colon-separated pair of integers between 0 and 255")
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
