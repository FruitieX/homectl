//! Implementation of the pure v2 definition compiler.

use std::collections::{BTreeMap, HashSet};

use serde::de::IntoDeserializer;
use serde_json::Value;

use crate::core::routine_validation::{self, RoutineValidationReport, ValidatedRoutine};
use crate::db::config_queries::{ConfigExport, RoutineRow};
use crate::types::{
    automation_definition::{
        BacklogPolicy, ConditionExpr, ExecutionPolicy, HelperId, InvokeMode, NativeAction, NodeId,
        Program, RoutineDefinitionV2, RoutineSemantics, SceneSelection, ScheduleSpec,
        ScriptDeclaration, ScriptSpec, SourceId, StateChangeMode, TargetSpec, TimerId, TriggerSpec,
        ValueSource, ROUTINE_SEMANTICS_VERSION_V2,
    },
    automation_value::{HelperDefinition, HelperKind},
    device::{DeviceKey, DeviceRef},
    group::GroupId,
    rule::{RawRuleOperator, RoutineId},
    scene::SceneId,
};

/// Hard bounds for P03 definitions. P04/P05 may tighten or relax these with
/// explicit tests; the compiler must never accept unbounded programs.
pub const MAX_TRIGGERS: usize = 16;
pub const MAX_PROGRAM_ACTIONS: usize = 64;
pub const MAX_CONDITION_NODES: usize = 256;
pub const MAX_CONDITION_DEPTH: usize = 32;
pub const MAX_CHOOSE_DEPTH: usize = 8;
pub const MAX_SCRIPT_DECLARATIONS: usize = 32;
pub const MAX_PREDICATE_FOR_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const MAX_TIMER_DELAY_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const MAX_DIM_STEP: f32 = 1.0;
/// Upper bound for a rollout spread; well above any sane floorplan stagger.
pub const MAX_ROLLOUT_DURATION_MS: u64 = 10 * 60 * 1000;
pub const MAX_EXECUTION_ACTIONS: u32 = 64;
pub const SUPPORTED_SCRIPT_API_VERSION: u32 = 1;
pub const DEFAULT_LIMITS_PROFILE: &str = "default";

/// Resolved configuration surface a definition is compiled against.
///
/// `strict_devices` is enabled when the caller knows the full device set
/// (save/enable/import). Runtime loading uses a permissive catalog because
/// integrations may register devices asynchronously; missing devices then
/// surface at authoring time instead of quarantining on transient absence.
#[derive(Clone, Debug, Default)]
pub struct ConfigCatalog {
    devices: HashSet<DeviceKey>,
    groups: HashSet<GroupId>,
    scenes: HashSet<SceneId>,
    routines: HashSet<RoutineId>,
    helpers: BTreeMap<HelperId, HelperDefinition>,
    sources: HashSet<SourceId>,
    group_links: Vec<(GroupId, GroupId)>,
    strict_devices: bool,
}

impl ConfigCatalog {
    /// Stage an entity that an earlier operation of the same plan creates, so
    /// later operations may reference it before anything is applied.
    pub fn stage_created(&mut self, kind: &str, id: &str, body: &serde_json::Value) {
        match kind {
            "group" => {
                self.groups.insert(GroupId(id.to_string()));
            }
            "scene" => {
                self.scenes.insert(id.to_string().into());
            }
            "routine" => {
                self.routines.insert(id.to_string().into());
            }
            "source" => {
                self.sources.insert(SourceId(id.to_string()));
            }
            "helper" => {
                if let Ok(definition) = serde_json::from_value::<HelperDefinition>(body.clone()) {
                    self.helpers.insert(HelperId(id.to_string()), definition);
                }
            }
            _ => {}
        }
    }

    /// Build a strict catalog from a device snapshot and a config export.
    pub fn new<I>(devices: I, export: &ConfigExport) -> Self
    where
        I: IntoIterator<Item = DeviceKey>,
    {
        let mut catalog = Self::from_export(export);
        catalog.devices = devices.into_iter().collect();
        catalog.strict_devices = true;
        catalog
    }

    /// Build a catalog from an export alone. Device references are resolved
    /// only when the strict device set has been supplied with `new`.
    pub fn from_export(export: &ConfigExport) -> Self {
        let groups: HashSet<GroupId> = export
            .groups
            .iter()
            .map(|group| GroupId(group.id.clone()))
            .collect();
        let scenes = export
            .scenes
            .iter()
            .map(|scene| SceneId::from(scene.id.clone()))
            .collect();
        let routines = export
            .routines
            .iter()
            .map(|routine| RoutineId::from(routine.id.clone()))
            .collect();
        let group_links = export
            .groups
            .iter()
            .flat_map(|group| {
                group
                    .linked_groups
                    .iter()
                    .map(|child| (GroupId(group.id.clone()), GroupId(child.clone())))
            })
            .collect();
        let helpers = export
            .helpers
            .iter()
            .cloned()
            .map(|definition| (definition.id.clone(), definition))
            .collect();

        Self {
            devices: HashSet::new(),
            groups,
            scenes,
            routines,
            helpers,
            sources: export
                .sources
                .iter()
                .map(|source| source.id.clone())
                .collect(),
            group_links,
            strict_devices: false,
        }
    }

    /// Register a helper id with a permissive placeholder definition. Used by
    /// tests and call sites that only need `SetHelper` references to resolve.
    pub fn with_helper(mut self, helper: HelperId) -> Self {
        self.helpers.entry(helper.clone()).or_insert_with(|| {
            HelperDefinition::new(
                helper.as_str(),
                helper.as_str(),
                crate::types::automation_value::HelperKind::String,
            )
        });
        self
    }

    pub fn with_helper_definition(mut self, definition: HelperDefinition) -> Self {
        self.helpers.insert(definition.id.clone(), definition);
        self
    }

    pub fn helper(&self, helper: &HelperId) -> Option<&HelperDefinition> {
        self.helpers.get(helper)
    }

    pub fn with_source(mut self, source: SourceId) -> Self {
        self.sources.insert(source);
        self
    }

    pub fn with_group_link(mut self, parent: GroupId, child: GroupId) -> Self {
        self.group_links.push((parent, child));
        self
    }

    pub fn with_device(mut self, key: DeviceKey) -> Self {
        self.devices.insert(key);
        self.strict_devices = true;
        self
    }

    pub fn with_group(mut self, group: GroupId) -> Self {
        self.groups.insert(group);
        self
    }

    pub fn with_scene(mut self, scene: SceneId) -> Self {
        self.scenes.insert(scene);
        self
    }

    pub fn with_routine(mut self, routine: RoutineId) -> Self {
        self.routines.insert(routine);
        self
    }

    fn device_known(&self, key: &DeviceKey) -> bool {
        !self.strict_devices || self.devices.contains(key)
    }

    /// Returns the cycle path (`a -> b -> a`) when the group participates in
    /// a membership cycle, or `None` when its links are acyclic.
    fn group_cycle(&self, start: &GroupId) -> Option<String> {
        fn visit(
            catalog: &ConfigCatalog,
            node: &GroupId,
            path: &mut Vec<GroupId>,
            seen: &mut HashSet<GroupId>,
        ) -> Option<String> {
            if path.contains(node) {
                path.push(node.clone());
                return Some(
                    path.iter()
                        .map(|group| group.to_string())
                        .collect::<Vec<_>>()
                        .join(" -> "),
                );
            }
            if !seen.insert(node.clone()) {
                return None;
            }
            path.push(node.clone());
            for (parent, child) in &catalog.group_links {
                if parent == node {
                    if let Some(cycle) = visit(catalog, child, path, seen) {
                        return Some(cycle);
                    }
                }
            }
            path.pop();
            None
        }

        let mut path = Vec::new();
        let mut seen = HashSet::new();
        visit(self, start, &mut path, &mut seen)
    }
}

/// Version classification for a stored routine row.
pub fn row_semantics(row: &RoutineRow) -> RoutineSemantics {
    RoutineSemantics::from_version(row.semantics_version)
}

/// A successfully compiled routine row.
#[derive(Clone, Debug)]
pub enum CompiledRoutine {
    V1(ValidatedRoutine),
    V2(Box<CompiledDefinition>),
}

/// Metadata produced by compiling a v2 definition.
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledDefinition {
    /// Normalized definition (defaults applied, stable IDs preserved).
    pub normalized: RoutineDefinitionV2,
    pub subscriptions: Vec<TriggerSubscription>,
    pub dependencies: Vec<ResolvedReference>,
    pub write_capabilities: Vec<WriteCapability>,
    pub node_ids: Vec<NodeId>,
    /// Deterministic hash of the normalized definition.
    pub fingerprint: String,
}

