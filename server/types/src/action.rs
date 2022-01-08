use serde::{Deserialize, Serialize};

use crate::{
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

#[derive(Clone, Deserialize, Debug, Serialize)]
#[serde(tag = "action")]
pub enum Action {
    /// Request to activate given scene.
    ActivateScene(SceneDescriptor),

    /// Request to cycle between given scenes.
    CycleScenes(CycleScenesDescriptor),

    /// Runs an integration action
    IntegrationAction(IntegrationActionDescriptor),
}

pub type Actions = Vec<Action>;
