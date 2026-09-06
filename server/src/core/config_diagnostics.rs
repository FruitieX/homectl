//! Read-only configuration checks. Never evaluates scripts or dispatches events.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    core::{scenes::normalize_scene_config_value, snapshot::RuntimeSnapshot},
    types::{
        config_diagnostics::{
            ConfigDiagnostic, ConfigDiagnostics, DiagnosticEntity, DiagnosticSeverity,
        },
        device::{DeviceData, DeviceKey, DeviceRef},
        scene::{ActivateSceneDescriptor, SceneDeviceConfig, SceneDeviceLink, SceneId},
    },
};

struct Inspector<'a> {
    snapshot: &'a RuntimeSnapshot,
    issues: Vec<ConfigDiagnostic>,
}

impl Inspector<'_> {
    #[allow(clippy::too_many_arguments)]
    fn issue(
        &mut self,
        entity: DiagnosticEntity,
        id: &str,
        name: &str,
        code: &str,
        target: &str,
        severity: DiagnosticSeverity,
        message: String,
        suggestion: &str,
    ) {
        self.issues.push(ConfigDiagnostic {
            id: serde_json::to_string(&(entity, id, code, target)).expect("strings serialize"),
            entity,
            entity_id: id.into(),
            name: name.into(),
            code: code.into(),
            severity,
            message,
            suggestion: suggestion.into(),
        });
    }

    fn scene_value(&mut self, scene_id: &str, name: &str, target: &str, value: &serde_json::Value) {
        use DiagnosticEntity::Scene;
        use DiagnosticSeverity::Warning;
        let value = normalize_scene_config_value(value.clone());
        // Untagged deserialization can otherwise accept a malformed link as an
        // empty DeviceState, silently hiding the broken reference.
        let parsed = if value.get("scene_id").is_some() {
            serde_json::from_value::<ActivateSceneDescriptor>(value)
                .map(SceneDeviceConfig::SceneLink)
        } else if value.get("integration_id").is_some() {
            serde_json::from_value::<SceneDeviceLink>(value).map(SceneDeviceConfig::DeviceLink)
        } else {
            serde_json::from_value::<SceneDeviceConfig>(value)
        };
        match parsed {
            Ok(SceneDeviceConfig::SceneLink(link)) => {
                if !self
                    .snapshot
                    .runtime_config
                    .scenes
                    .iter()
                    .any(|s| s.id == link.scene_id.to_string())
                {
                    self.issue(
                        Scene,
                        scene_id,
                        name,
                        "missing_scene_link",
                        target,
                        Warning,
                        format!("Target {target} links to missing scene {}.", link.scene_id),
                        "Choose an existing scene or remove this link.",
                    );
                }
            }
            Ok(SceneDeviceConfig::DeviceLink(link)) => {
                let DeviceRef::Id(reference) = link.device_ref;
                let key = reference.into_device_key();
                if !self.snapshot.devices.0.contains_key(&key) && !self.snapshot.warming_up {
                    self.issue(
                        Scene,
                        scene_id,
                        name,
                        "missing_device_link",
                        target,
                        Warning,
                        format!("Target {target} reads from unavailable device {key}."),
                        "Check the source integration or choose another source device.",
                    );
                }
            }
            Ok(_) => {}
            Err(_) => self.issue(
                Scene,
                scene_id,
                name,
                "invalid_scene_state",
                target,
                Warning,
                format!("Target {target} has an invalid state definition."),
                "Review the target state in the scene editor.",
            ),
        }
    }
}

/// Finds cycle members without recursive traversal or enumerating every possible path.
fn cycle_members(graph: &BTreeMap<String, Vec<String>>) -> BTreeSet<String> {
    graph
        .keys()
        .filter(|root| {
            let mut pending = graph.get(*root).cloned().unwrap_or_default();
            let mut visited = BTreeSet::new();
            while let Some(node) = pending.pop() {
                if &node == *root {
                    return true;
                }
                if visited.insert(node.clone()) {
                    pending.extend(graph.get(&node).into_iter().flatten().cloned());
                }
            }
            false
        })
        .cloned()
        .collect()
}