impl CompiledDefinition {
    /// Devices this definition reads.
    pub fn referenced_devices(&self) -> Vec<DeviceKey> {
        self.dependencies
            .iter()
            .filter_map(|reference| match reference {
                ResolvedReference::Device(key) => Some(key.clone()),
                _ => None,
            })
            .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SubscriptionKind {
    DeviceReport,
    DeviceState,
    Predicate,
    Schedule,
    Timer,
    Startup,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TriggerSubscription {
    pub trigger_id: NodeId,
    pub kind: SubscriptionKind,
    pub devices: Vec<DeviceKey>,
    pub groups: Vec<GroupId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedReference {
    Device(DeviceKey),
    Group(GroupId),
    Scene(SceneId),
    Routine(RoutineId),
    Helper(HelperId),
    Source(SourceId),
    Timer(TimerId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum WriteKind {
    Device,
    Group,
    Scene,
    Routine,
    Helper,
    Timer,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct WriteCapability {
    pub kind: WriteKind,
    pub target: String,
}

/// Per-routine compiler results for reference/dependency inventories.
#[derive(Clone, Debug)]
pub enum ReferenceInventoryEntry {
    V1 {
        enabled: bool,
        result: Result<ValidatedRoutine, RoutineValidationReport>,
    },
    V2 {
        enabled: bool,
        result: Result<Box<CompiledDefinition>, RoutineValidationReport>,
    },
    UnsupportedVersion {
        enabled: bool,
        version: i32,
    },
}

impl ReferenceInventoryEntry {
    pub fn enabled(&self) -> bool {
        match self {
            Self::V1 { enabled, .. } | Self::V2 { enabled, .. } => *enabled,
            Self::UnsupportedVersion { enabled, .. } => *enabled,
        }
    }
}

/// Compile every routine row, including disabled drafts, for dependency and
/// migration inventories. Disabled drafts stay visible even when they do not
/// compile.
#[derive(Clone, Debug, Default)]
pub struct ReferenceInventory {
    pub entries: BTreeMap<String, ReferenceInventoryEntry>,
}

pub fn reference_inventory(rows: &[RoutineRow], catalog: &ConfigCatalog) -> ReferenceInventory {
    let mut entries = BTreeMap::new();
    for row in rows {
        let entry = match row_semantics(row) {
            RoutineSemantics::V1 => ReferenceInventoryEntry::V1 {
                enabled: row.enabled,
                result: routine_validation::validate_definition(&row.rules, &row.actions),
            },
            RoutineSemantics::V2 => ReferenceInventoryEntry::V2 {
                enabled: row.enabled,
                result: compile_row(row, catalog).map(|compiled| match compiled {
                    CompiledRoutine::V2(compiled) => compiled,
                    CompiledRoutine::V1(_) => unreachable!("v2 row compiled as v1"),
                }),
            },
            RoutineSemantics::Unknown(version) => ReferenceInventoryEntry::UnsupportedVersion {
                enabled: row.enabled,
                version,
            },
        };
        entries.insert(row.id.clone(), entry);
    }
    ReferenceInventory { entries }
}

/// Compile one stored routine row using its authoritative semantics version.
///
/// Unknown versions are rejected; v1 rows keep the legacy validator and are
/// never interpreted as v2 (and vice versa).
pub fn compile_row(
    row: &RoutineRow,
    catalog: &ConfigCatalog,
) -> Result<CompiledRoutine, RoutineValidationReport> {
    match row_semantics(row) {
        RoutineSemantics::V1 => routine_validation::validate_definition(&row.rules, &row.actions)
            .map(CompiledRoutine::V1),
        RoutineSemantics::V2 => {
            let Some(definition) = &row.definition_v2 else {
                let mut report = RoutineValidationReport::default();
                report.error(
                    "/definition_v2",
                    "missing_definition",
                    "Routine declares v2 semantics but has no definition_v2 body.",
                );
                return Err(report);
            };
            compile_definition_value_for(Some(row.id.as_str()), definition, catalog)
                .map(|compiled| CompiledRoutine::V2(Box::new(compiled)))
        }
        RoutineSemantics::Unknown(version) => {
            let mut report = RoutineValidationReport::default();
            report.error(
                "/semantics_version",
                "unsupported_semantics_version",
                format!(
                    "Unsupported routine semantics version {version}; this build supports versions 1 and 2."
                ),
            );
            Err(report)
        }
    }
}

/// Parse a raw `definition_v2` body without a catalog. Used by simulation
/// discovery, which only needs syntactic references.
pub fn parse_definition(value: &Value) -> Option<RoutineDefinitionV2> {
    serde_json::from_value(value.clone()).ok()
}

/// Compile a raw `definition_v2` body against a catalog.
pub fn compile_definition_value(
    value: &Value,
    catalog: &ConfigCatalog,
) -> Result<CompiledDefinition, RoutineValidationReport> {
    compile_definition_value_for(None, value, catalog)
}

fn compile_definition_value_for(
    owner_id: Option<&str>,
    value: &Value,
    catalog: &ConfigCatalog,
) -> Result<CompiledDefinition, RoutineValidationReport> {
    let deserializer = value.clone().into_deserializer();
    let definition: RoutineDefinitionV2 = match serde_path_to_error::deserialize(deserializer) {
        Ok(definition) => definition,
        Err(error) => {
            let mut report = RoutineValidationReport::default();
            report.error(
                path_to_pointer(error.path()),
                "invalid_definition",
                error.inner().to_string(),
            );
            return Err(report);
        }
    };

    compile_definition_inner(owner_id, &definition, catalog)
}

/// Compile a typed v2 definition against a catalog.
pub fn compile_definition(
    definition: &RoutineDefinitionV2,
    catalog: &ConfigCatalog,
) -> Result<CompiledDefinition, RoutineValidationReport> {
    compile_definition_inner(None, definition, catalog)
}

/// Collect every device referenced by a v2 definition without resolving it
/// against a catalog. Reused by simulation discovery and migration analysis.
pub fn referenced_devices(definition: &RoutineDefinitionV2) -> Vec<DeviceRef> {
    let mut collector = ReferenceCollector::default();
    collector.definition(definition);
    collector.devices
}

fn compile_definition_inner(
    owner_id: Option<&str>,
    definition: &RoutineDefinitionV2,
    catalog: &ConfigCatalog,
) -> Result<CompiledDefinition, RoutineValidationReport> {
    let mut compiler = Compiler {
        catalog,
        owner_id,
        report: RoutineValidationReport::default(),
        node_ids: HashSet::new(),
        node_id_order: Vec::new(),
        subscriptions: Vec::new(),
        dependencies: Vec::new(),
        write_capabilities: Vec::new(),
        condition_nodes: 0,
        action_count: 0,
    };

    compiler.compile_triggers(&definition.triggers);
    compiler.compile_condition(&definition.condition, "/condition", 0);
    compiler.compile_program(&definition.program);
    compiler.compile_execution(&definition.execution, "/execution");

    if !compiler.report.is_valid() {
        return Err(compiler.report);
    }

    let normalized = definition.clone();
    let fingerprint = definition_fingerprint(&normalized);

    Ok(CompiledDefinition {
        normalized,
        subscriptions: compiler.subscriptions,
        dependencies: compiler.dependencies,
        write_capabilities: compiler.write_capabilities,
        node_ids: compiler.node_id_order,
        fingerprint,
    })
}

/// Deterministic FNV-1a fingerprint over the normalized definition JSON.
pub fn definition_fingerprint(definition: &RoutineDefinitionV2) -> String {
    let json = serde_json::to_string(definition).unwrap_or_default();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in json.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Merge an incoming write with the stored row.
///
/// A legacy (v1) editor write to a v2 row preserves the stored v2 definition
/// and version, so a legacy client cannot silently drop v2 data (V08).
/// Explicit version changes between v1 and v2 are rejected in P03; there is
/// no automatic conversion.
pub fn prepare_write(
    existing: Option<&RoutineRow>,
    mut incoming: RoutineRow,
) -> Result<RoutineRow, String> {
    let incoming_semantics = row_semantics(&incoming);
    match existing.map(row_semantics) {
        Some(RoutineSemantics::V2) => match incoming_semantics {
            RoutineSemantics::V1 => {
                if incoming.definition_v2.is_some() {
                    return Err(
                        "Cannot store a v2 definition on a v1 semantics routine.".to_string()
                    );
                }
                incoming.semantics_version = ROUTINE_SEMANTICS_VERSION_V2;
                incoming.definition_v2 = existing.and_then(|row| row.definition_v2.clone());
            }
            RoutineSemantics::V2 => {}
            RoutineSemantics::Unknown(version) => {
                return Err(format!("Unsupported routine semantics version {version}."));
            }
        },
        Some(RoutineSemantics::V1) | None => match incoming_semantics {
            RoutineSemantics::V1 => {
                if incoming.definition_v2.is_some() {
                    return Err("definition_v2 requires semantics_version 2.".to_string());
                }
            }
            RoutineSemantics::V2 => {}
            RoutineSemantics::Unknown(version) => {
                return Err(format!("Unsupported routine semantics version {version}."));
            }
        },
        Some(RoutineSemantics::Unknown(version)) => {
            return Err(format!(
                "Stored routine uses unsupported semantics version {version}; refusing to rewrite it."
            ));
        }
    }

    Ok(incoming)
}

/// Rewrite `invoke_routine` references in a raw v2 definition body in place.
///
/// Operates on raw JSON so unknown/newer fields survive the rewrite verbatim.
/// Returns whether anything changed.
pub fn rewrite_invoked_routine_references(value: &mut Value, from: &str, to: &str) -> bool {
    match value {
        Value::Object(map) => {
            let mut changed = false;
            if map.get("action").and_then(Value::as_str) == Some("invoke_routine")
                && map.get("routine_id").and_then(Value::as_str) == Some(from)
            {
                map.insert("routine_id".to_string(), Value::String(to.to_string()));
                changed = true;
            }
            for child in map.values_mut() {
                changed |= rewrite_invoked_routine_references(child, from, to);
            }
            changed
        }
        Value::Array(items) => {
            let mut changed = false;
            for child in items.iter_mut() {
                changed |= rewrite_invoked_routine_references(child, from, to);
            }
            changed
        }
        _ => false,
    }
}

/// Next server-managed revision for a write of `existing`.
pub fn next_revision(existing: Option<&RoutineRow>) -> i64 {
    existing
        .map(|row| row.revision.saturating_add(1).max(1))
        .unwrap_or(1)
}

struct Compiler<'a> {
    catalog: &'a ConfigCatalog,
    owner_id: Option<&'a str>,
    report: RoutineValidationReport,
    node_ids: HashSet<String>,
    node_id_order: Vec<NodeId>,
    subscriptions: Vec<TriggerSubscription>,
    dependencies: Vec<ResolvedReference>,
    write_capabilities: Vec<WriteCapability>,
    condition_nodes: usize,
    action_count: usize,
}

impl Compiler<'_> {
    fn compile_triggers(&mut self, triggers: &[TriggerSpec]) {
        if triggers.is_empty() {
            self.report.error(
                "/triggers",
                "empty_triggers",
                "A v2 routine must declare at least one trigger.",
            );
            return;
        }
        if triggers.len() > MAX_TRIGGERS {
            self.report.error(
                "/triggers",
                "too_many_triggers",
                format!("At most {MAX_TRIGGERS} triggers are supported per routine."),
            );
        }

        for (index, trigger) in triggers.iter().enumerate() {
            let path = format!("/triggers/{index}");
            self.register_node(trigger.id(), &path);

            let mut subscription = TriggerSubscription {
                trigger_id: trigger.id().clone(),
                kind: SubscriptionKind::Manual,
                devices: Vec::new(),
                groups: Vec::new(),
            };

            match trigger {
                TriggerSpec::Report { device, field, .. } => {
                    subscription.kind = SubscriptionKind::DeviceReport;
                    if let Some(key) =
                        self.resolve_device(device, &path, "device", Some(trigger.id()))
                    {
                        subscription.devices.push(key);
                    }
                    if let Some(field) = field {
                        self.validate_pointer(field, &format!("{path}/field"));
                    }
                }
                TriggerSpec::StateChange { device, .. } => {
                    subscription.kind = SubscriptionKind::DeviceState;
                    if let Some(key) =
                        self.resolve_device(device, &path, "device", Some(trigger.id()))
                    {
                        subscription.devices.push(key);
                    }
                }
                TriggerSpec::PredicateTransition { predicate, .. } => {
                    subscription.kind = SubscriptionKind::Predicate;
                    self.compile_condition(predicate, &format!("{path}/predicate"), 0);
                }
                TriggerSpec::PredicateFor {
                    predicate,
                    duration_ms,
                    ..
                } => {
                    subscription.kind = SubscriptionKind::Predicate;
                    self.compile_condition(predicate, &format!("{path}/predicate"), 0);
                    if *duration_ms == 0 || *duration_ms > MAX_PREDICATE_FOR_MS {
                        self.report.error_at_node(
                            format!("{path}/duration_ms"),
                            trigger.id(),
                            "invalid_duration",
                            format!(
                                "predicate_for duration_ms must be in 1..={MAX_PREDICATE_FOR_MS}."
                            ),
                        );
                    }
                }
                TriggerSpec::Schedule { schedule, .. } => {
                    subscription.kind = SubscriptionKind::Schedule;
                    self.validate_schedule(schedule, &format!("{path}/schedule"), trigger.id());
                }
                TriggerSpec::TimerFired { timer, .. } => {
                    subscription.kind = SubscriptionKind::Timer;
                    self.validate_id(
                        &timer.0,
                        &format!("{path}/timer"),
                        Some(trigger.id()),
                        "timer",
                    );
                    self.add_dependency(ResolvedReference::Timer(timer.clone()));
                }
                TriggerSpec::Startup { .. } => {
                    subscription.kind = SubscriptionKind::Startup;
                }
                TriggerSpec::Manual { .. } => {
                    subscription.kind = SubscriptionKind::Manual;
                }
            }

            self.subscriptions.push(subscription);
        }
    }

    fn compile_condition(&mut self, condition: &ConditionExpr, path: &str, depth: usize) {
        self.condition_nodes += 1;
        if self.condition_nodes > MAX_CONDITION_NODES {
            self.report.error(
                path,
                "condition_too_large",
                format!("Conditions are limited to {MAX_CONDITION_NODES} nodes."),
            );
            return;
        }
        if depth > MAX_CONDITION_DEPTH {
            self.report.error(
                path,
                "condition_too_deep",
                format!("Conditions are limited to depth {MAX_CONDITION_DEPTH}."),
            );
            return;
        }

        match condition {
            ConditionExpr::Literal { .. } => {}
            ConditionExpr::All { conditions } | ConditionExpr::Any { conditions } => {
                if conditions.is_empty() {
                    self.report.error(
                        path,
                        "empty_condition",
                        "Stored all/any conditions must contain at least one child.",
                    );
                }
                for (index, child) in conditions.iter().enumerate() {
                    self.compile_condition(child, &format!("{path}/conditions/{index}"), depth + 1);
                }
            }
            ConditionExpr::Not { condition } => {
                self.compile_condition(condition, &format!("{path}/condition"), depth + 1);
            }
            ConditionExpr::Comparison {
                source,
                operator,
                value,
            } => {
                match source {
                    ValueSource::Device {
                        device,
                        path: pointer,
                    } => {
                        self.resolve_device(device, path, "source/device", None);
                        self.validate_pointer(pointer, &format!("{path}/source/path"));
                    }
                    ValueSource::Helper { helper } => {
                        if !self.catalog.helpers.contains_key(helper) {
                            self.report.error_with_entity(
                                format!("{path}/source/helper"),
                                None,
                                "unknown_helper",
                                format!("Unknown helper '{}'.", helper),
                                helper.to_string(),
                            );
                        }
                        self.add_dependency(ResolvedReference::Helper(helper.clone()));
                    }
                    ValueSource::ComputedSource {
                        source,
                        path: pointer,
                    } => {
                        if !self.catalog.sources.contains(source) {
                            self.report.error_with_entity(
                                format!("{path}/source/source"),
                                None,
                                "unknown_source",
                                format!("Unknown computed source '{}'.", source),
                                source.to_string(),
                            );
                        }
                        self.validate_pointer(pointer, &format!("{path}/source/path"));
                        self.add_dependency(ResolvedReference::Source(source.clone()));
                    }
                }

                let takes_value =
                    !matches!(operator, RawRuleOperator::Exists | RawRuleOperator::Truthy);
                if takes_value && value.is_none() {
                    self.report.error(
                        format!("{path}/value"),
                        "missing_operator_value",
                        format!(
                            "Operator '{}' requires a comparison value.",
                            operator_code(operator)
                        ),
                    );
                }
                if !takes_value && value.is_some() {
                    self.report.error(
                        format!("{path}/value"),
                        "unexpected_operator_value",
                        format!(
                            "Operator '{}' does not take a comparison value.",
                            operator_code(operator)
                        ),
                    );
                }
            }
            ConditionExpr::Group {
                group_id,
                power,
                scene,
                ..
            } => {
                self.resolve_group(group_id, &format!("{path}/group_id"), None);
                if let Some(scene_id) = scene {
                    if !self.catalog.scenes.contains(scene_id) {
                        self.report.error_with_entity(
                            format!("{path}/scene"),
                            None,
                            "unknown_scene",
                            format!("Unknown scene '{scene_id}'."),
                            scene_id.to_string(),
                        );
                    }
                    self.add_dependency(ResolvedReference::Scene(scene_id.clone()));
                }
                if power.is_none() && scene.is_none() {
                    self.report.error(
                        path,
                        "missing_group_predicate",
                        "A group condition must select power and/or scene.",
                    );
                }
            }
        }
    }

    fn compile_program(&mut self, program: &Program) {
        match program {
            Program::Native(native) => {
                if native.steps.is_empty() {
                    self.report.error(
                        "/program/steps",
                        "empty_program",
                        "A native program must contain at least one action.",
                    );
                    return;
                }
                self.compile_native_steps(&native.steps, "/program/steps", 0);
            }
            Program::Script(script) => {
                self.compile_script(&script.spec, "/program/spec");
            }
        }
    }

    fn compile_native_steps(&mut self, steps: &[NativeAction], path: &str, depth: usize) {
        if depth > MAX_CHOOSE_DEPTH {
            self.report.error(
                path,
                "choose_too_deep",
                format!("choose branching is limited to depth {MAX_CHOOSE_DEPTH}."),
            );
            return;
        }

        for (index, action) in steps.iter().enumerate() {
            if self.action_count >= MAX_PROGRAM_ACTIONS {
                self.report.error(
                    path,
                    "program_too_large",
                    format!("Programs are limited to {MAX_PROGRAM_ACTIONS} actions."),
                );
                return;
            }
            self.action_count += 1;

            let action_path = format!("{path}/{index}");
            self.register_node(action.id(), &action_path);

            match action {
                NativeAction::ActivateScene {
                    scene_id,
                    select,
                    targets,
                    transition_ms,
                    rollout,
                    ..
                } => {
                    match (scene_id, select) {
                        (Some(_), Some(_)) => {
                            self.report.error_at_node(
                                &action_path,
                                action.id(),
                                "ambiguous_scene_selection",
                                "ActivateScene must specify exactly one of scene_id or select.",
                            );
                        }
                        (None, None) => {
                            self.report.error_at_node(
                                &action_path,
                                action.id(),
                                "missing_scene_selection",
                                "ActivateScene requires scene_id or select.",
                            );
                        }
                        (Some(scene_id), None) => {
                            self.resolve_scene_id(
                                scene_id,
                                &format!("{action_path}/scene_id"),
                                action.id(),
                            );
                        }
                        (None, Some(selection)) => {
                            self.compile_scene_selection(
                                selection,
                                &format!("{action_path}/select"),
                                action.id(),
                            );
                        }
                    }
                    self.compile_targets(targets, &format!("{action_path}/targets"), action.id());
                    if let Some(transition_ms) = transition_ms {
                        if *transition_ms == 0 {
                            self.report.error_at_node(
                                format!("{action_path}/transition_ms"),
                                action.id(),
                                "invalid_duration",
                                "ActivateScene transition_ms must be greater than zero.",
                            );
                        }
                    }
                    self.compile_rollout(rollout, &format!("{action_path}/rollout"), action.id());
                }
                NativeAction::SetPower { device, power, .. } => {
                    let _ = power;
                    if let Some(key) =
                        self.resolve_device(device, &action_path, "device", Some(action.id()))
                    {
                        self.add_write(WriteKind::Device, key.to_string());
                    }
                }
                NativeAction::Dim {
                    targets,
                    step,
                    transition_ms,
                    ..
                } => {
                    if !step.is_finite() || *step == 0.0 || step.abs() > MAX_DIM_STEP {
                        self.report.error_at_node(
                            format!("{action_path}/step"),
                            action.id(),
                            "invalid_dim_step",
                            format!(
                                "Dim step must be finite, non-zero, and within ±{MAX_DIM_STEP}."
                            ),
                        );
                    }
                    if let Some(transition) = transition_ms {
                        if *transition == 0 {
                            self.report.error_at_node(
                                format!("{action_path}/transition_ms"),
                                action.id(),
                                "invalid_duration",
                                "Dim transition_ms must be greater than zero.",
                            );
                        }
                    }
                    if targets.devices.is_empty() && targets.groups.is_empty() {
                        self.report.error_at_node(
                            &action_path,
                            action.id(),
                            "missing_targets",
                            "Dim requires at least one device or group target.",
                        );
                    }
                    self.compile_targets(targets, &format!("{action_path}/targets"), action.id());
                }
                NativeAction::RandomizeColor {
                    targets,
                    min_saturation,
                    max_saturation,
                    transition_ms,
                    ..
                } => {
                    for (field, value) in [
                        ("min_saturation", min_saturation),
                        ("max_saturation", max_saturation),
                    ] {
                        if let Some(value) = value {
                            if !value.is_finite() {
                                self.report.error_at_node(
                                    format!("{action_path}/{field}"),
                                    action.id(),
                                    "invalid_saturation",
                                    "Saturation bounds must be finite 0.0..=1.0 values.",
                                );
                            }
                        }
                    }
                    if let Some(transition) = transition_ms {
                        if *transition == 0 {
                            self.report.error_at_node(
                                format!("{action_path}/transition_ms"),
                                action.id(),
                                "invalid_duration",
                                "RandomizeColor transition_ms must be greater than zero.",
                            );
                        }
                    }
                    if targets.devices.is_empty() && targets.groups.is_empty() {
                        self.report.error_at_node(
                            &action_path,
                            action.id(),
                            "missing_targets",
                            "RandomizeColor requires at least one device or group target.",
                        );
                    }
                    self.compile_targets(targets, &format!("{action_path}/targets"), action.id());
                }
                NativeAction::CycleScenes {
                    scenes,
                    detection,
                    rollout,
                    ..
                } => {
                    if scenes.is_empty() {
                        self.report.error_at_node(
                            &action_path,
                            action.id(),
                            "empty_cycle_scenes",
                            "cycle_scenes requires at least one scene.",
                        );
                    }
                    for (index, entry) in scenes.iter().enumerate() {
                        let entry_path = format!("{action_path}/scenes/{index}");
                        self.resolve_scene_id(
                            &entry.scene_id,
                            &format!("{entry_path}/scene_id"),
                            action.id(),
                        );
                        self.compile_targets(
                            &entry.targets,
                            &format!("{entry_path}/targets"),
                            action.id(),
                        );
                        if let Some(transition_ms) = entry.transition_ms {
                            if transition_ms == 0 {
                                self.report.error_at_node(
                                    format!("{entry_path}/transition_ms"),
                                    action.id(),
                                    "invalid_duration",
                                    "cycle_scenes transition_ms must be greater than zero.",
                                );
                            }
                        }
                    }
                    // Detection targets are read-only: they narrow which
                    // devices decide the current scene and are never written.
                    for (index, device) in detection.devices.iter().enumerate() {
                        self.resolve_device(
                            device,
                            &format!("{action_path}/detection"),
                            &format!("devices/{index}"),
                            Some(action.id()),
                        );
                    }
                    for (index, group) in detection.groups.iter().enumerate() {
                        self.resolve_group(
                            group,
                            &format!("{action_path}/detection/groups/{index}"),
                            Some(action.id()),
                        );
                    }
                    self.compile_rollout(rollout, &format!("{action_path}/rollout"), action.id());
                }
                NativeAction::Choose { branches, .. } => {
                    if branches.is_empty() {
                        self.report.error_at_node(
                            &action_path,
                            action.id(),
                            "empty_choose",
                            "choose requires at least one branch.",
                        );
                        continue;
                    }
                    for (branch_index, branch) in branches.iter().enumerate() {
                        let branch_path = format!("{action_path}/branches/{branch_index}");
                        self.register_node(&branch.id, &branch_path);
                        self.compile_condition(
                            &branch.condition,
                            &format!("{branch_path}/condition"),
                            0,
                        );
                        if branch.steps.is_empty() {
                            self.report.error(
                                &branch_path,
                                "empty_branch",
                                "choose branches must contain at least one action.",
                            );
                            continue;
                        }
                        self.compile_native_steps(
                            &branch.steps,
                            &format!("{branch_path}/steps"),
                            depth + 1,
                        );
                    }
                }
                NativeAction::ScheduleTimer {
                    timer,
                    delay_ms,
                    capture_target_intents,
                    ..
                }
                | NativeAction::ReplaceTimer {
                    timer,
                    delay_ms,
                    capture_target_intents,
                    ..
                } => {
                    self.validate_id(
                        &timer.0,
                        &format!("{action_path}/timer"),
                        Some(action.id()),
                        "timer",
                    );
                    // J04: zero delay is allowed and queues a later event; it
                    // never runs inline.
                    if *delay_ms > MAX_TIMER_DELAY_MS {
                        self.report.error_at_node(
                            format!("{action_path}/delay_ms"),
                            action.id(),
                            "invalid_duration",
                            format!(
                                "Timer delay must be in 0..={MAX_TIMER_DELAY_MS} milliseconds."
                            ),
                        );
                    }
                    if let Some(capture) = capture_target_intents {
                        let capture_path = format!("{action_path}/capture_target_intents");
                        if capture.devices.is_empty() && capture.groups.is_empty() {
                            self.report.error_at_node(
                                capture_path.clone(),
                                action.id(),
                                "invalid_capture_targets",
                                "capture_target_intents must name at least one target.",
                            );
                        }
                        for reference in &capture.devices {
                            self.resolve_device(
                                reference,
                                &capture_path,
                                "devices",
                                Some(action.id()),
                            );
                        }
                        for group in &capture.groups {
                            self.resolve_group(group, &capture_path, Some(action.id()));
                        }
                    }
                    self.add_write(WriteKind::Timer, timer.to_string());
                }
                NativeAction::CancelTimer { timer, .. } => {
                    self.validate_id(
                        &timer.0,
                        &format!("{action_path}/timer"),
                        Some(action.id()),
                        "timer",
                    );
                    self.add_write(WriteKind::Timer, timer.to_string());
                }
                NativeAction::SetHelper { helper, value, .. } => {
                    match self.catalog.helpers.get(helper).cloned() {
                        Some(definition) => {
                            if let Err(error) = definition.kind.validate_value(value) {
                                self.report.error_at_node(
                                    format!("{action_path}/value"),
                                    action.id(),
                                    "invalid_helper_value",
                                    format!("Value is invalid for helper '{helper}': {error}"),
                                );
                            }
                        }
                        None => {
                            self.report.error_with_entity(
                                format!("{action_path}/helper"),
                                Some(action.id().as_str()),
                                "unknown_helper",
                                format!("Unknown helper '{helper}'."),
                                helper.to_string(),
                            );
                        }
                    }
                    self.add_write(WriteKind::Helper, helper.to_string());
                    self.add_dependency(ResolvedReference::Helper(helper.clone()));
                }
                NativeAction::InvokeRoutine { routine_id, .. } => {
                    if let Some(owner) = self.owner_id {
                        if owner == routine_id.to_string() {
                            self.report.error_with_entity(
                                &action_path,
                                Some(action.id().as_str()),
                                "routine_cycle",
                                "A routine cannot invoke itself.",
                                owner.to_string(),
                            );
                            continue;
                        }
                    }
                    if !self.catalog.routines.contains(routine_id) {
                        self.report.error_with_entity(
                            format!("{action_path}/routine_id"),
                            Some(action.id().as_str()),
                            "unknown_routine",
                            format!("Unknown routine '{routine_id}'."),
                            routine_id.to_string(),
                        );
                    }
                    self.add_dependency(ResolvedReference::Routine(routine_id.clone()));
                    self.add_write(WriteKind::Routine, routine_id.to_string());
                }
            }
        }
    }

    fn compile_targets(&mut self, targets: &TargetSpec, path: &str, node: &NodeId) {
        for (index, device) in targets.devices.iter().enumerate() {
            if let Some(key) =
                self.resolve_device(device, path, &format!("devices/{index}"), Some(node))
            {
                self.add_write(WriteKind::Device, key.to_string());
            }
        }
        for (index, group) in targets.groups.iter().enumerate() {
            self.resolve_group(group, &format!("{path}/groups/{index}"), Some(node));
            self.add_write(WriteKind::Group, group.to_string());
        }
    }

    /// Rollout affects timing only; the compiler checks the duration bound and
    /// that a fixed source device exists. `TriggeringDevice` resolves at plan
    /// time (and falls back to an immediate apply when the run has no
    /// triggering device).
    fn compile_rollout(
        &mut self,
        rollout: &Option<crate::types::automation_definition::RolloutSpec>,
        path: &str,
        node: &NodeId,
    ) {
        let Some(rollout) = rollout else {
            return;
        };
        if let Some(duration_ms) = rollout.duration_ms {
            if duration_ms > MAX_ROLLOUT_DURATION_MS {
                self.report.error_at_node(
                    format!("{path}/duration_ms"),
                    node,
                    "invalid_duration",
                    format!("Rollout duration must not exceed {MAX_ROLLOUT_DURATION_MS} ms."),
                );
            }
        }
        if let Some(crate::types::automation_definition::RolloutSource::Device { device }) =
            &rollout.source
        {
            if let Some(key) = self.resolve_device(device, path, "source", Some(node)) {
                self.add_dependency(ResolvedReference::Device(key));
            }
        }
    }

    fn compile_script(&mut self, spec: &ScriptSpec, path: &str) {
        if spec.api_version != SUPPORTED_SCRIPT_API_VERSION {
            self.report.error(
                format!("{path}/api_version"),
                "unsupported_script_api_version",
                format!(
                    "Unsupported script api_version {}; this build supports {SUPPORTED_SCRIPT_API_VERSION}.",
                    spec.api_version
                ),
            );
        }
        if spec.source_body.trim().is_empty() {
            self.report.error(
                format!("{path}/source_body"),
                "empty_script_body",
                "Script programs require a non-empty function body.",
            );
        } else if let Err(message) = parse_script_function_body(&spec.source_body) {
            self.report.error(
                format!("{path}/source_body"),
                "invalid_script_syntax",
                message,
            );
        }
        if spec.limits_profile != DEFAULT_LIMITS_PROFILE {
            self.report.error(
                format!("{path}/limits_profile"),
                "unsupported_limits_profile",
                format!(
                    "Unsupported script limits profile '{}'; this build supports '{DEFAULT_LIMITS_PROFILE}'.",
                    spec.limits_profile
                ),
            );
        }
        if spec.declarations.len() > MAX_SCRIPT_DECLARATIONS {
            self.report.error(
                format!("{path}/declarations"),
                "too_many_declarations",
                format!("At most {MAX_SCRIPT_DECLARATIONS} script declarations are supported."),
            );
        }
        for (index, declaration) in spec.declarations.iter().enumerate() {
            let declaration_path = format!("{path}/declarations/{index}");
            match declaration {
                ScriptDeclaration::Device { device } => {
                    // S13: declarations may name entities that are not
                    // discovered yet. The reference is tracked instead of
                    // rejected so discovery can wake the script; until then
                    // the runtime has no state for the missing entity.
                    let DeviceRef::Id(id_ref) = device;
                    self.add_dependency(ResolvedReference::Device(
                        id_ref.clone().into_device_key(),
                    ));
                }
                ScriptDeclaration::Group { group_id } => {
                    // S13: same forward-reference tracking as devices. Known
                    // groups are still checked for membership cycles.
                    if let Some(cycle) = self.catalog.group_cycle(group_id) {
                        self.report.error_with_entity(
                            format!("{declaration_path}/group_id"),
                            None,
                            "group_cycle",
                            format!("Group membership cycle: {cycle}."),
                            group_id.to_string(),
                        );
                    }
                    self.add_dependency(ResolvedReference::Group(group_id.clone()));
                }
                ScriptDeclaration::Timer { timer } => {
                    self.validate_id(
                        &timer.0,
                        &format!("{declaration_path}/timer"),
                        None,
                        "timer",
                    );
                    self.add_dependency(ResolvedReference::Timer(timer.clone()));
                }
                // Broad compatibility mode only widens the runtime context;
                // there is no entity to resolve or subscribe to.
                ScriptDeclaration::AllState => {}
            }
        }
    }

    fn compile_execution(&mut self, execution: &ExecutionPolicy, path: &str) {
        if execution.max_actions == 0 || execution.max_actions > MAX_EXECUTION_ACTIONS {
            self.report.error(
                format!("{path}/max_actions"),
                "invalid_execution_policy",
                format!("max_actions must be in 1..={MAX_EXECUTION_ACTIONS}."),
            );
        }
        if execution.min_interval_ms == Some(0) {
            self.report.error(
                format!("{path}/min_interval_ms"),
                "invalid_execution_policy",
                "min_interval_ms must be greater than zero when present.",
            );
        }
    }

    fn resolve_device(
        &mut self,
        device_ref: &DeviceRef,
        path: &str,
        field: &str,
        node: Option<&NodeId>,
    ) -> Option<DeviceKey> {
        let DeviceRef::Id(id_ref) = device_ref;
        let key = id_ref.clone().into_device_key();
        if !self.catalog.device_known(&key) {
            self.report.error_with_entity(
                format!("{path}/{field}"),
                node.map(NodeId::as_str),
                "unknown_device",
                format!("Unknown device '{key}'."),
                key.to_string(),
            );
            return None;
        }
        self.add_dependency(ResolvedReference::Device(key.clone()));
        Some(key)
    }

    fn resolve_group(&mut self, group_id: &GroupId, path: &str, node: Option<&NodeId>) {
        if !self.catalog.groups.contains(group_id) {
            self.report.error_with_entity(
                path,
                node.map(NodeId::as_str),
                "unknown_group",
                format!("Unknown group '{group_id}'."),
                group_id.to_string(),
            );
            return;
        }
        if let Some(cycle) = self.catalog.group_cycle(group_id) {
            self.report.error_with_entity(
                path,
                node.map(NodeId::as_str),
                "group_cycle",
                format!("Group membership cycle: {cycle}."),
                group_id.to_string(),
            );
        }
        self.add_dependency(ResolvedReference::Group(group_id.clone()));
    }

    fn resolve_scene_id(
        &mut self,
        scene_id: &SceneId,
        path: &str,
        node: &NodeId,
    ) -> Option<SceneId> {
        if !self.catalog.scenes.contains(scene_id) {
            self.report.error_with_entity(
                path.to_string(),
                Some(node.as_str()),
                "unknown_scene",
                format!("Unknown scene '{scene_id}'."),
                scene_id.to_string(),
            );
            return None;
        }
        self.add_dependency(ResolvedReference::Scene(scene_id.clone()));
        self.add_write(WriteKind::Scene, scene_id.to_string());
        Some(scene_id.clone())
    }

    fn compile_scene_selection(&mut self, selection: &SceneSelection, path: &str, node: &NodeId) {
        match selection {
            SceneSelection::HelperEnum {
                helper,
                mapping,
                fallback_scene_id,
            } => {
                let definition = self.catalog.helpers.get(helper).cloned();
                match definition {
                    Some(definition) => {
                        self.add_dependency(ResolvedReference::Helper(helper.clone()));
                        match &definition.kind {
                            HelperKind::Enum { options } => {
                                for key in mapping.keys() {
                                    if !options.iter().any(|option| option == key) {
                                        self.report.error_at_node(
                                            format!("{path}/mapping/{key}"),
                                            node,
                                            "invalid_mapping_key",
                                            format!(
                                                "'{key}' is not an option of helper '{helper}'."
                                            ),
                                        );
                                    }
                                }
                            }
                            kind => {
                                self.report.error_at_node(
                                    format!("{path}/helper"),
                                    node,
                                    "helper_kind_mismatch",
                                    format!(
                                        "Scene selection requires an enum helper, but \
                                         '{helper}' is {}.",
                                        kind.code()
                                    ),
                                );
                            }
                        }
                    }
                    None => {
                        self.report.error_with_entity(
                            format!("{path}/helper"),
                            Some(node.as_str()),
                            "unknown_helper",
                            format!("Unknown helper '{helper}'."),
                            helper.to_string(),
                        );
                    }
                }
                if mapping.is_empty() {
                    self.report.error_at_node(
                        format!("{path}/mapping"),
                        node,
                        "empty_scene_mapping",
                        "Scene selection requires at least one mapping entry.",
                    );
                }
                for (key, scene_id) in mapping {
                    self.resolve_scene_id(scene_id, &format!("{path}/mapping/{key}"), node);
                }
                if let Some(fallback) = fallback_scene_id {
                    self.resolve_scene_id(fallback, &format!("{path}/fallback_scene_id"), node);
                }
            }
            SceneSelection::GroupActive {
                group_id,
                fallback_scene_id,
            } => {
                self.resolve_group(group_id, &format!("{path}/group_id"), Some(node));
                if let Some(fallback) = fallback_scene_id {
                    self.resolve_scene_id(fallback, &format!("{path}/fallback_scene_id"), node);
                }
            }
        }
    }

    fn validate_schedule(&mut self, schedule: &ScheduleSpec, path: &str, node: &NodeId) {
        match (&schedule.cron, schedule.every_ms) {
            (Some(_), Some(_)) => {
                self.report.error_at_node(
                    path,
                    node,
                    "ambiguous_schedule",
                    "A schedule must declare exactly one of cron or every_ms.",
                );
            }
            (None, None) => {
                self.report.error_at_node(
                    path,
                    node,
                    "missing_schedule",
                    "A schedule must declare exactly one of cron or every_ms.",
                );
            }
            (Some(cron), None) => {
                // K01: the six-field grammar is configured explicitly and the
                // pinned croner grammar is preserved (DOM/DOW-OR included),
                // but its calendar resolution is never reused for DST
                // semantics; occurrences are generated from civil time.
                let parser = croner::parser::CronParser::builder()
                    .seconds(croner::parser::Seconds::Required)
                    .build();
                if let Err(error) = parser.parse(cron) {
                    self.report.error_at_node(
                        format!("{path}/cron"),
                        node,
                        "invalid_cron",
                        format!("Invalid cron expression: {error}"),
                    );
                }
            }
            (None, Some(every_ms)) => {
                if every_ms == 0 || every_ms > MAX_TIMER_DELAY_MS {
                    self.report.error_at_node(
                        format!("{path}/every_ms"),
                        node,
                        "invalid_duration",
                        format!("every_ms must be in 1..={MAX_TIMER_DELAY_MS}."),
                    );
                }
            }
        }

        if let Some(timezone) = &schedule.timezone {
            if let Err(reason) = timezone_error(timezone) {
                self.report.error_at_node(
                    format!("{path}/timezone"),
                    node,
                    "invalid_timezone",
                    format!("Invalid timezone '{timezone}': {reason}."),
                );
            }
        }

        match (&schedule.cron, schedule.every_ms) {
            (Some(_), None) => match schedule.backlog {
                BacklogPolicy::Skip => {
                    if schedule.catch_up_lateness_ms.is_some() {
                        self.report.error_at_node(
                            format!("{path}/catch_up_lateness_ms"),
                            node,
                            "schedule_policy_not_applicable",
                            "catch_up_lateness_ms requires backlog = catch_up_once.",
                        );
                    }
                }
                BacklogPolicy::CatchUpOnce => match schedule.catch_up_lateness_ms {
                    Some(lateness) if lateness > 0 && lateness <= MAX_TIMER_DELAY_MS => {}
                    Some(lateness) => {
                        self.report.error_at_node(
                            format!("{path}/catch_up_lateness_ms"),
                            node,
                            "invalid_duration",
                            format!(
                                "catch_up_lateness_ms must be in 1..={MAX_TIMER_DELAY_MS}, got {lateness}."
                            ),
                        );
                    }
                    None => {
                        self.report.error_at_node(
                            format!("{path}/backlog"),
                            node,
                            "schedule_policy_not_applicable",
                            "backlog = catch_up_once requires catch_up_lateness_ms.",
                        );
                    }
                },
            },
            (None, Some(_))
                if schedule.backlog != BacklogPolicy::Skip
                    || schedule.catch_up_lateness_ms.is_some() =>
            {
                self.report.error_at_node(
                    format!("{path}/backlog"),
                    node,
                    "schedule_policy_not_applicable",
                    "Calendar backlog policy applies to cron schedules only.",
                );
            }
            _ => {}
        }
    }

    fn validate_pointer(&mut self, pointer: &str, path: &str) {
        if !pointer.starts_with('/') {
            self.report.error(
                path,
                "invalid_json_pointer",
                format!("Expected a JSON pointer starting with '/', got '{pointer}'."),
            );
        }
    }

    fn validate_id(&mut self, value: &str, path: &str, node: Option<&NodeId>, kind: &str) {
        if value.trim().is_empty() {
            match node {
                Some(node) => self.report.error_at_node(
                    path,
                    node,
                    "missing_id",
                    format!("A {kind} ID must not be empty."),
                ),
                None => self.report.error(
                    path,
                    "missing_id",
                    format!("A {kind} ID must not be empty."),
                ),
            }
        }
    }

    fn register_node(&mut self, id: &NodeId, path: &str) {
        if id.0.trim().is_empty() {
            self.report.error(
                path,
                "missing_node_id",
                "Definition nodes require a stable non-empty ID.",
            );
            return;
        }
        if !self.node_ids.insert(id.0.clone()) {
            self.report.error_at_node(
                path,
                id,
                "duplicate_node_id",
                format!("Duplicate node ID '{}'.", id.0),
            );
            return;
        }
        self.node_id_order.push(id.clone());
    }

    fn add_dependency(&mut self, reference: ResolvedReference) {
        if !self.dependencies.contains(&reference) {
            self.dependencies.push(reference);
        }
    }

    fn add_write(&mut self, kind: WriteKind, target: String) {
        let capability = WriteCapability { kind, target };
        if !self.write_capabilities.contains(&capability) {
            self.write_capabilities.push(capability);
        }
    }
}

/// Lightweight traversal that extracts device references from any v2
/// definition body, valid or not, for discovery/inventory purposes.
#[derive(Default)]
struct ReferenceCollector {
    devices: Vec<DeviceRef>,
}

impl ReferenceCollector {
    fn definition(&mut self, definition: &RoutineDefinitionV2) {
        for trigger in &definition.triggers {
            match trigger {
                TriggerSpec::Report { device, .. } | TriggerSpec::StateChange { device, .. } => {
                    self.push_device(device)
                }
                TriggerSpec::PredicateTransition { predicate, .. }
                | TriggerSpec::PredicateFor { predicate, .. } => self.condition(predicate),
                _ => {}
            }
        }
        self.condition(&definition.condition);
        match &definition.program {
            Program::Native(native) => self.steps(&native.steps),
            Program::Script(script) => {
                for declaration in &script.spec.declarations {
                    if let ScriptDeclaration::Device { device } = declaration {
                        self.push_device(device);
                    }
                }
            }
        }
    }

    fn steps(&mut self, steps: &[NativeAction]) {
        for action in steps {
            match action {
                NativeAction::SetPower { device, .. } => self.push_device(device),
                NativeAction::ActivateScene { targets, .. }
                | NativeAction::Dim { targets, .. }
                | NativeAction::RandomizeColor { targets, .. } => {
                    for device in &targets.devices {
                        self.push_device(device);
                    }
                }
                NativeAction::CycleScenes {
                    scenes, detection, ..
                } => {
                    for device in &detection.devices {
                        self.push_device(device);
                    }
                    for entry in scenes {
                        for device in &entry.targets.devices {
                            self.push_device(device);
                        }
                    }
                }
                NativeAction::Choose { branches, .. } => {
                    for branch in branches {
                        self.condition(&branch.condition);
                        self.steps(&branch.steps);
                    }
                }
                _ => {}
            }
        }
    }

    fn condition(&mut self, condition: &ConditionExpr) {
        match condition {
            ConditionExpr::All { conditions } | ConditionExpr::Any { conditions } => {
                for child in conditions {
                    self.condition(child);
                }
            }
            ConditionExpr::Not { condition } => self.condition(condition),
            ConditionExpr::Comparison {
                source: ValueSource::Device { device, .. },
                ..
            } => self.push_device(device),
            ConditionExpr::Comparison { .. } => {}
            _ => {}
        }
    }

    fn push_device(&mut self, device: &DeviceRef) {
        if !self.devices.contains(device) {
            self.devices.push(device.clone());
        }
    }
}

fn operator_code(operator: &RawRuleOperator) -> &'static str {
    match operator {
        RawRuleOperator::Eq => "eq",
        RawRuleOperator::Ne => "ne",
        RawRuleOperator::Gt => "gt",
        RawRuleOperator::Gte => "gte",
        RawRuleOperator::Lt => "lt",
        RawRuleOperator::Lte => "lte",
        RawRuleOperator::Contains => "contains",
        RawRuleOperator::StartsWith => "starts_with",
        RawRuleOperator::Exists => "exists",
        RawRuleOperator::Truthy => "truthy",
        RawRuleOperator::Regex => "regex",
    }
}

/// Convert a serde path (`triggers[0].kind`) into a JSON pointer
/// (`/triggers/0/kind`). Empty paths point at the definition root.
fn path_to_pointer(path: &serde_path_to_error::Path) -> String {
    use serde_path_to_error::Segment;

    let mut pointer = String::new();
    for segment in path.iter() {
        match segment {
            Segment::Map { key } => {
                pointer.push('/');
                pointer.push_str(&key.replace('~', "~0").replace('/', "~1"));
            }
            Segment::Seq { index } => {
                pointer.push('/');
                pointer.push_str(&index.to_string());
            }
            Segment::Enum { variant } => {
                pointer.push('/');
                pointer.push_str(variant);
            }
            Segment::Unknown => pointer.push_str("/*"),
        }
    }

    if pointer.is_empty() {
        "/definition_v2".to_string()
    } else {
        pointer
    }
}

/// Syntax-check a v2 script function body without executing it.
///
/// The body is wrapped in a function so `return` is unambiguous (the v2 ABI is
/// function-body source). Boa only parses here; execution belongs to P06.
fn parse_script_function_body(source: &str) -> Result<(), String> {
    let wrapped = format!("(function __homectl_v2_body() {{\n{source}\n}})");
    routine_validation::parse_script(&wrapped)
}

/// Resolve a schedule timezone to an IANA zone (chrono-tz) or a fixed offset.
/// Calendar schedules store IANA zones so DST policy stays stable across
/// process restarts and host configuration changes (K).
fn timezone_error(timezone: &str) -> Result<(), String> {
    if timezone.trim() != timezone || timezone.is_empty() {
        return Err("expected a non-empty trimmed name".to_string());
    }
    if timezone.eq_ignore_ascii_case("utc") || timezone.eq_ignore_ascii_case("gmt") {
        return Ok(());
    }
    if timezone.starts_with('+') || timezone.starts_with('-') {
        return timezone
            .parse::<chrono::FixedOffset>()
            .map(|_| ())
            .map_err(|error| error.to_string());
    }
    timezone
        .parse::<chrono_tz::Tz>()
        .map(|_| ())
        .map_err(|_| "unknown IANA timezone".to_string())
}

/// Whether a native action's invoke mode awaits completion (reserved for P05).
pub fn invoke_awaits_completion(mode: InvokeMode) -> bool {
    matches!(mode, InvokeMode::AwaitCompletion)
}

/// Whether a state-change trigger uses level semantics.
pub fn state_change_is_level(mode: StateChangeMode) -> bool {
    matches!(mode, StateChangeMode::Level)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::device::DeviceId;
    use crate::types::integration::IntegrationId;
    use serde_json::json;

    fn key(integration: &str, device: &str) -> DeviceKey {
        DeviceKey::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(device),
        )
    }

    fn device_ref(integration: &str, device: &str) -> DeviceRef {
        DeviceRef::new_with_id(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(device),
        )
    }

    fn catalog() -> ConfigCatalog {
        ConfigCatalog::default()
            .with_device(key("dummy", "sensor1"))
            .with_device(key("dummy", "lamp1"))
            .with_scene(SceneId::from("main_on".to_string()))
            .with_routine(RoutineId::from("other".to_string()))
    }

    #[test]
    fn rollout_validation_bounds_duration_and_resolves_sources() {
        let valid = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "activate_scene",
                "id": "step",
                "scene_id": "main_on",
                "rollout": {
                    "style": "spatial",
                    "source": { "kind": "triggering_device" },
                    "duration_ms": 1500
                }
            }]}
        });
        assert!(compile_definition_value(&valid, &catalog()).is_ok());

