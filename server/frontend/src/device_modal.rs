use dioxus::{
    events::{FormEvent, MouseEvent},
    prelude::*,
};
use dioxus_websocket_hooks::use_ws_context;
use fermi::use_set;
use homectl_types::{device::Device, event::Message, websockets::WebSocketRequest};

use crate::{app_state::DISABLE_SCROLL_ATOM, color_swatch::ColorSwatch, util::hsv_to_css_hsl_str};

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
    let hue = color.unwrap_or_default().hue.to_positive_degrees();
    let saturation = color.unwrap_or_default().saturation;
    let value = color.unwrap_or_default().value;

    let sat_min = {
        let mut color = color.unwrap_or_default();
        color.value = 1.0;
        color.saturation = 0.0;
        hsv_to_css_hsl_str(&Some(color))
    };

    let sat_max = {
        let mut color = color.unwrap_or_default();
        color.value = 1.0;
        color.saturation = 1.0;
        hsv_to_css_hsl_str(&Some(color))
    };

    let val_min = {
        let mut color = color.unwrap_or_default();
        color.value = 0.0;
        hsv_to_css_hsl_str(&Some(color))
    };

    let val_max = {
        let mut color = color.unwrap_or_default();
        color.value = 1.0;
        hsv_to_css_hsl_str(&Some(color))
    };

    let set_hue = {
        let ws = ws.clone();
        move |evt: FormEvent| {
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
        }
    };

    let set_saturation = {
        let ws = ws.clone();
        move |evt: FormEvent| {
            let saturation: Option<f32> = evt.data.value.parse().ok();

            if let Some(saturation) = saturation {
                let mut device = cx.props.device.clone();
                device.state.set_saturation(saturation);
                device.scene = None;
                ws.send_json(&WebSocketRequest::Message(Message::SetDeviceState {
                    device,
                    set_scene: true,
                }))
            }
        }
    };

    let set_value = move |evt: FormEvent| {
        let value: Option<f32> = evt.data.value.parse().ok();

        if let Some(value) = value {
            let mut device = cx.props.device.clone();
            device.state.set_value(value);
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
                position: "fixed",
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
                        flex: "1",

                        "Color:",
                        ColorSwatch { color: color },

                        "Hue:",
                        style {
                            ".hue-slider::-webkit-slider-runnable-track {{
                                background: linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
                                border-radius: 0.5rem;
                                height: 1rem;
                                border: 1px solid #cccccc;
                            }}"
                        }
                        input {
                            class: "hue-slider",
                            r#type: "range",
                            min: "0",
                            max: "359",
                            value: "{hue}",
                            onchange: set_hue
                        }

                        "Saturation:",
                        style {
                            ".saturation-slider::-webkit-slider-runnable-track {{
                                background: linear-gradient(to right, {sat_min} 0%, {sat_max} 100%);
                                border-radius: 0.5rem;
                                height: 1rem;
                                border: 1px solid #cccccc;
                            }}"
                        }
                        input {
                            class: "saturation-slider",
                            r#type: "range",
                            min: "0",
                            max: "1",
                            step: "0.01",
                            value: "{saturation}",
                            onchange: set_saturation
                        }

                        "Value:",
                        style {
                            ".value-slider::-webkit-slider-runnable-track {{
                                background: linear-gradient(to right, {val_min} 0%, {val_max} 100%);
                                border-radius: 0.5rem;
                                height: 1rem;
                                border: 1px solid #cccccc;
                            }}"
                        }
                        input {
                            class: "value-slider",
                            r#type: "range",
                            min: "0",
                            max: "1",
                            step: "0.01",
                            value: "{value}",
                            onchange: set_value
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
                                margin: "0",
                                "{device_debug}"
                            }
                        }
                    })
                }
            }
        })
    }
}
