use std::{
    collections::HashMap,
    fmt::{self, Display},
    ops::Range,
};

use crate::utils::xy_to_cct;

use super::{integration::IntegrationId, scene::SceneId};
use chrono::{DateTime, Utc};
use palette::{Hsv, Yxy};
use serde::{
    de::{self, Unexpected, Visitor},
    Deserialize, Serialize,
};

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!, NewtypeFrom!)]
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

    pub fn set_cct(&self, cct: f32) -> CorrelatedColorTemperature {
        let mut x = self.clone();
        x.cct = cct;
        x
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
            CorrelatedColorTemperature::new(
                cct,
                Range {
                    start: 2000.0,
                    end: 6500.0,
                },
            )
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
                        color.hue.to_positive_degrees(),
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

    pub fn set_power(&mut self, power: bool) {
        match self {
            DeviceState::OnOffDevice(device) => {
                device.power = power;
            }
            DeviceState::Light(device) => {
                device.power = power;
            }
            DeviceState::MultiSourceLight(device) => {
                device.power = power;
            }
            // Doesn't make sense for sensors
            DeviceState::Sensor(_) => {}
        }
    }

    pub fn get_color(&self) -> Option<Hsv> {
        match self {
            DeviceState::OnOffDevice(_) => None,
            DeviceState::Light(state) => {
                if !state.power {
                    Some(Hsv::new(0.0, 0.0, 0.0))
                } else {
                    state.color
                }
            }
            DeviceState::MultiSourceLight(_) => None,
            DeviceState::Sensor(_) => None,
        }
    }

    pub fn get_brightness(&self) -> Option<f32> {
        match self {
            DeviceState::OnOffDevice(_) => None,
            DeviceState::Light(state) => state.brightness,
            DeviceState::MultiSourceLight(_) => None,
            DeviceState::Sensor(_) => None,
        }
    }

    pub fn set_hue(&mut self, hue: f32) {
        match self {
            DeviceState::OnOffDevice(_) => {}
            DeviceState::Light(state) => {
                let old_color = state.color.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
                let saturation = old_color.saturation;
                let value = old_color.value;
                let color = Some(Hsv::new(hue, saturation, value));
                state.color = color
            }
            DeviceState::MultiSourceLight(_) => {}
            DeviceState::Sensor(_) => {}
        }
    }

    pub fn set_saturation(&mut self, saturation: f32) {
        match self {
            DeviceState::OnOffDevice(_) => {}
            DeviceState::Light(state) => {
                let old_color = state.color.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
                let hue = old_color.hue;
                let value = old_color.value;
                let color = Some(Hsv::new(hue, saturation, value));
                state.color = color
            }
            DeviceState::MultiSourceLight(_) => {}
            DeviceState::Sensor(_) => {}
        }
    }

    pub fn set_value(&mut self, value: f32) {
        match self {
            DeviceState::OnOffDevice(_) => {}
            DeviceState::Light(state) => {
                let old_color = state.color.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
                let hue = old_color.hue;
                let saturation = old_color.saturation;
                let color = Some(Hsv::new(hue, saturation, value));
                state.color = color
            }
            DeviceState::MultiSourceLight(_) => {}
            DeviceState::Sensor(_) => {}
        }
    }

    pub fn get_cct(&self) -> Option<CorrelatedColorTemperature> {
        match self {
            DeviceState::OnOffDevice(_) => None,
            DeviceState::Light(state) => state.cct.clone(),
            DeviceState::MultiSourceLight(_) => None,
            DeviceState::Sensor(_) => None,
        }
    }

    pub fn set_cct(&mut self, cct: f32) {
        match self {
            DeviceState::OnOffDevice(_) => {}
            DeviceState::Light(state) => {
                let old_cct = state.cct.clone().unwrap_or_default();
                state.cct = Some(old_cct.set_cct(cct))
            }
            DeviceState::MultiSourceLight(_) => {}
            DeviceState::Sensor(_) => {}
        }
    }
}

/// active scene that's controlling the device state, if any
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct DeviceSceneState {
    pub scene_id: SceneId,

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

#[cfg(feature = "backend")]
pub struct DeviceRow {
    pub device_id: String,
    pub name: String,
    pub integration_id: String,
    pub scene_id: Option<String>,
    pub state: sqlx::types::Json<DeviceState>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Device {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub state: DeviceState,
}

#[cfg(feature = "backend")]
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

    pub fn get_state_key(&self) -> DeviceStateKey {
        DeviceStateKey {
            integration_id: self.integration_id.clone(),
            device_id: self.id.clone(),
        }
    }

    pub fn get_scene_id(&self) -> Option<&SceneId> {
        self.scene.as_ref().map(|scene| &scene.scene_id)
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
        if let Some((integration_id, device_id)) = s.split_once("/") {
            let integration_id = IntegrationId::from(integration_id.to_string());
            let device_id = DeviceId::from(device_id.to_string());

            Ok(DeviceStateKey::new(integration_id, device_id))
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