        let fixed_source = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "activate_scene",
                "id": "step",
                "scene_id": "main_on",
                "rollout": {
                    "style": "spatial",
                    "source": { "kind": "device", "device": { "integration_id": "dummy", "device_id": "sensor1" } }
                }
            }]}
        });
        assert!(compile_definition_value(&fixed_source, &catalog()).is_ok());

        let unknown_source = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "activate_scene",
                "id": "step",
                "scene_id": "main_on",
                "rollout": {
                    "style": "spatial",
                    "source": { "kind": "device", "device": { "integration_id": "dummy", "device_id": "ghost" } }
                }
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&unknown_source, &catalog()).unwrap_err()),
            vec!["unknown_device"]
        );

        let beyond_bound = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "activate_scene",
                "id": "step",
                "scene_id": "main_on",
                "rollout": { "style": "spatial", "duration_ms": MAX_ROLLOUT_DURATION_MS + 1 }
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&beyond_bound, &catalog()).unwrap_err()),
            vec!["invalid_duration"]
        );

        let zero_transition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "activate_scene",
                "id": "step",
                "scene_id": "main_on",
                "transition_ms": 0
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&zero_transition, &catalog()).unwrap_err()),
            vec!["invalid_duration"]
        );
    }

    #[test]
    fn cycle_scenes_validation_requires_scenes_and_resolves_references() {
        let valid = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "cycle_scenes",
                "id": "step",
                "scenes": [
                    { "scene_id": "main_on", "targets": { "devices": [{ "integration_id": "dummy", "device_id": "lamp1" }] } }
                ],
                "detection": { "devices": [{ "integration_id": "dummy", "device_id": "sensor1" }] }
            }]}
        });
        assert!(compile_definition_value(&valid, &catalog()).is_ok());

        let empty = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "cycle_scenes",
                "id": "step",
                "scenes": []
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&empty, &catalog()).unwrap_err()),
            vec!["empty_cycle_scenes"]
        );

        let unknown_scene = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "cycle_scenes",
                "id": "step",
                "scenes": [{ "scene_id": "missing" }]
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&unknown_scene, &catalog()).unwrap_err()),
            vec!["unknown_scene"]
        );

        let unknown_detection = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "cycle_scenes",
                "id": "step",
                "scenes": [{ "scene_id": "main_on" }],
                "detection": { "devices": [{ "integration_id": "dummy", "device_id": "ghost" }] }
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&unknown_detection, &catalog()).unwrap_err()),
            vec!["unknown_device"]
        );
    }

    #[test]
    fn randomize_color_validation_requires_targets_and_positive_transition() {
        let valid = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "randomize_color",
                "id": "step",
                "targets": { "devices": [{ "integration_id": "dummy", "device_id": "lamp1" }] },
                "min_saturation": 0.2,
                "max_saturation": 1.0,
                "transition_ms": 250
            }]}
        });
        assert!(compile_definition_value(&valid, &catalog()).is_ok());

        let no_targets = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "randomize_color",
                "id": "step"
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&no_targets, &catalog()).unwrap_err()),
            vec!["missing_targets"]
        );

        let zero_transition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [{
                "action": "randomize_color",
                "id": "step",
                "targets": { "devices": [{ "integration_id": "dummy", "device_id": "lamp1" }] },
                "transition_ms": 0
            }]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&zero_transition, &catalog()).unwrap_err()),
            vec!["invalid_duration"]
        );
    }

    fn valid_definition() -> Value {
        json!({
            "triggers": [
                {
                    "kind": "report",
                    "id": "trig_report",
                    "device": { "integration_id": "dummy", "device_id": "sensor1" }
                }
            ],
            "program": {
                "kind": "native",
                "steps": [
                    {
                        "action": "activate_scene",
                        "id": "step_scene",
                        "scene_id": "main_on"
                    }
                ]
            }
        })
    }

    fn v2_row(definition: Value) -> RoutineRow {
        RoutineRow {
            id: "routine".to_string(),
            name: "Routine".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(definition),
            rules: json!([]),
            actions: json!([]),
        }
    }

    fn compile_ok(definition: Value, catalog: &ConfigCatalog) -> CompiledDefinition {
        let row = v2_row(definition);
        match compile_row(&row, catalog).expect("definition should compile") {
            CompiledRoutine::V2(compiled) => *compiled,
            CompiledRoutine::V1(_) => panic!("v2 row compiled as v1"),
        }
    }

    fn error_codes(report: &RoutineValidationReport) -> Vec<String> {
        report
            .errors
            .iter()
            .map(|error| error.code.clone())
            .collect()
    }

    // V01: malformed/ambiguous/unknown-version JSON returns a path-specific
    // error; no empty fallback definition is enabled.
    #[test]
    fn v01_unknown_semantics_version_is_rejected_and_never_interpreted_as_v1() {
        let mut row = v2_row(valid_definition());
        row.semantics_version = 3;
        let report = compile_row(&row, &catalog()).unwrap_err();
        assert_eq!(report.errors[0].code, "unsupported_semantics_version");
        assert_eq!(report.errors[0].path, "/semantics_version");

        // A legacy row still compiles through the v1 validator.
        let mut legacy = RoutineRow {
            id: "legacy".to_string(),
            name: "Legacy".to_string(),
            enabled: true,
            rules: json!([{
                "state": { "value": true },
                "integration_id": "dummy",
                "device_id": "sensor1"
            }]),
            actions: json!([]),
            ..Default::default()
        };
        legacy.semantics_version = 1;
        assert!(matches!(
            compile_row(&legacy, &catalog()).unwrap(),
            CompiledRoutine::V1(_)
        ));
    }

    #[test]
    fn v01_malformed_definition_reports_a_path_without_fallback() {
        let report =
            compile_definition_value(&json!({ "triggers": "nope" }), &catalog()).unwrap_err();
        assert_eq!(report.errors[0].code, "invalid_definition");
        assert_eq!(report.errors[0].path, "/triggers");

        let report = compile_definition_value(
            &json!({
                "triggers": [{ "kind": "not_a_trigger", "id": "x" }],
                "program": { "kind": "native", "steps": [] }
            }),
            &catalog(),
        )
        .unwrap_err();
        assert_eq!(report.errors[0].code, "invalid_definition");
        assert!(report.errors[0].path.starts_with("/triggers/0"));

        // A v2 row without a body is not silently treated as v1.
        let mut row = v2_row(valid_definition());
        row.definition_v2 = None;
        let report = compile_row(&row, &catalog()).unwrap_err();
        assert_eq!(report.errors[0].code, "missing_definition");
        assert_eq!(report.errors[0].path, "/definition_v2");
    }

    // V02: invalid script syntax fails at save/enable; validation must not
    // execute arbitrary top-level effects.
    #[test]
    fn v02_invalid_script_syntax_fails_validation() {
        let definition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": {
                "kind": "script",
                "spec": {
                    "api_version": 1,
                    "source_body": "if (",
                    "declarations": []
                }
            }
        });
        let report = compile_definition_value(&definition, &catalog()).unwrap_err();
        assert_eq!(error_codes(&report), vec!["invalid_script_syntax"]);
        assert_eq!(report.errors[0].path, "/program/spec/source_body");
    }

    #[test]
    fn v02_script_validation_parses_without_executing_top_level_effects() {
        // This body would mutate global state if executed. Compilation only
        // parses it, so it must succeed and produce no side effects.
        let definition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": {
                "kind": "script",
                "spec": {
                    "api_version": 1,
                    "source_body": "globalThis.__homectl_executed = true; return null;",
                    "declarations": [
                        { "kind": "device", "device": { "integration_id": "dummy", "device_id": "sensor1" } }
                    ]
                }
            }
        });
        let compiled = compile_ok(definition, &catalog());
        assert_eq!(compiled.dependencies.len(), 1);
    }

    // S13: script declarations may reference entities that are not discovered
    // yet. The declaration is tracked as a dependency instead of rejecting the
    // routine, so later discovery can wake the script.
    #[test]
    fn missing_script_declaration_entities_are_tracked_for_discovery() {
        let definition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": {
                "kind": "script",
                "spec": {
                    "api_version": 1,
                    "source_body": "return { actions: [] };",
                    "declarations": [
                        { "kind": "device", "device": { "integration_id": "dummy", "device_id": "future_lamp" } },
                        { "kind": "group", "group_id": "future_group" }
                    ]
                }
            }
        });
        let compiled = compile_ok(definition, &catalog());
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Device(key("dummy", "future_lamp"))));
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Group(GroupId(
                "future_group".to_string()
            ))));
    }

    // S14: the AllState declaration is an explicitly broad compatibility
    // subscription with no exact entity to resolve.
    #[test]
    fn all_state_declaration_compiles_as_broad_compatibility_mode() {
        let definition = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": {
                "kind": "script",
                "spec": {
                    "api_version": 1,
                    "source_body": "return { actions: [] };",
                    "declarations": [{ "kind": "all_state" }]
                }
            }
        });
        let compiled = compile_ok(definition, &catalog());
        assert!(
            compiled.dependencies.is_empty(),
            "broad reads do not name concrete dependencies"
        );
    }

    // Forward references are tolerated in script declarations only; typed
    // trigger references still reject unknown devices.
    #[test]
    fn unknown_trigger_device_is_still_rejected() {
        let definition = json!({
            "triggers": [{
                "kind": "state_change",
                "id": "trig",
                "device": { "integration_id": "dummy", "device_id": "future_lamp" }
            }],
            "program": {
                "kind": "native",
                "steps": [{ "action": "cancel_timer", "id": "step", "timer": "t" }]
            }
        });
        assert_eq!(
            error_codes(&compile_definition_value(&definition, &catalog()).unwrap_err()),
            vec!["unknown_device"]
        );
    }

    // V03: nonfinite/range/type/duration/capability errors are rejected.
    #[test]
    fn v03_range_duration_and_capability_errors_are_rejected() {
        let dim_zero = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": {
                "kind": "native",
                "steps": [{
                    "action": "dim",
                    "id": "step_dim",
                    "targets": { "devices": [{ "integration_id": "dummy", "device_id": "lamp1" }] },
                    "step": 0.0
                }]
            }
        });
        assert_eq!(
            error_codes(&compile_definition_value(&dim_zero, &catalog()).unwrap_err()),
            vec!["invalid_dim_step"]
        );

        let bad_duration = json!({
            "triggers": [{
                "kind": "predicate_for",
                "id": "trig_for",
                "predicate": { "kind": "literal", "value": true },
                "duration_ms": 0
            }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&bad_duration, &catalog()).unwrap_err()),
            vec!["invalid_duration"]
        );

        // J04: zero delay is a queued event, not inline recursion; only
        // delays above the bound are invalid.
        let zero_delay = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "schedule_timer", "id": "step_timer", "timer": "t1",
                  "delay_ms": 0 }
            ]}
        });
        assert!(compile_definition_value(&zero_delay, &catalog()).is_ok());
        let beyond_bound = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "schedule_timer", "id": "step_timer", "timer": "t1",
                  "delay_ms": MAX_TIMER_DELAY_MS + 1 }
            ]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&beyond_bound, &catalog()).unwrap_err()),
            vec!["invalid_duration"]
        );

        // J08/J09: group captures compile because membership is frozen at
        // plan time; an empty capture spec is rejected.
        let group_capture = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "schedule_timer", "id": "step_timer", "timer": "t1",
                  "delay_ms": 1000,
                  "capture_target_intents": { "groups": ["g1"] } }
            ]}
        });
        let group_catalog = catalog().with_group(GroupId("g1".to_string()));
        assert!(compile_definition_value(&group_capture, &group_catalog).is_ok());

        let empty_capture = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "schedule_timer", "id": "step_timer", "timer": "t1",
                  "delay_ms": 1000,
                  "capture_target_intents": {} }
            ]}
        });
        assert_eq!(
            error_codes(&compile_definition_value(&empty_capture, &catalog()).unwrap_err()),
            vec!["invalid_capture_targets"]
        );

        let bad_policy = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]},
            "execution": { "max_actions": 0 }
        });
        assert!(
            error_codes(&compile_definition_value(&bad_policy, &catalog()).unwrap_err())
                .contains(&"invalid_execution_policy".to_string())
        );

        let ambiguous_schedule = json!({
            "triggers": [{
                "kind": "schedule",
                "id": "trig_schedule",
                "schedule": { "cron": "0 8 * * *", "every_ms": 1000 }
            }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        assert!(error_codes(
            &compile_definition_value(&ambiguous_schedule, &catalog()).unwrap_err()
        )
        .contains(&"ambiguous_schedule".to_string()));

        let unknown_device = json!({
            "triggers": [{
                "kind": "report",
                "id": "trig",
                "device": { "integration_id": "dummy", "device_id": "missing" }
            }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        let report = compile_definition_value(&unknown_device, &catalog()).unwrap_err();
        assert_eq!(report.errors[0].code, "unknown_device");
        assert_eq!(
            report.errors[0].related_entity.as_deref(),
            Some("dummy/missing")
        );
    }

    // K01/K02: the six-field grammar and calendar policy are validated at
    // compile time so stored definitions and fingerprints are stable.
    #[test]
    fn k01_calendar_grammar_and_policy_are_validated() {
        let definition = |schedule: serde_json::Value| {
            json!({
                "triggers": [{ "kind": "schedule", "id": "trig", "schedule": schedule }],
                "program": { "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
                ]}
            })
        };

        assert!(compile_definition_value(
            &definition(json!({
                "cron": "0 0 8 * * *",
                "timezone": "Europe/Helsinki"
            })),
            &catalog()
        )
        .is_ok());

        // Seconds may not be omitted: five fields are rejected explicitly.
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({ "cron": "0 8 * * *", "timezone": "Europe/Helsinki" })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["invalid_cron"]
        );

        // Timezones resolve to IANA zones (or fixed offsets).
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({ "cron": "0 0 8 * * *", "timezone": "Mars/Olympus" })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["invalid_timezone"]
        );

        // Catch-up policy requires cron plus a bounded lateness; the lateness
        // alone or on interval schedules is not applicable.
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({ "cron": "0 0 8 * * *", "backlog": "catch_up_once" })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["schedule_policy_not_applicable"]
        );
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({ "cron": "0 0 8 * * *", "catch_up_lateness_ms": 60000 })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["schedule_policy_not_applicable"]
        );
        assert!(compile_definition_value(
            &definition(json!({
                "cron": "0 0 8 * * *",
                "backlog": "catch_up_once",
                "catch_up_lateness_ms": 60000
            })),
            &catalog()
        )
        .is_ok());
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({
                        "every_ms": 1000,
                        "backlog": "catch_up_once",
                        "catch_up_lateness_ms": 60000
                    })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["schedule_policy_not_applicable"]
        );
        assert_eq!(
            error_codes(
                &compile_definition_value(
                    &definition(json!({
                        "cron": "0 0 8 * * *",
                        "backlog": "catch_up_once",
                        "catch_up_lateness_ms": 999_999_999_999u64
                    })),
                    &catalog()
                )
                .unwrap_err()
            ),
            vec!["invalid_duration"]
        );
    }

    #[test]
    fn v03_empty_stored_all_condition_is_rejected_and_omitted_condition_defaults_true() {
        let empty_all = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "condition": { "kind": "all", "conditions": [] },
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        assert!(
            error_codes(&compile_definition_value(&empty_all, &catalog()).unwrap_err())
                .contains(&"empty_condition".to_string())
        );

        let compiled = compile_ok(
            json!({
                "triggers": [{ "kind": "manual", "id": "trig" }],
                "program": { "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
                ]}
            }),
            &catalog(),
        );
        assert_eq!(
            compiled.normalized.condition,
            ConditionExpr::Literal { value: true }
        );
    }

    // V04: disabled invalid definitions remain visible and inventoried.
    #[test]
    fn v04_invalid_disabled_draft_remains_in_the_reference_inventory() {
        let mut row = v2_row(json!({ "triggers": "not a list" }));
        row.enabled = false;
        let inventory = reference_inventory(&[row], &catalog());
        let entry = inventory.entries.get("routine").expect("entry present");
        assert!(!entry.enabled());
        match entry {
            ReferenceInventoryEntry::V2 { result, .. } => {
                assert!(
                    result.is_err(),
                    "disabled invalid draft still reports errors"
                );
            }
            other => panic!("unexpected inventory entry: {other:?}"),
        }

        let mut unknown = v2_row(valid_definition());
        unknown.enabled = false;
        unknown.semantics_version = 7;
        let inventory = reference_inventory(&[unknown], &catalog());
        assert!(matches!(
            inventory.entries.get("routine"),
            Some(ReferenceInventoryEntry::UnsupportedVersion { version: 7, .. })
        ));
    }

    // V06: group/scene/source cycles are rejected with a useful path.
    #[test]
    fn v06_group_cycle_is_rejected_with_a_useful_path() {
        let cycling = ConfigCatalog::default()
            .with_group(GroupId("a".to_string()))
            .with_group(GroupId("b".to_string()))
            .with_group_link(GroupId("a".to_string()), GroupId("b".to_string()))
            .with_group_link(GroupId("b".to_string()), GroupId("a".to_string()));
        let definition = json!({
            "triggers": [{
                "kind": "predicate_transition",
                "id": "trig_group",
                "predicate": {
                    "kind": "group",
                    "group_id": "a",
                    "quantifier": "all",
                    "power": true
                }
            }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        let report = compile_definition_value(&definition, &cycling).unwrap_err();
        let cycle = report
            .errors
            .iter()
            .find(|error| error.code == "group_cycle")
            .expect("group cycle rejected");
        assert_eq!(cycle.path, "/triggers/0/predicate/group_id");
        assert!(cycle.message.contains("a -> b -> a"));
    }

    #[test]
    fn v06_routine_self_invocation_is_rejected() {
        let row = v2_row(json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "invoke_routine", "id": "step_invoke", "routine_id": "routine" }
            ]}
        }));
        let report = compile_row(&row, &catalog()).unwrap_err();
        let cycle = report
            .errors
            .iter()
            .find(|error| error.code == "routine_cycle")
            .expect("self invocation rejected");
        assert_eq!(cycle.path, "/program/steps/0");
        assert_eq!(cycle.node_id.as_deref(), Some("step_invoke"));
    }

    // V07: compiler output is identical across save/load/import/simulation
    // entry points (row -> JSON -> row round trips, typed vs raw compile).
    #[test]
    fn v07_compiler_output_is_identical_across_entry_points() {
        let definition = valid_definition();
        let row = v2_row(definition.clone());

        let direct = compile_ok(definition.clone(), &catalog());

        let exported = serde_json::to_value(&row).expect("row serializes");
        let reimported: RoutineRow =
            serde_json::from_value(exported.clone()).expect("row deserializes");
        let through_export = match compile_row(&reimported, &catalog()).unwrap() {
            CompiledRoutine::V2(compiled) => *compiled,
            CompiledRoutine::V1(_) => panic!("round-tripped v2 row compiled as v1"),
        };

        let typed = parse_definition(&definition).expect("typed parse");
        let via_typed = compile_definition(&typed, &catalog()).unwrap();

        assert_eq!(direct.fingerprint, through_export.fingerprint);
        assert_eq!(direct.fingerprint, via_typed.fingerprint);
        assert_eq!(direct.node_ids, through_export.node_ids);
        assert_eq!(direct.normalized, through_export.normalized);

        // Exported definitions survive the round trip byte-for-byte as raw data.
        assert_eq!(
            reimported.definition_v2.as_ref(),
            Some(&definition),
            "raw v2 body preserved through export/import"
        );
    }

    // V08: a legacy editor/API write to a v2 row cannot drop the v2 body.
    #[test]
    fn v08_legacy_write_preserves_v2_definition_and_rejects_version_changes() {
        let existing = v2_row(valid_definition());
        let legacy = RoutineRow {
            id: "routine".to_string(),
            name: "Renamed".to_string(),
            enabled: true,
            rules: json!([]),
            actions: json!([]),
            ..Default::default()
        };

        let merged = prepare_write(Some(&existing), legacy).expect("legacy write merges");
        assert_eq!(merged.semantics_version, 2);
        assert_eq!(merged.definition_v2, existing.definition_v2);
        assert_eq!(merged.revision, 1, "revision stays server-managed");

        // A v1 body attached to a v2 definition is ambiguous and rejected.
        let conflicting = RoutineRow {
            id: "routine".to_string(),
            name: "Routine".to_string(),
            enabled: true,
            definition_v2: Some(valid_definition()),
            rules: json!([]),
            actions: json!([]),
            ..Default::default()
        };
        assert!(prepare_write(None, conflicting).is_err());

        // Unknown versions cannot be written at all.
        let mut unknown = v2_row(valid_definition());
        unknown.semantics_version = 9;
        assert!(prepare_write(None, unknown).is_err());
    }

    #[test]
    fn compiled_metadata_lists_subscriptions_dependencies_and_write_capabilities() {
        let definition = json!({
            "triggers": [
                {
                    "kind": "report",
                    "id": "trig_report",
                    "device": { "integration_id": "dummy", "device_id": "sensor1" }
                },
                { "kind": "manual", "id": "trig_manual" }
            ],
            "program": {
                "kind": "native",
                "steps": [
                    {
                        "action": "activate_scene",
                        "id": "step_scene",
                        "scene_id": "main_on",
                        "targets": {
                            "devices": [{ "integration_id": "dummy", "device_id": "lamp1" }]
                        }
                    },
                    { "action": "invoke_routine", "id": "step_invoke", "routine_id": "other" }
                ]
            }
        });
        let compiled = compile_ok(definition, &catalog());

        assert_eq!(compiled.node_ids.len(), 4);
        assert_eq!(compiled.subscriptions.len(), 2);
        assert_eq!(
            compiled.subscriptions[0].kind,
            SubscriptionKind::DeviceReport
        );
        assert_eq!(
            compiled.subscriptions[0].devices,
            vec![key("dummy", "sensor1")]
        );
        assert_eq!(compiled.subscriptions[1].kind, SubscriptionKind::Manual);

        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Device(key("dummy", "sensor1"))));
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Device(key("dummy", "lamp1"))));
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Scene(SceneId::from(
                "main_on".to_string()
            ))));
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Routine(RoutineId::from(
                "other".to_string()
            ))));

        assert!(compiled.write_capabilities.contains(&WriteCapability {
            kind: WriteKind::Scene,
            target: "main_on".to_string(),
        }));
        assert!(compiled.write_capabilities.contains(&WriteCapability {
            kind: WriteKind::Device,
            target: "dummy/lamp1".to_string(),
        }));
    }

    #[test]
    fn referenced_devices_collects_trigger_and_action_references() {
        let definition = parse_definition(&json!({
            "triggers": [
                {
                    "kind": "report",
                    "id": "trig",
                    "device": { "integration_id": "dummy", "device_id": "sensor1" }
                }
            ],
            "condition": {
                "kind": "comparison",
                "source": {
                    "kind": "device",
                    "device": { "integration_id": "dummy", "device_id": "lamp1" },
                    "path": "/power"
                },
                "operator": "eq",
                "value": true
            },
            "program": { "kind": "native", "steps": [
                {
                    "action": "set_power",
                    "id": "step_power",
                    "device": { "integration_id": "dummy", "device_id": "lamp1" },
                    "power": true
                }
            ]}
        }))
        .expect("parses");
        let devices = referenced_devices(&definition);
        assert_eq!(
            devices,
            vec![device_ref("dummy", "sensor1"), device_ref("dummy", "lamp1")]
        );
    }

    // P11: the catalog resolves DB-backed computed sources, and references
    // validate both source existence and the JSON pointer.
    #[test]
    fn p11_computed_source_references_resolve_and_validate() {
        let export: ConfigExport = serde_json::from_value(json!({
            "version": 1,
            "core": { "warmup_time_seconds": 0 },
            "integrations": [],
            "groups": [],
            "scenes": [],
            "routines": [],
            "sources": [{
                "id": "circadian",
                "name": "Circadian",
                "enabled": true,
                "timezone": "Europe/Helsinki",
                "compute": {
                    "kind": "circadian_compat",
                    "preset_version": 1,
                    "params": {
                        "day_fade_start": "06:00",
                        "day_fade_duration_hours": 2,
                        "day_color": { "ct": 3000 },
                        "night_fade_start": "20:00",
                        "night_fade_duration_hours": 2,
                        "night_color": { "ct": 2000 }
                    }
                }
            }],
            "floorplan": null,
            "dashboard_layouts": [],
            "dashboard_widgets": []
        }))
        .expect("export parses");
        let catalog = ConfigCatalog::new(
            vec![key("dummy", "sensor1"), key("dummy", "lamp1")],
            &export,
        );
        assert!(catalog.sources.contains(&SourceId("circadian".to_string())));

        let definition = |source: &str, path: Option<&str>| {
            let mut value_source = json!({
                "kind": "computed_source",
                "source": source,
            });
            if let Some(path) = path {
                value_source["path"] = json!(path);
            }
            json!({
                "triggers": [{
                    "kind": "report",
                    "id": "trig_report",
                    "device": { "integration_id": "dummy", "device_id": "sensor1" }
                }],
                "condition": {
                    "kind": "comparison",
                    "source": value_source,
                    "operator": "gt",
                    "value": 0.5
                },
                "program": { "kind": "native", "steps": [{
                    "action": "set_power",
                    "id": "step_power",
                    "device": { "integration_id": "dummy", "device_id": "lamp1" },
                    "power": true
                }]}
            })
        };

        let compiled = compile_ok(definition("circadian", Some("/brightness")), &catalog);
        assert!(compiled
            .dependencies
            .contains(&ResolvedReference::Source(SourceId(
                "circadian".to_string()
            ))));

        // The pointer defaults to the whole value when omitted.
        let defaulted = compile_ok(definition("circadian", None), &catalog);
        let ConditionExpr::Comparison { source, .. } = &defaulted.normalized.condition else {
            panic!("expected a comparison condition");
        };
        assert!(matches!(
            source,
            ValueSource::ComputedSource { path, .. } if path == "/"
        ));

        let report = compile_row(
            &v2_row(definition("missing", Some("/brightness"))),
            &catalog,
        )
        .unwrap_err();
        assert!(error_codes(&report).contains(&"unknown_source".to_string()));

        let report = compile_row(
            &v2_row(definition("circadian", Some("brightness"))),
            &catalog,
        )
        .unwrap_err();
        assert!(error_codes(&report).contains(&"invalid_json_pointer".to_string()));
    }
}
