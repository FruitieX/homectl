#[allow(unused_imports)]
#[macro_use]
extern crate homectl_console;

use dioxus::prelude::*;
use dioxus_websocket_hooks::{use_ws_context, use_ws_context_provider_json};
use fermi::{use_init_atom_root, use_read, use_set, Atom};
use homectl_types::{
    action::Action,
    device::{Device, DevicesState},
    event::Message,
    scene::{SceneDescriptor, SceneId, ScenesConfig},
    websockets::{WebSocketRequest, WebSocketResponse},
};

fn main() {
    dioxus::web::launch(app);
}

pub static DEVICES_ATOM: Atom<DevicesState> = |_| DevicesState::default();
pub static SCENES_ATOM: Atom<ScenesConfig> = |_| Default::default();

fn app(cx: Scope) -> Element {
    use_init_atom_root(&cx);
    let set_devices = use_set(&cx, DEVICES_ATOM);
    let set_scenes = use_set(&cx, SCENES_ATOM);

    {
        let set_devices = set_devices.clone();
        let set_scenes = set_scenes.clone();
        use_ws_context_provider_json(&cx, "ws://localhost:8080/ws", move |msg| match msg {
            WebSocketResponse::State(state) => {
                set_devices(state.devices);
                set_scenes(state.scenes);
            }
            WebSocketResponse::Device(_) => todo!(),
        });
    }

    let devices = use_read(&cx, DEVICES_ATOM);
    let scenes = use_read(&cx, SCENES_ATOM);

    let devices = devices.0.values().map(|device| {
        let key = device.get_state_key().to_string();

        rsx! {
            DeviceRow {
                key: "{key}",
                device: device,
            }
        }
    });

    let scenes = scenes.iter().map(|(key, scene)| {
        rsx! {
            SceneRow {
                key: "{key}",
                scene_id: key.clone(),
                name: scene.name.clone()
            }
        }
    });

    let device_list = rsx! {
        h2 { margin_bottom: "1rem", "Devices:" }
        devices
    };

    let scene_list = rsx! {
        h2 { margin_bottom: "1rem", "Scenes:" }
        scenes
    };

    cx.render(rsx! (
        device_list
        scene_list
    ))
}

#[derive(Props, PartialEq)]
struct DeviceRowProps<'a> {
    device: &'a Device,
}

#[allow(non_snake_case)]
fn DeviceRow<'a>(cx: Scope<'a, DeviceRowProps<'a>>) -> Element<'a> {
    let name = &cx.props.device.name;
    let state = &cx.props.device.state;

    cx.render(rsx! {
        div {
            "{name} ({state})"
        }
    })
}

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
                Action::ActivateScene(SceneDescriptor {
                    scene_id,
                    skip_locked_devices: None,
                }),
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
