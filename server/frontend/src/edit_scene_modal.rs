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
    modal_open: &'a UseState<bool>,
}

#[allow(non_snake_case)]
pub fn EditSceneModal<'a>(cx: Scope<'a, EditSceneModalProps<'a>>) -> Element<'a> {
    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);
    let scenes = use_read(&cx, SCENES_ATOM);
    let scene_id = cx.props.scene_id;
    let _scene = scenes.get(scene_id);

    let ws = use_ws_context(&cx);

    let name = use_state(&cx, || String::from("New scene"));

    let onchange = {
        move |evt: FormEvent| {
            let new_name = evt.data.value.clone();
            name.set(new_name)
        }
    };

    let save_scene = { move |_| {} };

    let confirm_delete_visible = use_state(&cx, || false);
    let delete_scene = {
        move |_| {
            ws.send_json(&WebSocketRequest::Message(Message::DeleteScene {
                scene_id: scene_id.clone(),
            }));

            // Boilerplate for closing modal
            // TODO: make this a shared function
            set_disable_scroll(false);
            cx.props.modal_open.set(false);
        }
    };

    cx.render(rsx! {
        Modal {
            title: "Edit scene",
            modal_open: cx.props.modal_open,
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
                        disabled: "true",
                        "Save"
                    }

                    { if **confirm_delete_visible {
                        rsx! {
                            div {
                                class: "w-full",

                                button {
                                    class: "w-1/2 bg-slate-100",
                                    onclick: move |_| {confirm_delete_visible.set(false)},

                                    "Cancel"
                                }
                                button {
                                    class: "w-1/2 bg-rose-600 text-white",
                                    onclick: delete_scene,

                                    "Confirm"
                                }
                            }
                        }
                    } else {
                        rsx! {
                            button {
                                class: "bg-slate-100", 
                                onclick: move |_| {confirm_delete_visible.set(true)},

                                "Delete scene"
                            }
                        }
                    }}
                }
            })
        }
    })
}
