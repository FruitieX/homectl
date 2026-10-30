use eyre::Result;
use ordered_float::OrderedFloat;
use std::{
    collections::BTreeMap,
    fmt::{self, Display},
};

use crate::core::{devices::Devices, scenes::Scenes};

use super::{
    color::{Capabilities, ColorMode, DeviceColor},
    group::GroupId,
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

    /// Active effect (preset) name, if supported. `None` means "not set": the
    /// effect is not requested, or the device reports a customised look.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effect: Option<String>,

    /// Colors of every color slot of the active effect, if the device has
    /// several. Slot 0 is the primary color; when `color` is also set it is
    /// authoritative for slot 0. `None` means "not set".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub colors: Option<Vec<DeviceColor>>,
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

            let s = if let Some(bri) = self.brightness {
                format!("{}, bri({})", color_str, bri)
            } else {
                color_str
            };

            let s = match &self.effect {
                Some(effect) if self.power => format!("{s}, effect({effect})"),
                _ => s,
            };

            match &self.colors {
                Some(colors) if self.power => format!("{s}, colors({})", colors.len()),
                _ => s,
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

        if let Some(colors) = &mut state.colors {
            // Keep slot positions stable: leave a color that cannot be
            // converted as it is instead of dropping its slot.
            for color in colors.iter_mut() {
                if let Some(converted) = color.to_device_preferred_mode(capabilities) {
                    *color = converted;
                }
            }
        }

        state
    }

    /// Color slots with `color` (when set) taking precedence for slot 0, as
    /// sent to devices with several color slots.
    pub fn colors_with_primary(&self) -> Option<Vec<DeviceColor>> {
        let mut colors = self.colors.clone()?;
        if let (Some(first), Some(color)) = (colors.first_mut(), &self.color) {
            *first = color.clone();
        }
        Some(colors)
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

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DeviceStateSourceScope {
    Device,
    Group,
    Script,
    Override,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DeviceStateSourceKind {
    DeviceState,
    DeviceLink,
    SceneLink,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct DeviceStateSource {
    pub scope: DeviceStateSourceScope,
    pub kind: DeviceStateSourceKind,
    pub group_id: Option<GroupId>,
    pub linked_scene_id: Option<SceneId>,
    pub linked_device_key: Option<DeviceKey>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct DeviceAvailability {
    pub online: bool,
    #[ts(type = "number")]
    pub observed_at_ms: i64,
}

/// Latest integration report, separate from the requested device state.
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct DeviceReport {
    pub state: ControllableState,
    #[ts(type = "number")]
    pub received_at_ms: i64,
    pub retained: bool,
    pub matches_requested: bool,
}

/// Requested state and the latest separately observed integration report.
#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct ControllableDevice {
    /// Projection of the integration's database-backed disabled_device_ids policy.
    #[serde(default)]
    #[ts(optional)]
    pub disabled: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub availability: Option<DeviceAvailability>,
    #[serde(default)]
    #[ts(optional)]
    pub last_report: Option<Box<DeviceReport>>,
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub requested_at_ms: Option<i64>,
    pub scene_id: Option<SceneId>,
    /// Manual state is held until the associated scene is explicitly activated again.
    #[serde(default)]
    pub scene_paused: bool,
    #[serde(default)]
    pub state_source: Option<DeviceStateSource>,
    #[serde(default)]
    pub capabilities: Capabilities,
    pub state: ControllableState,
    #[serde(default)]
    pub managed: ManageKind,
}

impl ControllableDevice {
    pub fn refresh_report_match(&mut self) {
        if let Some(report) = &self.last_report {
            let mut reported = self.clone();
            reported.state = report.state.clone();
            let matches = cmp_device_states(&reported, &self.state);
            self.last_report.as_mut().unwrap().matches_requested = matches;
        }
    }
    pub fn new(
        scene: Option<SceneId>,
        power: bool,
        brightness: Option<f32>,
        color: Option<DeviceColor>,
        transition: Option<f32>,
        mut capabilities: Capabilities,
        managed: ManageKind,
    ) -> ControllableDevice {
        capabilities.brightness.get_or_insert(
            brightness.is_some()
                || capabilities.xy
                || capabilities.hs
                || capabilities.rgb
                || capabilities.ct.is_some(),
        );
        ControllableDevice {
            disabled: None,
            availability: None,
            last_report: None,
            requested_at_ms: None,
            scene_id: scene,
            scene_paused: false,
            state_source: None,
            state: ControllableState {
                power,
                brightness: brightness.map(OrderedFloat),
                color,
                transition: transition.map(OrderedFloat),
                effect: None,
                colors: None,
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
    Boolean {
        value: bool,
    },
    Text {
        value: String,
    },
    Number {
        value: f64,
    },
    /// Several named numeric readings from one sensor, e.g. a BLE climate
    /// sensor's `temperature`, `humidity` and `battery`.
    Readings {
        readings: BTreeMap<String, f64>,
    },
    Color(ControllableState),
}

pub const UNKNOWN_SENSOR_PLACEHOLDER_VALUE: &str = "__homectl_unknown_sensor__";

impl SensorDevice {
    pub fn unknown_placeholder() -> Self {
        SensorDevice::Text {
            value: UNKNOWN_SENSOR_PLACEHOLDER_VALUE.to_string(),
        }
    }

    pub fn is_unknown_placeholder(&self) -> bool {
        matches!(
            self,
            SensorDevice::Text { value } if value == UNKNOWN_SENSOR_PLACEHOLDER_VALUE
        )
    }
}

impl Display for SensorDevice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            SensorDevice::Boolean { value } => value.to_string(),
            SensorDevice::Text { value } => value.to_string(),
            SensorDevice::Number { value } => value.to_string(),
            SensorDevice::Readings { readings } => readings
                .iter()
                .map(|(metric, value)| format!("{metric}={value}"))
                .collect::<Vec<_>>()
                .join(" "),
            SensorDevice::Color(state) => state.to_string(),
        };

        f.write_str(&s)
    }
}

// Controllable devices are the common case; boxing them would touch most of the
// codebase for a negligible copy cost.
#[allow(clippy::large_enum_variant)]
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
                // Also compare scene_id - if scene changes, state should be considered
                // different even if visual state (power, color, brightness) is identical
                a.scene_id == b.scene_id
                    && a.scene_paused == b.scene_paused
                    && a.state_source == b.state_source
                    // Requested effect/colors changes must never be dropped
                    // by the lenient report comparison below.
                    && a.state.effect == b.state.effect
                    && a.state.colors == b.state.colors
                    && cmp_device_states(a, &b.state)
            }
            (DeviceData::Sensor(a), DeviceData::Sensor(b)) => cmp_sensor_states(a, b),
            _ => false,
        }
    }
}

