table! {
    devices (id) {
        id -> Int4,
        serial -> Text,
        name -> Text,
        path -> Text,
        image -> Nullable<Bytea>,
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

joinable!(floorplan_devices -> devices (device_id));
joinable!(floorplan_devices -> floorplans (floorplan_id));

allow_tables_to_appear_in_same_query!(
    devices,
    floorplan_devices,
    floorplans,
);
