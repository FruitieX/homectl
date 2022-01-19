use std::{
    collections::HashMap,
    fmt::{self, Display},
    ops::Range,
};

use crate::utils::xy_to_cct;

use super::{integration::IntegrationId, scene::SceneId};
use chrono::{DateTime, Utc};
use palette::{Hsv, Yxy};
use regex::Regex;
use serde::{
    de::{self, Unexpected, Visitor},
    Deserialize, Serialize,
};
use std::str::FromStr;

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
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
#[derive(Copy, Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct OnOffDevice {
    pub power: bool,
}

// TODO: use Lch?
pub type DeviceColor = Hsv;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct CorrelatedColorTemperature {
    cct: f32,
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

/// lights with adjustable brightness and/or color
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Light {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<f32>,

    /// Current color, if supported
    pub color: Option<DeviceColor>,

    /// Current color temperature, if supported
    pub cct: Option<CorrelatedColorTemperature>,

    /// Transition time in milliseconds
    pub transition_ms: Option<u64>,
}

impl Light {
    pub fn new_with_color(
        power: bool,
        brightness: Option<f32>,
        color: Option<DeviceColor>,
        transition_ms: Option<u64>,
    ) -> Light {
        let xy: Option<Yxy> = color.map(|c| c.into());
        let cct = xy.as_ref().map(|xy| {
            let cct = xy_to_cct(xy);
            CorrelatedColorTemperature {
                cct,
                device_range: Range {
                    start: 2000.0,
                    end: 6500.0,
                },
            }
        });

        Light {
            power,
            brightness,
            color,
            cct,
            transition_ms,
        }
    }

    pub fn new_with_cct(
        power: bool,
        brightness: Option<f32>,
        cct: Option<CorrelatedColorTemperature>,
        transition_ms: Option<u64>,
    ) -> Light {
        Light {
            power,
            brightness,
            color: None,
            cct,
            transition_ms,
        }
    }
}

/// lights with multiple individually adjustable light sources
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct MultiSourceLight {
    pub power: bool,

    /// Global brightness control for all lights in this MultiSourceLight
    pub brightness: Option<f32>,

    /// List of colors, one for each light in this MultiSourceLight
    pub lights: Vec<DeviceColor>,
}

/// button sensors, motion sensors
#[derive(Copy, Clone, Debug, PartialEq, Deserialize, Serialize)]
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
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
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
                } else if let Some(color) = light.color {
                    format!(
                        "hsv({}, {}, {})",
                        color.hue.to_degrees(),
                        color.saturation,
                        color.value
                    )
                } else if let Some(cct) = &light.cct {
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
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct DeviceSceneState {
    pub scene_id: SceneId,

    pub activation_time: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Device {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub state: DeviceState,
    pub locked: bool,
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
            locked: false,
        }
    }

    pub fn get_state_key(&self) -> DeviceStateKey {
        DeviceStateKey {
            integration_id: self.integration_id.clone(),
            device_id: self.id.clone(),
        }
    }
}

#[derive(Hash, Clone, Debug, PartialEq, Eq)]
pub struct DeviceStateKey {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

impl DeviceStateKey {
    pub fn new(integration_id: IntegrationId, device_id: DeviceId) -> DeviceStateKey {
        DeviceStateKey {
            integration_id,
            device_id,
        }
    }
}

impl Display for DeviceStateKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.integration_id, self.device_id)
    }
}

impl Serialize for DeviceStateKey {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct DeviceStateKeyVisitor;

impl<'de> Visitor<'de> for DeviceStateKeyVisitor {
    type Value = DeviceStateKey;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a colon-separated pair of integers between 0 and 255")
    }

    fn visit_str<E>(self, s: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        static RE: once_cell::sync::OnceCell<Regex> = once_cell::sync::OnceCell::new();
        let re = RE.get_or_init(|| Regex::new(r"(.+)/(.+)").unwrap());

        let mut captures = re.captures_iter(s);

        if let Some(nums) = captures.next() {
            let integration_id = IntegrationId::from(nums[1].to_string());

            // nums[0] is the whole match, so we must skip that
            if let Ok(device_id) = DeviceId::from_str(&nums[2]) {
                Ok(DeviceStateKey::new(integration_id, device_id))
            } else {
                Err(de::Error::invalid_value(Unexpected::Str(s), &self))
            }
        } else {
            Err(de::Error::invalid_value(Unexpected::Str(s), &self))
        }
    }
}

impl<'de> Deserialize<'de> for DeviceStateKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_string(DeviceStateKeyVisitor)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct DevicesState(pub HashMap<DeviceStateKey, Device>);
