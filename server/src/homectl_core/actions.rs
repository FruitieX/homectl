use super::{
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};
use serde::Deserialize;

#[derive(Clone, Deserialize, Debug)]
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