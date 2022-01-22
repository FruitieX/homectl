use dioxus::prelude::*;
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_read;
use homectl_types::{
    action::Action,
    event::Message,
    scene::{SceneDescriptor, SceneId},
    websockets::WebSocketRequest,
};

use crate::app_state::SCENES_ATOM;

#[derive(Props, PartialEq)]
struct SceneRowProps {
    scene_id: SceneId,
    name: String,
}

#[allow(non_snake_case)]
fn SceneRow(cx: Scope<SceneRowProps>) -> Element {
    let ws = use_ws_context(&cx);
    let name = &cx.props.name;
    let scene_id = &cx.props.scene_id;

    let activate_scene = {
        move |_| {
            let scene_id = scene_id.clone();
            ws.send_json(&WebSocketRequest::Message(Message::Action(
                Action::ActivateScene(SceneDescriptor { scene_id }),
            )))
        }
    };

    cx.render(rsx! {
        div {
            button {
                onclick: activate_scene,
                "{name}"
            }
        }
    })
}

#[allow(non_snake_case)]
pub fn SceneList(cx: Scope) -> Element {
    let scenes = use_read(&cx, SCENES_ATOM);

    let scenes = scenes.iter().map(|(key, scene)| {
        rsx! {
            SceneRow {
                key: "{key}",
                scene_id: key.clone(),
                name: scene.name.clone()
            }
        }
    });

    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Scenes:" }
        scenes
    })
}
