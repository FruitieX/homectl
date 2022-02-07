use crate::{color_swatch::ColorSwatch, save_scene_modal::SaveSceneModal, tile::Tile};
use dioxus::prelude::*;
use fermi::use_read;
use homectl_types::device::{Device, DeviceId};
use itertools::Itertools;

use crate::{app_state::DEVICES_ATOM, device_modal::DeviceModal};

#[derive(Props, PartialEq)]
struct DeviceTileProps<'a> {
    device: &'a Device,
}

#[allow(non_snake_case)]
fn DeviceTile<'a>(cx: Scope<'a, DeviceTileProps<'a>>) -> Element<'a> {
    let name = &cx.props.device.name;
    let color = cx.props.device.state.get_color();
    let (modal_open, set_modal_open) = use_state(&cx, || false);

    cx.render(rsx! {
        Tile {
            contents: cx.render(rsx! {
                ColorSwatch { color: color },

                span {
                    text_overflow: "ellipsis",
                    overflow: "hidden",
                    max_height: "100%",
                    "{name}"
                },

                DeviceModal {
                    device: cx.props.device,
                    modal_open: modal_open
                    set_modal_open: set_modal_open
                }
            })
            onclick: move |_| set_modal_open(true),
        }
    })
}

#[derive(Props, PartialEq)]
pub struct DeviceListProps {
    filters: Option<Vec<DeviceId>>,
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
            if !filters.contains(&device.id) {
                return None;
            }
        }

        let key = device.get_state_key().to_string();

        Some(rsx! {
            DeviceTile {
                key: "{key}",
                device: device,
            }
        })
    });

    let (save_scene_modal_open, set_save_scene_modal_open) = use_state(&cx, || false);

    cx.render(rsx! {
        div {
            margin: "1rem",
            div {
                gap: "0.5rem",
                max_width: "40rem",
                display: "flex",
                flex_direction: "row",
                flex_wrap: "wrap",
                devices
            }
            h2 { margin_bottom: "1rem", "Options:" }
            button {
                onclick: move |_| set_save_scene_modal_open(true),
                "Save scene"
            }
            SaveSceneModal {
                filters: &cx.props.filters,
                modal_open: save_scene_modal_open,
                set_modal_open: set_save_scene_modal_open
            }
        }
    })
}
