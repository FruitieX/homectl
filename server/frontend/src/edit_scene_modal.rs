use crate::{
    app_state::{DISABLE_SCROLL_ATOM, SCENES_ATOM},
    modal::Modal,
};
use dioxus::{events::FormEvent, prelude::*};
use dioxus_websocket_hooks::use_ws_context;
use fermi::{use_read, use_set};
use homectl_types::{event::Message, scene::SceneId, websockets::WebSocketRequest};

#[derive(Props)]
pub struct EditSceneModalProps<'a> {
    scene_id: &'a SceneId,
    modal_open: &'a bool,
    set_modal_open: &'a UseState<bool>,
}

#[allow(non_snake_case)]
pub fn EditSceneModal<'a>(cx: Scope<'a, EditSceneModalProps<'a>>) -> Element<'a> {
    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);
    let scenes = use_read(&cx, SCENES_ATOM);
    let scene_id = cx.props.scene_id;
    let _scene = scenes.get(scene_id);

    let ws = use_ws_context(&cx);

    let (name, set_name) = use_state(&cx, || String::from("New scene"));

    let onchange = {
        move |evt: FormEvent| {
            let name = evt.data.value.clone();
            set_name(name)
        }
    };

    let save_scene = { move |_| {} };

    let (confirm_delete_visible, set_confirm_delete_visible) = use_state(&cx, || false);
    let delete_scene = {
        move |_| {
            ws.send_json(&WebSocketRequest::Message(Message::DeleteScene {
                scene_id: scene_id.clone(),
            }));

            // Boilerplate for closing modal
            // TODO: make this a shared function
            set_disable_scroll(false);
            (cx.props.set_modal_open)(false);
        }
    };

    cx.render(rsx! {
        Modal {
            title: "Edit scene",
            modal_open: cx.props.modal_open,
            set_modal_open: cx.props.set_modal_open,
            contents: cx.render(rsx! {
                div {
                    gap: "1rem",
                    display: "flex",
                    flex_direction: "column",
                    flex: "1",

                    "Name:"
                    input {
                        value: "{name}",
                        onchange: onchange
                    }

                    button {
                        onclick: save_scene,
                        disabled: "true",
                        "Save"
                    }

                    { if *confirm_delete_visible {
                        rsx! {
                            div {
                                width: "100%",
                                button {
                                    width: "50%",
                                    onclick: move |_| {set_confirm_delete_visible(false)},
                                    "Cancel"
                                }
                                button {
                                    width: "50%",
                                    onclick: delete_scene,
                                    "Confirm"
                                }
                            }
                        }
                    } else {
                        rsx! {
                            button {
                                onclick: move |_| {set_confirm_delete_visible(true)},
                                "Delete scene"
                            }
                        }
                    }}
                }
            })
        }
    })
}
