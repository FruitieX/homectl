use dioxus::{
    events::{FormEvent, MouseEvent},
    prelude::*,
};
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_set;
use homectl_types::{device::Device, event::Message, websockets::WebSocketRequest};

use crate::{app_state::DISABLE_SCROLL_ATOM, color_swatch::ColorSwatch};

#[derive(Props)]
pub struct DeviceModalProps<'a> {
    device: &'a Device,
    modal_open: UseState<'a, bool>,
}

#[allow(non_snake_case)]
pub fn DeviceModal<'a>(cx: Scope<'a, DeviceModalProps<'a>>) -> Element<'a> {
    let ws = use_ws_context(&cx);

    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);

    let cancel_bubble = move |evt: MouseEvent| {
        evt.cancel_bubble();
    };

    let close_modal = move |evt: MouseEvent| {
        evt.cancel_bubble();
        cx.props.modal_open.set(false);
        set_disable_scroll(false);
    };

    let show_debug = use_state(&cx, || false);
    let toggle_debug = move |_| {
        let mut show_debug = show_debug.modify();
        *show_debug = !*show_debug;
    };

    let color = cx.props.device.state.get_color();

    let set_hue = move |evt: FormEvent| {
        let hue: Option<f32> = evt.data.value.parse().ok();

        if let Some(hue) = hue {
            let mut device = cx.props.device.clone();
            device.state.set_hue(hue);
            device.scene = None;
            ws.send_json(&WebSocketRequest::Message(Message::SetDeviceState {
                device,
                set_scene: true,
            }))
        }
    };

    if *cx.props.modal_open {
        set_disable_scroll(true);
    }

    if !cx.props.modal_open {
        None
    } else {
        let device_debug = format!("{:#?}", cx.props.device);

        cx.render(rsx! {
            div {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100vw",
                height: "100vh",
                background_color: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                align_items: "center",
                justify_content: "center",
                onclick: close_modal,

                div {
                    style: "gap: 1rem;",
                    background_color: "white",
                    width: "20rem",
                    max_width: "80vw",
                    height: "35rem",
                    max_height: "80vh",
                    border_radius: "0.5rem",
                    border: "1px solid #cccccc",
                    padding: "1rem",
                    display: "flex",
                    flex_direction: "column",

                    onclick: cancel_bubble,

                    div {
                        style: "gap: 1rem;",
                        display: "flex",
                        flex_direction: "row",

                        h2 {
                            flex: "1",
                            margin: "0",
                            "{cx.props.device.name}"
                        }
                        button {
                            border: "none",
                            background_color: "transparent",
                            height: "1.5rem",
                            font_size: "1.5rem",
                            color: "#444444",

                            onclick: close_modal,

                            "X"
                        }
                    }

                    div {
                        style: "gap: 1rem;",
                        display: "flex",
                        flex_direction: "column",

                        "Color:",
                        ColorSwatch { color: color },

                        "Hue:",
                        style {
                            ".hue-slider::-webkit-slider-runnable-track {{
                                background: linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
                                border-radius: 0.5rem;
                                border: 1px solid #cccccc;
                            }}"
                        }
                        input {
                            class: "hue-slider",
                            r#type: "range",
                            min: "0",
                            max: "360",
                            onchange: set_hue
                        }
                    }

                    button {
                        onclick: toggle_debug,
                        "Toggle debug info"
                    }
                    show_debug.then(|| rsx! {
                        div {
                            flex: "1",
                            overflow: "auto",

                            pre {
                                "{device_debug}"
                            }
                        }
                    })
                }
            }
        })
    }
}
