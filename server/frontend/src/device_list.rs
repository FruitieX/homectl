use dioxus::prelude::*;
use fermi::use_read;
use homectl_types::device::Device;
use palette::{Hsl, Hsv};

use crate::app_state::DEVICES_ATOM;

#[derive(Props, PartialEq)]
struct ColorSwatchProps {
    color: Option<Hsv>,
}

#[allow(non_snake_case)]
fn ColorSwatch(cx: Scope<ColorSwatchProps>) -> Element {
    let hsv = cx.props.color.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
    let hsl: Hsl = hsv.into();
    let background_color = format!(
        "hsl({}, {}%, {}%)",
        hsl.hue.to_positive_degrees(),
        (hsl.saturation * 100.0).floor(),
        (hsl.lightness * 100.0).floor()
    );

    let size = 1.5;
    let border_radius = size / 2.0;

    cx.render(rsx! {
        span {
            width: "{size}rem",
            height: "{size}rem",
            border_radius: "{border_radius}rem",
            background_color: "{background_color}",
            border: "1px solid #cccccc",
            flex_shrink: "0",
        }
    })
}

#[derive(Props, PartialEq)]
struct DeviceRowProps<'a> {
    device: &'a Device,
}

#[allow(non_snake_case)]
fn DeviceTile<'a>(cx: Scope<'a, DeviceRowProps<'a>>) -> Element<'a> {
    let name = &cx.props.device.name;
    let color = cx.props.device.state.get_color();

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

            ColorSwatch { color: color },

            span {
                text_overflow: "ellipsis",
                overflow: "hidden",
                max_height: "100%",
                "{name}"
            }
        }
    })
}

#[allow(non_snake_case)]
pub fn DeviceList(cx: Scope) -> Element {
    let devices = use_read(&cx, DEVICES_ATOM);
    let devices = devices.0.values().map(|device| {
        let key = device.get_state_key().to_string();

        rsx! {
            DeviceTile {
                key: "{key}",
                device: device,
            }
        }
    });

    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Devices:" }
        div {
            style: "gap: 0.5rem;",
            max_width: "40rem",
            display: "flex",
            flex_direction: "row",
            flex_wrap: "wrap",
            devices
        }
    })
}
