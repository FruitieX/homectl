use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::{Device, DeviceKey},
    dim::DimDescriptor,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{ActivateSceneActionDescriptor, CycleScenesDescriptor},
    ui::UiActionDescriptor,
};

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct RandomizeColorActionDescriptor {
    /// Devices whose colors should be randomized.
    pub device_keys: Vec<DeviceKey>,

    /// Inclusive lower and upper saturation bounds. Defaults to 0.2..=1.0.
    #[serde(default)]
    pub min_saturation: Option<f32>,
    #[serde(default)]
    pub max_saturation: Option<f32>,

    /// Optional transition time in seconds.
    #[serde(default)]
    pub transition: Option<ordered_float::OrderedFloat<f32>>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[serde(tag = "action")]
#[ts(export)]
pub enum Action {
    /// Request to activate given scene.
    ActivateScene(ActivateSceneActionDescriptor),

    /// Request to cycle between given scenes.
    CycleScenes(CycleScenesDescriptor),

    /// Runs a custom integration action.
    Custom(CustomActionDescriptor),

    /// Dims the given groups and devices.
    Dim(DimDescriptor),

    /// Forcibly triggers a routine, ignoring any possible rules.
    ForceTriggerRoutine(ForceTriggerRoutineDescriptor),

    /// Sets device state to given state.
    SetDeviceState(Device),

    /// Randomizes the hue and saturation of the selected devices once.
    RandomizeColor(RandomizeColorActionDescriptor),

    /// Enables / disables device scene state overrides.
    ToggleDeviceOverride {
        device_keys: Vec<DeviceKey>,
        override_state: bool,
    },

    /// Special category of actions that are only used by UI.
    Ui(UiActionDescriptor),

    /// Legacy evalexpr action payload. No longer executed.
    #[serde(untagged, skip_serializing)]
    #[ts(skip)]
    EvalExpr(String),
}

pub type Actions = Vec<Action>;
