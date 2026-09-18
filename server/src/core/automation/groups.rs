//! Configured group membership and shared [`GroupEvaluation`] (P04).
//!
//! The denominator is always the configured membership from the group
//! definition, recursively flattened and deduplicated. References that do not
//! resolve to a runtime device are counted as unknown members instead of being
//! removed from the group (G01/G02). Membership changes bump the group
//! definition revision so v2 subscriptions and transition memory can
//! invalidate (G06).

use crate::core::groups::Groups;
use crate::types::automation_definition::Quantifier;
use crate::types::automation_trace::{
    GroupEvaluation, GroupMemberEvaluation, GroupSceneSummary, GroupSceneSummaryKind, TruthValue,
    UnknownReason,
};
use crate::types::device::{Device, DeviceKey, DeviceRef, DevicesState};
use crate::types::group::GroupId;

/// Maximum member details retained in one evaluation result. Counts still
/// cover every configured member (X04 keeps traces bounded).
pub const MAX_GROUP_EVAL_MEMBERS: usize = 256;

/// Evaluate a group condition against configured membership.
///
/// Returns `None` when the group itself is not part of the configuration;
/// callers surface that as `missing_entity`.
pub fn evaluate_group(
    group_id: &GroupId,
    quantifier: Quantifier,
    power: Option<bool>,
    scene: Option<&crate::types::scene::SceneId>,
    devices: &DevicesState,
    groups: &Groups,
) -> Option<GroupEvaluation> {
    let configured = groups.configured_device_refs(group_id)?;

    let mut members = Vec::with_capacity(configured.len().min(MAX_GROUP_EVAL_MEMBERS));
    let mut true_count = 0usize;
    let mut false_count = 0usize;
    let mut unknown_count = 0usize;
    let mut reasons = Vec::new();
    let mut missing_count = 0usize;
    let mut scenes: Vec<Option<crate::types::scene::SceneId>> = Vec::new();

    for device_ref in configured {
        let device_key: DeviceKey = match device_ref {
            DeviceRef::Id(id_ref) => id_ref.clone().into_device_key(),
        };
        let device = devices.0.get(&device_key);

        let member = evaluate_member(&device_key, device, power, scene);
        match member.member_truth {
            TruthValue::True => true_count += 1,
            TruthValue::False => false_count += 1,
            TruthValue::Unknown => {
                unknown_count += 1;
                if let Some(reason) = &member.unknown_reason {
                    if !reasons.contains(reason) {
                        reasons.push(reason.clone());
                    }
                }
            }
        }

        if member.present {
            scenes.push(member.scene_id.clone());
        } else {
            missing_count += 1;
        }

        if members.len() < MAX_GROUP_EVAL_MEMBERS {
            members.push(GroupMemberEvaluation {
                device: member.device,
                device_key: Some(member.device_key),
                present: member.present,
                power: member.power,
                scene_id: member.scene_id,
                unknown_reason: member.unknown_reason,
            });
        }
    }

    let configured_count = configured.len();
    let truth = quantifier_truth(
        quantifier,
        configured_count,
        true_count,
        false_count,
        unknown_count,
    );
    if matches!(truth, TruthValue::Unknown) && configured_count == 0 {
        reasons.push(UnknownReason::EmptySelection {
            group: group_id.to_string(),
        });
    }

    let scene_summary = summarize_scene(scenes, missing_count);

    Some(GroupEvaluation {
        group_id: group_id.clone(),
        quantifier,
        configured_count,
        true_count,
        false_count,
        unknown_count,
        members,
        truth,
        reasons,
        scene: scene_summary,
    })
}

struct MemberEvaluation {
    device: String,
    device_key: DeviceKey,
    present: bool,
    power: Option<bool>,
    scene_id: Option<crate::types::scene::SceneId>,
    unknown_reason: Option<UnknownReason>,
    member_truth: TruthValue,
}

fn evaluate_member(
    device_key: &DeviceKey,
    device: Option<&Device>,
    power: Option<bool>,
    scene: Option<&crate::types::scene::SceneId>,
) -> MemberEvaluation {
    let mut member = MemberEvaluation {
        device: device_key.to_string(),
        device_key: device_key.clone(),
        present: device.is_some(),
        power: None,
        scene_id: None,
        unknown_reason: None,
        member_truth: TruthValue::Unknown,
    };

    let Some(device) = device else {
        member.unknown_reason = Some(UnknownReason::MissingEntity {
            entity: device_key.to_string(),
        });
        return member;
    };

    member.power = device.is_powered_on();
    member.scene_id = device.get_scene_id();

    let mut truth = TruthValue::True;
    if let Some(expected) = power {
        match member.power {
            Some(actual) => {
                if actual != expected {
                    truth = TruthValue::False;
                }
            }
            None => {
                truth = TruthValue::Unknown;
                member.unknown_reason = Some(UnknownReason::MissingField {
                    field: "power".to_string(),
                });
            }
        }
    }
    if let Some(expected_scene) = scene {
        // An unassigned member is a known non-match for a requested scene.
        let scene_match = member.scene_id.as_ref() == Some(expected_scene);
        if !scene_match && truth != TruthValue::Unknown {
            truth = TruthValue::False;
        }
    }

    member.member_truth = truth;
    member
}

fn quantifier_truth(
    quantifier: Quantifier,
    configured_count: usize,
    true_count: usize,
    false_count: usize,
    unknown_count: usize,
) -> TruthValue {
    if configured_count == 0 {
        return TruthValue::Unknown;
    }

    match quantifier {
        Quantifier::All => {
            if false_count > 0 {
                TruthValue::False
            } else if unknown_count > 0 {
                TruthValue::Unknown
            } else {
                TruthValue::True
            }
        }
        Quantifier::Any => {
            if true_count > 0 {
                TruthValue::True
            } else if unknown_count > 0 {
                TruthValue::Unknown
            } else {
                TruthValue::False
            }
        }
        Quantifier::None => {
            if true_count > 0 {
                TruthValue::False
            } else if unknown_count > 0 {
                TruthValue::Unknown
            } else {
                TruthValue::True
            }
        }
        Quantifier::Partial => {
            if true_count > 0 && false_count > 0 {
                TruthValue::True
            } else if configured_count >= 2 && unknown_count == 0 {
                TruthValue::False
            } else {
                TruthValue::Unknown
            }
        }
    }
}

fn summarize_scene(
    scenes: Vec<Option<crate::types::scene::SceneId>>,
    missing_count: usize,
) -> GroupSceneSummary {
    let assigned_count = scenes.iter().filter(|scene| scene.is_some()).count();
    let unassigned_count = scenes.len() - assigned_count;

    if missing_count > 0 || scenes.is_empty() {
        return GroupSceneSummary {
            kind: GroupSceneSummaryKind::Unknown,
            scene_id: None,
            assigned_count,
            unassigned_count,
            unknown_count: missing_count,
        };
    }

    if assigned_count == 0 {
        return GroupSceneSummary {
            kind: GroupSceneSummaryKind::Unassigned,
            scene_id: None,
            assigned_count,
            unassigned_count,
            unknown_count: 0,
        };
    }

    let first = scenes[0].clone();
    if scenes.iter().all(|scene| scene == &first) {
        GroupSceneSummary {
            kind: GroupSceneSummaryKind::Uniform,
            scene_id: first,
            assigned_count,
            unassigned_count,
            unknown_count: 0,
        }
    } else {
        GroupSceneSummary {
            kind: GroupSceneSummaryKind::Mixed,
            scene_id: None,
            assigned_count,
            unassigned_count,
            unknown_count: 0,
        }
    }
}