pub fn inspect_config(snapshot: &RuntimeSnapshot) -> ConfigDiagnostics {
    use DiagnosticEntity::{Device, Group, Scene};
    use DiagnosticSeverity::{Info, Warning};
    let mut check = Inspector {
        snapshot,
        issues: vec![],
    };
    let config = &snapshot.runtime_config;
    let graph = config
        .groups
        .iter()
        .map(|group| (group.id.clone(), group.linked_groups.clone()))
        .collect::<BTreeMap<_, _>>();
    let cycles = cycle_members(&graph);
    for group in &config.groups {
        if cycles.contains(&group.id) {
            check.issue(
                Group,
                &group.id,
                &group.name,
                "group_cycle",
                "",
                Warning,
                "Nested group links lead back to this group.".into(),
                "Remove a link in the loop so groups do not contain themselves.",
            );
        }
        for linked in &group.linked_groups {
            if !graph.contains_key(linked) {
                check.issue(
                    Group,
                    &group.id,
                    &group.name,
                    "missing_group_link",
                    linked,
                    Warning,
                    format!("Nested group {linked} does not exist."),
                    "Choose an existing group or remove this link.",
                );
            }
        }
        if !snapshot.warming_up {
            for target in &group.devices {
                let key = format!("{}/{}", target.integration_id, target.device_id);
                let found =
                    serde_json::from_value::<DeviceKey>(serde_json::Value::String(key.clone()))
                        .ok()
                        .is_some_and(|key| snapshot.devices.0.contains_key(&key));
                if !found {
                    check.issue(Group, &group.id, &group.name, "missing_group_device", &key, Warning,
                        format!("Device {key} is not available in the current runtime."), "Check its integration, replace the device reference, or remove it from this group.");
                }
            }
        }
        if group.devices.is_empty() && group.linked_groups.is_empty() {
            check.issue(Group, &group.id, &group.name, "empty_group", "", Info,
                "This group has no devices or nested groups.".into(), "Add members if it should control devices. An intentionally empty group can be left as it is.");
        }
    }
    for scene in &config.scenes {
        for (target, value) in &scene.device_states {
            check.scene_value(&scene.id, &scene.name, target, value);
            let device =
                serde_json::from_value::<DeviceKey>(serde_json::Value::String(target.clone()))
                    .ok()
                    .and_then(|key| snapshot.devices.0.get(&key));
            match device {
                None if !snapshot.warming_up => check.issue(Scene, &scene.id, &scene.name, "missing_scene_device", target, Warning,
                    format!("Target device {target} is not available."), "Check its integration or update the scene target."),
                Some(device) if device.is_readonly() => check.issue(Scene, &scene.id, &scene.name, "readonly_scene_target", target, Info,
                    format!("Target {} is read-only; this scene cannot send changes to it.", device.name), "Remove it from the scene if unintended. Keep read-only policy unless this device should be controlled by homectl."),
                _ => {},
            }
        }
        for (target, value) in &scene.group_states {
            check.scene_value(&scene.id, &scene.name, target, value);
            if !graph.contains_key(target) {
                check.issue(
                    Scene,
                    &scene.id,
                    &scene.name,
                    "missing_scene_group",
                    target,
                    Warning,
                    format!("Target group {target} does not exist."),
                    "Choose an existing group or remove this target.",
                );
            } else if !snapshot.warming_up {
                let group = snapshot
                    .flattened_groups
                    .0
                    .iter()
                    .find(|(id, _)| id.0 == *target)
                    .map(|(_, group)| group);
                if let Some(group) = group {
                    if group.device_keys.is_empty() {
                        check.issue(
                            Scene,
                            &scene.id,
                            &scene.name,
                            "empty_scene_group",
                            target,
                            Info,
                            format!("Target group {} currently contains no devices.", group.name),
                            "Review the group's members if this scene should affect it.",
                        );
                    } else {
                        let readonly = group
                            .device_keys
                            .iter()
                            .filter_map(|key| snapshot.devices.0.get(key))
                            .filter(|device| device.is_readonly())
                            .count();
                        if readonly > 0 {
                            check.issue(Scene, &scene.id, &scene.name, "readonly_scene_group", target, Info,
                                format!("Target group {} includes {readonly} read-only devices.", group.name), "Review the group membership if those devices should not be scene targets.");
                        }
                    }
                }
            }
        }
    }
    if !snapshot.warming_up {
        for (key, device) in &snapshot.devices.0 {
            let DeviceData::Controllable(data) = &device.data else {
                continue;
            };
            let Some(scene_id) = &data.scene_id else {
                continue;
            };
            let exists = config
                .scenes
                .iter()
                .any(|scene| SceneId::new(scene.id.clone()) == *scene_id);
            let resolves = snapshot
                .flattened_scenes
                .0
                .get(scene_id)
                .is_some_and(|scene| scene.devices.0.contains_key(key));
            if !exists || !resolves {
                check.issue(Device, &key.to_string(), &device.name, "unresolved_active_scene", &scene_id.to_string(), Warning,
                    if exists { format!("Assigned scene {scene_id} has no resolved state for this device.") } else { format!("Assigned scene {scene_id} no longer exists.") },
                    "Review the device's assigned scene and its targets. No device state has been changed by this check.");
            }
        }
    }
    check.issues.sort_by(|a, b| {
        (a.severity, a.entity, &a.name, &a.id).cmp(&(b.severity, b.entity, &b.name, &b.id))
    });
    check.issues.dedup_by(|a, b| a.id == b.id);
    ConfigDiagnostics {
        warming_up: snapshot.warming_up,
        issues: check.issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        core::event::tests::test_state,
        db::config_queries::{GroupDeviceRow, GroupRow, SceneRow},
        types::{
            color::Capabilities,
            device::{ControllableDevice, Device, DeviceId, ManageKind},
            integration::IntegrationId,
        },
    };
    use serde_json::json;
    use std::sync::Arc;

    fn snapshot() -> RuntimeSnapshot {
        let (state, _rx) = test_state();
        (*state.snapshot.load_full()).clone()
    }
    fn group(id: &str, links: &[&str]) -> GroupRow {
        GroupRow {
            id: id.into(),
            name: id.into(),
            hidden: false,
            devices: vec![],
            linked_groups: links.iter().map(|id| (*id).into()).collect(),
        }
    }
    fn codes(snapshot: &RuntimeSnapshot) -> Vec<String> {
        inspect_config(snapshot)
            .issues
            .into_iter()
            .map(|issue| issue.code)
            .collect()
    }

    #[test]
    fn cycles_include_only_members_not_parents_and_traversal_terminates() {
        let graph = BTreeMap::from([
            ("a".into(), vec!["b".into()]),
            ("b".into(), vec!["a".into()]),
            ("parent".into(), vec!["a".into()]),
            ("self".into(), vec!["self".into()]),
        ]);
        assert_eq!(
            cycle_members(&graph),
            BTreeSet::from(["a".into(), "b".into(), "self".into()])
        );
    }

    #[test]
    fn empty_groups_are_informational_and_missing_links_are_warnings() {
        let mut snapshot = snapshot();
        Arc::make_mut(&mut snapshot.runtime_config).groups =
            vec![group("empty", &[]), group("broken", &["gone"])];
        let report = inspect_config(&snapshot);
        assert_eq!(report.issues.len(), 2);
        assert_eq!(report.issues[0].code, "missing_group_link");
        assert_eq!(report.issues[0].severity, DiagnosticSeverity::Warning);
        assert_eq!(report.issues[1].code, "empty_group");
        assert_eq!(report.issues[1].severity, DiagnosticSeverity::Info);
    }

    #[test]
    fn warmup_defers_device_availability_checks_but_not_structural_checks() {
        let mut snapshot = snapshot();
        let mut target = group("room", &["missing"]);
        target.devices.push(GroupDeviceRow {
            integration_id: "dummy".into(),
            device_id: "missing".into(),
        });
        Arc::make_mut(&mut snapshot.runtime_config).groups = vec![target];
        assert!(codes(&snapshot).contains(&"missing_group_device".into()));
        snapshot.warming_up = true;
        assert_eq!(codes(&snapshot), vec!["missing_group_link"]);
    }

    #[test]
    fn stale_scene_assignment_and_readonly_target_are_reported_without_mutation() {
        let mut snapshot = snapshot();
        let device = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("spot"),
            "Outdoor spot".into(),
            DeviceData::Controllable(ControllableDevice::new(
                Some(SceneId::new("normal".into())),
                false,
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::UnmanagedReadOnly,
            )),
            None,
        );
        Arc::make_mut(&mut snapshot.devices)
            .0
            .insert(device.get_device_key(), device);
        Arc::make_mut(&mut snapshot.runtime_config)
            .scenes
            .push(SceneRow {
                id: "normal".into(),
                name: "Normal".into(),
                hidden: false,
                script: Some("throw new Error('must not run')".into()),
                device_states: std::collections::HashMap::from([(
                    "dummy/spot".into(),
                    json!({"power": true}),
                )]),
                group_states: Default::default(),
            });
        let before = serde_json::to_value(&*snapshot.devices).unwrap();
        let codes = codes(&snapshot);
        assert!(codes.contains(&"unresolved_active_scene".into()));
        assert!(codes.contains(&"readonly_scene_target".into()));
        assert_eq!(serde_json::to_value(&*snapshot.devices).unwrap(), before);
    }

    #[test]
    fn malformed_link_does_not_fall_back_to_an_empty_state() {
        let snapshot = snapshot();
        let mut inspector = Inspector {
            snapshot: &snapshot,
            issues: vec![],
        };
        inspector.scene_value("scene", "Scene", "dummy/lamp", &json!({"scene_id": 123}));
        inspector.scene_value(
            "scene",
            "Scene",
            "dummy/other",
            &json!({"integration_id": "dummy"}),
        );
        assert_eq!(inspector.issues.len(), 2);
        assert!(inspector
            .issues
            .iter()
            .all(|issue| issue.code == "invalid_scene_state"));
    }

    #[test]
    fn missing_scene_and_device_sources_are_reported_and_legacy_links_normalize() {
        let mut snapshot = snapshot();
        Arc::make_mut(&mut snapshot.runtime_config)
            .scenes
            .push(SceneRow {
                id: "linked".into(),
                name: "Linked".into(),
                hidden: false,
                script: None,
                device_states: std::collections::HashMap::from([
                    ("dummy/a".into(), json!({"scene_id": "gone"})),
                    (
                        "dummy/b".into(),
                        json!({"integration_id": "dummy", "id": "source"}),
                    ),
                ]),
                group_states: Default::default(),
            });
        let codes = codes(&snapshot);
        assert!(codes.contains(&"missing_scene_link".into()));
        assert!(codes.contains(&"missing_device_link".into()));
        assert!(!codes.contains(&"invalid_scene_state".into()));
        let first = serde_json::to_value(inspect_config(&snapshot)).unwrap();
        let second = serde_json::to_value(inspect_config(&snapshot)).unwrap();
        assert_eq!(first, second, "stable issue order and identifiers");
    }
}
