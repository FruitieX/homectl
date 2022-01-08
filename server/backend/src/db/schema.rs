table! {
    devices (id) {
        id -> Int4,
        name -> Text,
        integration_id -> Text,
        device_id -> Text,
        scene_id -> Nullable<Text>,
    }
}

table! {
    floorplan_devices (id) {
        id -> Int4,
        floorplan_id -> Int4,
        device_id -> Int4,
        x -> Float8,
        y -> Float8,
    }
}

table! {
    floorplans (id) {
        id -> Int4,
        name -> Text,
        index -> Int4,
        image -> Bytea,
    }
}

table! {
    scene_state (scene_id, device_id, group_id) {
        scene_id -> Int4,
        device_id -> Int4,
        group_id -> Text,
        link_id -> Nullable<Int4>,
        power -> Nullable<Bool>,
        color -> Nullable<Jsonb>,
        brightness -> Nullable<Float8>,
    }
}

table! {
    scenes (id) {
        id -> Int4,
        name -> Text,
    }
}

joinable!(floorplan_devices -> devices (device_id));
joinable!(floorplan_devices -> floorplans (floorplan_id));
joinable!(scene_state -> scenes (scene_id));

allow_tables_to_appear_in_same_query!(
    devices,
    floorplan_devices,
    floorplans,
    scene_state,
    scenes,
);
