use dioxus::{events::MouseEvent, prelude::*};
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_read;
use homectl_types::{
    action::Action,
    event::Message,
    scene::{SceneConfig, SceneDescriptor, SceneId},
    websockets::WebSocketRequest,
};
use itertools::Itertools;

use crate::{app_state::SCENES_ATOM, edit_scene_modal::EditSceneModal, tile::Tile};

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

    let (edit_modal_open, set_edit_modal_open) = use_state(&cx, || false);
    let edit_scene = {
        move |evt: MouseEvent| {
            evt.cancel_bubble();
            set_edit_modal_open(true);
        }
    };

    cx.render(rsx! {
        div {
            Tile {
                full_width: true, 
                onclick: activate_scene,
                contents: cx.render(rsx! {
                    div {
                        flex: "1",
                        "{name}"
                    }
                    button {
                        border: "none",
                        background: "none",
                        height: "2rem",
                        width: "2rem",
                        font_size: "1.5rem",
                        line_height: "1",
                        cursor: "pointer",
                        onclick: edit_scene,
                        "✎"
                    }
                })
            }
            EditSceneModal {
                scene_id: scene_id,
                modal_open: edit_modal_open,
                set_modal_open: set_edit_modal_open,
            }
        }
    })
}

#[allow(non_snake_case)]
pub fn SceneList(cx: Scope) -> Element {
    let scenes = use_read(&cx, SCENES_ATOM);

    let scenes: Vec<(SceneId, SceneConfig)> = scenes
        .iter()
        .map(|(scene_id, config)| (scene_id.clone(), config.clone()))
        .sorted_by(|a, b| a.1.name.cmp(&b.1.name))
        .collect();

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
        div {
            display: "flex",
            flex_direction: "column",
            margin: "1rem",
            gap: "1rem",
            scenes
        }
    })
}
