use crate::{save_scene_modal::SaveSceneModal, tile::Tile, util::scale_hsv_value_to_display};
use dioxus::prelude::*;
use fermi::use_read;
use homectl_types::device::{Device, DeviceKey};
use itertools::Itertools;

use crate::{app_state::DEVICES_ATOM, device_modal::DeviceModal};

#[derive(Props, PartialEq)]
struct DeviceTileProps<'a> {
    device: &'a Device,
}

#[allow(non_snake_case)]
fn DeviceTile<'a>(cx: Scope<'a, DeviceTileProps<'a>>) -> Element<'a> {
    let name = &cx.props.device.name;
    let color = cx
        .props
        .device
        .state
        .get_color()
        .map(scale_hsv_value_to_display);
    let modal_open = use_state(&cx, || false);

    let gradient = if let Some(color) = color {
        vec![color]
    } else {
        vec![]
    };

    cx.render(rsx! {
        Tile {
            gradient: gradient,
            contents: cx.render(rsx! {
                div {
                    class: "flex-1",

                    span {
                        class: "px-2 py-1 rounded-lg bg-white bg-opacity-50 overflow-ellipsis overflow-hidden max-h-full whitespace-nowrap",

                        "{name}"
                    }
                }

                DeviceModal {
                    device: cx.props.device,
                    modal_open: modal_open
                }
            })
            onclick: move |_| modal_open.set(true),
        }
    })
}

#[derive(Props, PartialEq)]
pub struct DeviceListProps {
    #[props(!optional)]
    filters: Option<Vec<DeviceKey>>,
}

#[allow(non_snake_case)]
pub fn DeviceList(cx: Scope<DeviceListProps>) -> Element {
    let devices = use_read(&cx, DEVICES_ATOM);

    let devices = devices
        .0
        .values()
        .into_iter()
        .sorted_by(|a, b| a.name.cmp(&b.name));

    let devices = devices.into_iter().filter_map(|device| {
        if let Some(filters) = &cx.props.filters {
            if !filters.contains(&device.get_device_key()) {
                return None;
            }
        }

        let key = device.get_device_key().to_string();

        Some(rsx! {
            DeviceTile {
                key: "{key}",
                device: device,
            }
        })
    });

    let save_scene_modal_open = use_state(&cx, || false);

    cx.render(rsx! {
        div {
            div {
                class: "gap-2 max-w-[60rem] flex flex-row flex-wrap",

                devices
            }
            h2 { class: "mt-4", "Options:" }
            Tile {
                full_width: true,
                onclick: move |_| save_scene_modal_open.set(true),
                contents: cx.render(rsx! { "Save scene" })
            }
            SaveSceneModal {
                filters: &cx.props.filters,
                modal_open: save_scene_modal_open,
            }
        }
    })
}
