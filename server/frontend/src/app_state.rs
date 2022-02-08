use dioxus::prelude::*;
use dioxus_websocket_hooks::use_ws_context_provider_json;
use fermi::{use_init_atom_root, use_set, Atom};
use homectl_types::{
    device::DevicesState, group::FlattenedGroupsConfig, scene::FlattenedScenesConfig,
    websockets::WebSocketResponse,
};

pub static DISABLE_SCROLL_ATOM: Atom<bool> = |_| false;

pub static DEVICES_ATOM: Atom<DevicesState> = |_| DevicesState::default();
pub static SCENES_ATOM: Atom<FlattenedScenesConfig> = |_| Default::default();
pub static GROUPS_ATOM: Atom<FlattenedGroupsConfig> = |_| Default::default();

const WS_ENDPOINT: Option<&'static str> = option_env!("WS_ENDPOINT");

pub fn use_init_app_state(cx: &Scope) {
    use_init_atom_root(cx);
    let set_devices = use_set(cx, DEVICES_ATOM);
    let set_scenes = use_set(cx, SCENES_ATOM);
    let set_groups = use_set(cx, GROUPS_ATOM);

    {
        let set_devices = set_devices.clone();
        let set_scenes = set_scenes.clone();
        let set_groups = set_groups.clone();

        use_ws_context_provider_json(
            cx,
            WS_ENDPOINT.unwrap_or("ws://localhost:8080/ws"),
            move |msg| match msg {
                WebSocketResponse::State(state) => {
                    set_devices(state.devices);
                    set_scenes(state.scenes);
                    set_groups(state.groups);
                }
            },
        );
    }
}
