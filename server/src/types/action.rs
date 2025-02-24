use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::{Device, DeviceKey},
    dim::DimDescriptor,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{ActivateSceneDescriptor, CycleScenesDescriptor},
    ui::UiActionDescriptor,
};

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[serde(tag = "action")]
#[ts(export)]
pub enum Action {
    /// Request to activate given scene.
    ActivateScene(ActivateSceneDescriptor),

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

    /// Enables / disables device scene state overrides.
    ToggleDeviceOverride {
        device_keys: Vec<DeviceKey>,
        override_state: bool,
    },

    /// Special category of actions that are only used by UI.
    Ui(UiActionDescriptor),

    /// Evaluates given expression.
    #[serde(untagged, skip_serializing)]
    #[ts(skip)]
    EvalExpr(evalexpr::Node),
}

pub type Actions = Vec<Action>;
