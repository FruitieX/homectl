use dioxus::{events::MouseEvent, prelude::*};
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_read;
use homectl_types::{
    action::Action,
    event::Message,
    scene::{FlattenedSceneConfig, SceneDescriptor, SceneId},
    websockets::WebSocketRequest,
};
use itertools::Itertools;
use palette::Hsv;

use crate::{
    app_state::SCENES_ATOM,
    edit_scene_modal::EditSceneModal,
    tile::Tile,
    util::{cmp_hsv, get_device_state_color, scale_hsv_value_to_display},
};

#[derive(Props, PartialEq)]
struct SceneRowProps {
    scene_id: SceneId,
    scene: FlattenedSceneConfig,
}

#[allow(non_snake_case)]
fn SceneRow(cx: Scope<SceneRowProps>) -> Element {
    let ws = use_ws_context(&cx);
    let name = &cx.props.scene.name;
    let scene_id = &cx.props.scene_id;
    let scene = &cx.props.scene;

    let scene_colors: Vec<Hsv> = scene
        .devices
        .values()
        .filter_map(get_device_state_color)
        .map(scale_hsv_value_to_display)
        .sorted_by(cmp_hsv)
        .dedup()
        .collect();

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
                gradient: scene_colors,
                contents: cx.render(rsx! {
                    div {
                        class: "flex-1",

                        span {
                            class: "px-2 py-1 rounded-lg bg-white bg-opacity-50 whitespace-nowrap",

                            "{name}"
                        }
                    }
                    button {
                        class: "h-8 w-8 text-2xl leading-4 cursor-pointer",

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

    let scenes: Vec<(SceneId, FlattenedSceneConfig)> = scenes
        .iter()
        .map(|(scene_id, config)| (scene_id.clone(), config.clone()))
        .sorted_by(|a, b| a.1.name.cmp(&b.1.name))
        .collect();

    let scenes = scenes.iter().map(|(key, scene)| {
        rsx! {
            SceneRow {
                key: "{key}",
                scene_id: key.clone(),
                scene: scene.clone()
            }
        }
    });

    cx.render(rsx! {
        div {
            class: "flex flex-col m-4 gap-4",

            scenes
        }
    })
}
