use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub enum UiActionDescriptor {
    StoreUIState {
        key: String,
        #[ts(type = "any")]
        value: serde_json::Value,
    },
}
