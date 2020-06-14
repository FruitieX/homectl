use std::collections::HashMap;

pub type SceneId = String;

#[derive(Clone)]
pub struct Scene {
    name: String,
}

pub type Scenes = HashMap<SceneId, Scene>;