/// Maximum CIE 1976 u′v′ chromaticity distance treated as the same color.
/// Comparable to the old per-component xy tolerance, but uniformly perceptual
/// and independent of the color mode a device used to report the same color.
const CHROMATICITY_UV_DELTA: f32 = 0.0075;

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
    let bri_delta = 0.01 + f32::EPSILON;
    if f32::abs(incoming_bri.unwrap_or(1.0) - expected_bri.unwrap_or(1.0)) > bri_delta {
        return false;
    }

    // Convert expected color to supported color mode before performing comparison
    let expected_converted = expected.as_ref().and_then(|c| {
        let mut comparison = capabilities.clone();
        if let Some(incoming) = incoming {
            // Compare in the mode reported by the bridge. Otherwise a device
            // advertising several modes may always prefer XY during conversion,
            // making an equivalent CT/HS report look different.
            comparison.xy = false;
            comparison.hs = false;
            comparison.rgb = false;
            comparison.ct = None;
            comparison.xy = matches!(incoming, DeviceColor::Xy(_));
            comparison.hs = matches!(incoming, DeviceColor::Hs(_));
            comparison.rgb = matches!(incoming, DeviceColor::Rgb(_));
            if matches!(incoming, DeviceColor::Ct(_)) {
                comparison.ct = capabilities.ct.clone();
            }
        }
        c.to_device_preferred_mode(&comparison)
    });

    // If colors are equal by PartialEq, the light state is equal
    if incoming.as_ref() == expected_converted.as_ref() {
        return true;
    }

    // Otherwise compare colors by components, allow slight deltas to account
    // for rounding errors
    let hue_delta = 1;
    let sat_delta = 0.01 + f32::EPSILON;
    let xy_delta = 0.01 + f32::EPSILON;
    let cct_delta = 10;

    let components_match = match (incoming, &expected_converted) {
        (Some(DeviceColor::Xy(a)), Some(DeviceColor::Xy(b))) => {
            // Light state is equal if all components differ by less than a given delta
            (f32::abs(*a.x - *b.x) <= xy_delta) && (f32::abs(*a.y - *b.y) <= xy_delta)
        }
        (Some(DeviceColor::Hs(a)), Some(DeviceColor::Hs(b))) => {
            // Light state is equal if all components differ by less than a given delta
            ({
                let delta = u64::abs_diff(a.h % 360, b.h % 360);
                delta.min(360 - delta) <= hue_delta
            }) && (f32::abs(*a.s - *b.s) <= sat_delta)
        }
        (Some(DeviceColor::Ct(a)), Some(DeviceColor::Ct(b))) => {
            u64::abs_diff(a.ct, b.ct) <= cct_delta
        }
        (_, _) => false,
    };
    if components_match {
        return true;
    }

    // Final fallback: compare in the perceptually uniform CIE 1976 u′v′ plane.
    // Devices that map a received HS/CT command through their own gamut model
    // report an equivalent chromaticity in a different representation, which
    // should not be treated as drift.
    if let (Some(a), Some(b)) = (
        incoming.as_ref().and_then(DeviceColor::to_xy),
        expected_converted.as_ref().and_then(DeviceColor::to_xy),
    ) {
        return DeviceColor::uv_distance(&a, &b) <= CHROMATICITY_UV_DELTA;
    }

    false
}

