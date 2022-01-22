use dioxus::prelude::*;
use fermi::use_read;
use homectl_types::device::Device;

use crate::app_state::DEVICES_ATOM;

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

#[allow(non_snake_case)]
pub fn DeviceList(cx: Scope) -> Element {
    let devices = use_read(&cx, DEVICES_ATOM);
    let devices = devices.0.values().map(|device| {
        dbg!(&device);
        let key = device.get_state_key().to_string();

        rsx! {
            DeviceRow {
                key: "{key}",
                device: device,
            }
        }
    });

    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Devices:" }
        devices
    })
}
