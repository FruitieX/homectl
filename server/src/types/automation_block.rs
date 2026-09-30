//! DB-backed reusable, parameterized automation fragments.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct AutomationBlock {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "initial_revision")]
    pub revision: i64,
    #[serde(default)]
    pub inputs: BTreeMap<String, BlockInput>,
    /// ConditionExpr or an array of NativeAction templates. A whole JSON value
    /// may be replaced with {"$input":"name"}; source strings are never interpolated.
    pub body: Value,
    pub kind: BlockKind,
}
fn initial_revision() -> i64 {
    1
}

#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BlockKind {
    Condition,
    Action,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct BlockInput {
    pub label: String,
    pub kind: BlockInputKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default: Option<Value>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum BlockInputKind {
    Group,
    Scene,
    Helper,
    Device,
    Targets,
    Rollout,
    Boolean,
    Number,
    Duration,
    String,
    Enum { options: Vec<String> },
}