/// Compares the state of a ControllableDevice to some given ControllableState.
///
/// If the states match, the function evaluates to true.
pub fn cmp_device_states(device: &ControllableDevice, expected: &ControllableState) -> bool {
    if device.state.power != expected.power {
        return false;
    }

    // Keep comparing color while off as well. Color changes are meaningful for
    // the next power-on and one-shot color actions rely on them being applied.
    if expected.color.is_some() && device.state.power && device.state.color.is_none() {
        return false;
    }

    if device.state.power
        && device
            .state
            .brightness
            .zip(expected.brightness)
            .is_some_and(|(a, b)| (a.0 - b.0).abs() > 0.01 + f32::EPSILON)
    {
        return false;
    }

    if !cmp_effect(device, expected) || !cmp_colors(device, expected) {
        return false;
    }

    // Compare colors if supported
    // ESPHome reports an off light with an UNKNOWN color mode as a sparse
    // snapshot (`{"color":{}}`). In that snapshot the stored color is
    // intentionally unavailable, so compare color only when the report is on
    // or actually contains a color value.
    if expected.color.is_some() && (device.state.power || device.state.color.is_some()) {
        return cmp_light_color(
            &device.capabilities,
            &device.state.color,
            &device
                .state
                .brightness
                .filter(|_| expected.power)
                .map(|b| b.into_inner()),
            &expected.color,
            &expected
                .brightness
                .filter(|_| expected.power)
                .map(|b| b.into_inner()),
        );
    }

    true
}

/// Compares the requested effect. An unset expected effect never conflicts.
///
/// Devices without effect support (no advertised effects and no reported
/// effect) are not compared, so a scene effect cannot fight such a device.
/// Devices report no effect once their look is customised; when the expected
/// state customises a color on top of the effect, that report is accepted
/// rather than re-applying the preset over the customised colors forever.
fn cmp_effect(device: &ControllableDevice, expected: &ControllableState) -> bool {
    let Some(expected_effect) = &expected.effect else {
        return true;
    };
    match &device.state.effect {
        Some(effect) => effect == expected_effect,
        // Like colors, a sparse report of an off device is not drift.
        None if !device.state.power => true,
        None => {
            device.capabilities.effects.is_empty()
                || expected.colors.is_some()
                || expected.color.is_some()
        }
    }
}

