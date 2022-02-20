use dioxus::{events::MouseEvent, prelude::*};
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_read;
use homectl_types::{
    action::Action,
    device::DeviceKey,
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
    device_keys: Option<Vec<DeviceKey>>,
}

#[allow(non_snake_case)]
fn SceneRow(cx: Scope<SceneRowProps>) -> Element {
    let ws = use_ws_context(&cx);
    let name = &cx.props.scene.name;
    let scene_id = &cx.props.scene_id;
    let scene = &cx.props.scene;
    let device_keys = &cx.props.device_keys;

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
            let device_keys = device_keys.clone();

            ws.send_json(&WebSocketRequest::Message(Message::Action(
                Action::ActivateScene(SceneDescriptor {
                    scene_id,
                    device_keys,
                }),
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

#[derive(Props, PartialEq)]
pub struct SceneListProps {
    #[props(optional)]
    filter_by_device_ids: Option<Vec<DeviceKey>>,
}

#[allow(non_snake_case)]
pub fn SceneList(cx: Scope<SceneListProps>) -> Element {
    let scenes = use_read(&cx, SCENES_ATOM).clone();

    let filtered_scenes = if let Some(filters) = &cx.props.filter_by_device_ids {
        scenes
            .into_iter()
            .filter(|(_, scene)| filters.iter().any(|k| scene.devices.contains_key(k)))
            .collect()
    } else {
        scenes
    };

    let sorted_scenes: Vec<(SceneId, FlattenedSceneConfig)> = filtered_scenes
        .into_iter()
        .sorted_by(|a, b| a.1.name.cmp(&b.1.name))
        .collect();

    let scene_rows = sorted_scenes.iter().map(|(key, scene)| {
        rsx! {
            SceneRow {
                key: "{key}",
                scene_id: key.clone(),
                scene: scene.clone()

                device_keys: cx.props.filter_by_device_ids.clone()
            }
        }
    });

    cx.render(rsx! {
        div {
            class: "flex flex-col gap-2",

            scene_rows
        }
    })
}
