use crate::color_swatch::ColorSwatch;
use dioxus::prelude::*;
use fermi::use_read;
use homectl_types::device::{Device, DeviceId};

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
        div {
            style: "gap: 0.5rem;",
            width: "calc(50% - 1.5rem)",
            height: "2.5rem",
            display: "flex",
            flex_direction: "row",
            align_items: "center",
            border_radius: "0.5rem",
            border: "1px solid #cccccc",
            padding: "0.5rem",
            box_shadow: "0px 0.25rem 0.5rem 0px rgba(0,0,0,0.1)",
            onclick: move |_| set_modal_open(true),

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

    dbg!(&devices);
    let devices = devices.0.values().filter_map(|device| {
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

    cx.render(rsx! {
        div {
            margin: "1rem",
            h2 { margin_bottom: "1rem", "Devices:" }
            div {
                style: "gap: 0.5rem;",
                max_width: "40rem",
                display: "flex",
                flex_direction: "row",
                flex_wrap: "wrap",
                devices
            }
        }
    })
}
