use crate::{
    app_state::{DEVICES_ATOM, DISABLE_SCROLL_ATOM},
    modal::Modal,
};
use convert_case::{Case, Casing};
use dioxus::{
    events::{FormEvent, MouseEvent},
    prelude::*,
};
use dioxus_websocket_hooks::use_ws_context;
use fermi::{use_read, use_set};
use homectl_types::{
    device::{Device, DeviceKey},
    event::Message,
    scene::{
        ColorConfig, SceneConfig, SceneDeviceConfig, SceneDeviceState, SceneDevicesSearchConfig,
        SceneId,
    },
    websockets::WebSocketRequest,
};
use itertools::Itertools;

#[derive(Props)]
pub struct SaveSceneModalProps<'a> {
    filters: &'a Option<Vec<DeviceKey>>,
    modal_open: &'a bool,
    set_modal_open: &'a UseState<bool>,
}

#[allow(non_snake_case)]
pub fn SaveSceneModal<'a>(cx: Scope<'a, SaveSceneModalProps<'a>>) -> Element<'a> {
    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);
    let devices = use_read(&cx, DEVICES_ATOM);

    let ws = use_ws_context(&cx);

    let (name, set_name) = use_state(&cx, || String::from("New scene"));

    let onchange = {
        move |evt: FormEvent| {
            let name = evt.data.value.clone();
            set_name(name)
        }
    };

    let save_scene = {
        let filters = cx.props.filters.clone();

        move |evt: MouseEvent| {
            evt.cancel_bubble();

            // Filter devices according to cx.props.filters
            let mut filtered_devices: Vec<Device> = devices
                .0
                .values()
                .filter(|device| {
                    filters
                        .as_ref()
                        .map(|filters| filters.contains(&device.get_device_key()))
                        .unwrap_or(true)
                })
                .cloned()
                .collect();

            filtered_devices.sort_by(|a, b| a.name.cmp(&b.name));

            // Group devices' state by integration_id and device names
            let devices: SceneDevicesSearchConfig = filtered_devices
                .into_iter()
                .group_by(|device| device.integration_id.clone())
                .into_iter()
                .map(|(integration_id, group)| {
                    let scene_device_configs = group
                        .map(|device| {
                            let scene_device_config =
                                SceneDeviceConfig::SceneDeviceState(SceneDeviceState {
                                    power: device.state.is_powered_on().unwrap_or_default(),
                                    color: device.state.get_color().map(ColorConfig::Hsv),
                                    brightness: device.state.get_brightness(),
                                    cct: device.state.get_cct(),
                                    transition_ms: None,
                                });

                            (device.name, scene_device_config)
                        })
                        .collect();

                    (integration_id, scene_device_configs)
                })
                .collect();

            let scene_id = SceneId::new(name.to_case(Case::Snake));
            let config = SceneConfig {
                name: name.to_string(),
                devices: Some(devices),
                groups: None,
            };

            ws.send_json(&WebSocketRequest::Message(Message::StoreScene {
                scene_id,
                config,
            }));

            // Boilerplate for closing modal
            // TODO: make this a shared function
            set_disable_scroll(false);
            (cx.props.set_modal_open)(false);
        }
    };

    cx.render(rsx! {
        Modal {
            title: "Save scene",
            modal_open: cx.props.modal_open,
            set_modal_open: cx.props.set_modal_open,
            contents: cx.render(rsx! {
                div {
                    class: "gap-4 flex flex-col flex-1",

                    div {
                        class: "flex flex-col",

                        span {
                            class: "text-slate-700 text-sm",
                            "Name:"
                        }
                        input {
                            class: "border rounded border-slate-300 px-1",
                            value: "{name}",
                            onchange: onchange
                        }
                    }

                    button {
                        onclick: save_scene,
                        "Save"
                    }
                }
            })
        }
    })
}