/// Compares the requested color slots. Unset expected colors never conflict,
/// and only slots present in both states are compared. Slot 0 is covered by
/// the `color` comparison when the expected state also sets `color`.
fn cmp_colors(device: &ControllableDevice, expected: &ControllableState) -> bool {
    let (Some(expected_colors), Some(device_colors)) = (&expected.colors, &device.state.colors)
    else {
        return true;
    };
    let skip = usize::from(expected.color.is_some());
    device_colors
        .iter()
        .zip(expected_colors.iter())
        .skip(skip)
        .all(|(incoming, expected)| {
            cmp_light_color(
                &device.capabilities,
                &Some(incoming.clone()),
                &None,
                &Some(expected.clone()),
                &None,
            )
        })
}

/// Compares the state of two sensor devices.
///
/// If the states match, the function evaluates to true.
fn cmp_sensor_states(sensor: &SensorDevice, previous: &SensorDevice) -> bool {
    sensor == previous
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

    pub fn is_scene_paused(&self) -> bool {
        matches!(
            &self.data,
            DeviceData::Controllable(ControllableDevice {
                scene_paused: true,
                ..
            })
        )
    }

    /// Sets scene to the provided scene_id.
    ///
    /// If scene_id is set, the returned device's state will be computed from
    /// that scene.
    pub fn set_scene(
        &self,
        scene_id: Option<&SceneId>,
        scenes: &Scenes,
        devices: &Devices,
    ) -> Self {
        let mut device = self.clone();

        if let DeviceData::Controllable(ref mut data) = device.data {
            if data.scene_id.as_ref() != scene_id {
                data.scene_paused = false;
            }
            data.scene_id = scene_id.cloned();
            data.state_source = None;

            if let Some(scene_id) =
                scene_id.filter(|_| !data.scene_paused && data.disabled != Some(true))
            {
                let state = scenes.get_device_scene_state_details(scene_id, self, devices);

                if let Some((state, state_source)) = state {
                    data.state = state;
                    data.state_source = Some(state_source);
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

    /// Explicit scene activation resumes a paused device, including when the
    /// activated scene has the same ID as the device's current scene.
    pub fn set_scene_and_resume(
        &self,
        scene_id: Option<&SceneId>,
        scenes: &Scenes,
        devices: &Devices,
    ) -> Self {
        let mut device = self.clone();
        if let DeviceData::Controllable(data) = &mut device.data {
            data.scene_paused = false;
        }
        device.set_scene(scene_id, scenes, devices)
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

    pub fn is_unknown_placeholder_sensor(&self) -> bool {
        self.get_sensor_state()
            .map(SensorDevice::is_unknown_placeholder)
            .unwrap_or(false)
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

/// A reference to a device by canonical id.
#[derive(TS, Hash, Clone, Debug, PartialEq, Eq, Deserialize, Serialize, PartialOrd, Ord)]
#[serde(untagged)]
#[ts(export)]
pub enum DeviceRef {
    Id(DeviceIdRef),
}

impl DeviceRef {
    #[allow(dead_code)]
    pub fn new_with_id(integration_id: IntegrationId, device_id: DeviceId) -> DeviceRef {
        DeviceRef::Id(DeviceIdRef {
            integration_id,
            device_id,
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
    fn scene_pause_round_trips_and_defaults_for_legacy_device_json() {
        let mut device = ControllableDevice::new(
            None,
            true,
            Some(0.6),
            None,
            None,
            Capabilities::default(),
            ManageKind::Unmanaged,
        );
        device.scene_id = Some(SceneId::new("evening".to_string()));
        device.scene_paused = true;

        let serialized = serde_json::to_value(&device).unwrap();
        assert_eq!(serialized["scene_paused"], true);
        let restored: ControllableDevice = serde_json::from_value(serialized.clone()).unwrap();
        assert!(restored.scene_paused);

        let mut legacy = serialized;
        legacy.as_object_mut().unwrap().remove("scene_paused");
        let restored: ControllableDevice = serde_json::from_value(legacy).unwrap();
        assert!(!restored.scene_paused);
    }

    fn effect_device() -> ControllableDevice {
        let mut capabilities = Capabilities::singleton(ColorMode::Hs);
        capabilities.effects = vec!["Aurora".to_string(), "Fire".to_string()];
        let mut device = ControllableDevice::new(
            None,
            true,
            Some(0.6),
            Some(DeviceColor::new_from_hs(30, 0.58)),
            None,
            capabilities,
            ManageKind::Full,
        );
        device.state.effect = Some("Aurora".to_string());
        device.state.colors = Some(vec![
            DeviceColor::new_from_hs(30, 0.58),
            DeviceColor::new_from_hs(270, 0.8),
        ]);
        device
    }

    #[test]
    fn legacy_state_json_deserializes_without_effect_or_colors() {
        let state: ControllableState = serde_json::from_value(serde_json::json!({
            "power": true,
            "brightness": 0.5,
            "color": { "h": 30, "s": 0.5 },
            "transition": null
        }))
        .unwrap();
        assert_eq!(state.effect, None);
        assert_eq!(state.colors, None);

        // Unset fields stay out of serialized state, so exports, snapshots and
        // websocket messages of existing devices do not change.
        let serialized = serde_json::to_value(&state).unwrap();
        assert!(serialized.get("effect").is_none());
        assert!(serialized.get("colors").is_none());

        let capabilities: Capabilities =
            serde_json::from_value(serde_json::json!({ "xy": true, "ct": null })).unwrap();
        assert!(capabilities.effects.is_empty());
        assert!(serde_json::to_value(&capabilities)
            .unwrap()
            .get("effects")
            .is_none());

        let device = effect_device();
        let restored: ControllableDevice =
            serde_json::from_value(serde_json::to_value(&device).unwrap()).unwrap();
        assert_eq!(restored, device);
    }

    #[test]
    fn unset_effect_and_colors_never_conflict_with_the_device() {
        let device = effect_device();
        let mut expected = device.state.clone();
        expected.effect = None;
        expected.colors = None;
        assert!(cmp_device_states(&device, &expected));

        // A device without effect support never fights a requested effect.
        let mut plain = ControllableDevice::new(
            None,
            true,
            Some(0.6),
            Some(DeviceColor::new_from_hs(30, 0.58)),
            None,
            Capabilities::singleton(ColorMode::Hs),
            ManageKind::Full,
        );
        let mut expected = plain.state.clone();
        expected.effect = Some("Aurora".to_string());
        expected.colors = Some(vec![DeviceColor::new_from_hs(0, 1.0)]);
        assert!(cmp_device_states(&plain, &expected));
        plain.state.power = false;
        expected.power = false;
        assert!(cmp_device_states(&plain, &expected));
    }

    #[test]
    fn effect_and_colors_mismatches_are_drift() {
        let device = effect_device();

        let mut expected = device.state.clone();
        expected.effect = Some("Fire".to_string());
        assert!(!cmp_device_states(&device, &expected));

        let mut expected = device.state.clone();
        expected.colors = Some(vec![
            DeviceColor::new_from_hs(30, 0.58),
            DeviceColor::new_from_hs(120, 0.8),
        ]);
        assert!(!cmp_device_states(&device, &expected));

        // Rounding differences within the color tolerance are not drift.
        let mut expected = device.state.clone();
        expected.colors = Some(vec![
            DeviceColor::new_from_hs(30, 0.58),
            DeviceColor::new_from_hs(271, 0.805),
        ]);
        assert!(cmp_device_states(&device, &expected));

        // A device reporting no preset while the expected effect has no
        // customised colors has lost the effect.
        let mut reported = device.clone();
        reported.state.effect = None;
        let mut expected = device.state.clone();
        expected.color = None;
        expected.colors = None;
        assert!(!cmp_device_states(&reported, &expected));
    }

    #[test]
    fn customised_colors_on_top_of_an_effect_accept_a_cleared_preset() {
        // Devices report no preset once their look is customised.
        let mut reported = effect_device();
        reported.state.effect = None;
        let expected = effect_device().state;
        assert!(cmp_device_states(&reported, &expected));
    }

    #[test]
    fn primary_color_is_authoritative_for_the_first_color_slot() {
        let device = effect_device();
        let mut expected = device.state.clone();
        expected.colors = Some(vec![
            DeviceColor::new_from_hs(200, 0.1),
            DeviceColor::new_from_hs(270, 0.8),
        ]);
        // Slot 0 is compared through `color`, which matches.
        assert!(cmp_device_states(&device, &expected));
        assert_eq!(
            expected.colors_with_primary(),
            Some(vec![
                DeviceColor::new_from_hs(30, 0.58),
                DeviceColor::new_from_hs(270, 0.8),
            ])
        );
    }

    #[test]
    fn requested_effect_and_colors_changes_are_state_changes() {
        let device = effect_device();
        let mut changed = device.clone();
        changed.state.effect = None;
        assert!(!DeviceData::Controllable(device.clone())
            .is_state_eq(&DeviceData::Controllable(changed)));

        let mut changed = device.clone();
        changed.state.colors = None;
        assert!(!DeviceData::Controllable(device.clone())
            .is_state_eq(&DeviceData::Controllable(changed)));
    }

    #[test]
    fn report_and_scene_comparison_share_tolerance_and_reported_mode() {
        let capabilities = Capabilities {
            brightness: Some(true),
            xy: true,
            hs: true,
            rgb: false,
            ct: Some(2000..6500),
            effects: Vec::new(),
        };
        let mut device = ControllableDevice::new(
            None,
            true,
            Some(0.77),
            Some(DeviceColor::new_from_hs(120, 0.5)),
            None,
            capabilities,
            ManageKind::Full,
        );
        let mut reported = device.clone();
        reported.state.brightness = Some(OrderedFloat(0.76));
        let mut xy_only = reported.capabilities.clone();
        xy_only.hs = false;
        reported.state.color = reported
            .state
            .color
            .as_ref()
            .and_then(|color| color.to_device_preferred_mode(&xy_only));
        assert!(cmp_device_states(&reported, &device.state));
        device.last_report = Some(Box::new(DeviceReport {
            state: reported.state.clone(),
            received_at_ms: 1,
            retained: false,
            matches_requested: false,
        }));
        device.refresh_report_match();
        assert!(device.last_report.as_ref().unwrap().matches_requested);
        reported.state.brightness = Some(OrderedFloat(0.6));
        assert!(!cmp_device_states(&reported, &device.state));
    }

    #[test]
    fn perceptual_uv_fallback_absorbs_rounding_but_rejects_visible_drift() {
        let capabilities = Capabilities {
            brightness: Some(true),
            xy: true,
            ..Default::default()
        };
        let expected = Some(DeviceColor::new_from_xy(0.35, 0.36));
        // Just outside the per-component xy tolerance, but perceptually the
        // same chromaticity (CIE 1976 u'v' distance ~0.006).
        let close = Some(DeviceColor::new_from_xy(0.35, 0.36 + 0.0101));
        assert!(cmp_light_color(
            &capabilities,
            &close,
            &Some(1.0),
            &expected,
            &Some(1.0)
        ));
        // Hue-style HS interpretation of hs(35,0.2): visibly different.
        let far = Some(DeviceColor::new_from_xy(0.4168, 0.3826));
        assert!(!cmp_light_color(
            &capabilities,
            &far,
            &Some(1.0),
            &expected,
            &Some(1.0)
        ));
    }

    #[test]
    fn sparse_off_reports_do_not_require_unreported_color() {
        let expected = ControllableDevice::new(
            None,
            false,
            Some(0.6),
            Some(DeviceColor::new_from_rgb(255, 20, 0)),
            None,
            Capabilities {
                brightness: Some(true),
                rgb: true,
                ..Default::default()
            },
            ManageKind::Full,
        );
        let reported = ControllableDevice::new(
            None,
            false,
            None,
            None,
            None,
            expected.capabilities.clone(),
            ManageKind::Full,
        );

        assert!(cmp_device_states(&reported, &expected.state));
    }

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
            colors: None,
            effect: None,
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

        // Test Readings variant
        let json = r#"{"readings":{"humidity":45.0,"temperature":21.4}}"#;
        let deserialized: SensorDevice = serde_json::from_str(json).unwrap();
        assert_eq!(
            deserialized,
            SensorDevice::Readings {
                readings: BTreeMap::from([
                    ("humidity".to_string(), 45.0),
                    ("temperature".to_string(), 21.4),
                ])
            }
        );
        assert_eq!(serde_json::to_string(&deserialized).unwrap(), json);

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
                colors: None,
                effect: None,
            })
        );
    }
}
