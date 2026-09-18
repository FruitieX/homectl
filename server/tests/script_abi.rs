//! P07 script ABI tests through the real worker and owner coordinator.
//!
//! Covers:
//! * S10: the condition contract rejects strings, Promises, arrays, and
//!   wrong-shaped objects while accepting the explicit unknown shape.
//! * S11: immutable context plus injected fixed clock and seeded randomness
//!   produce repeatable results across fresh realms.
//! * S12: owner memory advances only for a successful current result with the
//!   correct CAS revision.
//! * S16: edited or disabled owners cannot publish late results.

use std::path::PathBuf;
use std::time::Duration;

use homectl_server::core::automation::{
    parse_condition_outcome, Admission, CoalescePolicy, CompleteResult, ConditionOutcome,
    RoutineHandlerOutcome, ScriptCoordinator, ScriptInvocation, ScriptOutputContract,
    ScriptOwnerId, StaleReason,
};
use homectl_server::core::js_worker::{JsWorkerPool, SupervisorConfig, WorkerError};
use homectl_server::types::automation_definition::NativeAction;
use homectl_server::types::automation_trace::UnknownReason;
use serde_json::{json, Value};

fn worker_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_script-worker"))
}

async fn test_pool(workers: usize) -> JsWorkerPool {
    JsWorkerPool::new(SupervisorConfig {
        worker_binary: Some(worker_binary()),
        workers,
        invocation_timeout: Duration::from_millis(500),
        ..SupervisorConfig::default()
    })
    .await
    .expect("spawn worker pool")
}

fn context(now_ms: i64, seed: u64) -> Value {
    json!({"now_ms": now_ms, "seed": seed})
}

#[tokio::test]
async fn s10_condition_contract_is_strict_through_the_worker() {
    let pool = test_pool(1).await;

    let known = pool.execute("return true;", context(1, 1)).await.unwrap();
    assert_eq!(
        parse_condition_outcome(&known).unwrap(),
        ConditionOutcome::Known(true)
    );

    let unknown = pool
        .execute(
            "return api.unknown({kind: 'missing_entity', entity: 'lamp'});",
            context(1, 1),
        )
        .await
        .unwrap();
    assert_eq!(
        parse_condition_outcome(&unknown).unwrap(),
        ConditionOutcome::Unknown(UnknownReason::MissingEntity {
            entity: "lamp".to_string()
        })
    );

    let bare_unknown = pool
        .execute("return api.unknown();", context(1, 1))
        .await
        .unwrap();
    assert!(matches!(
        parse_condition_outcome(&bare_unknown).unwrap(),
        ConditionOutcome::Unknown(UnknownReason::UnknownSourceValue { .. })
    ));

    for rejected_script in [
        "return 'yes';",
        "return Promise.resolve(true);",
        "return [true];",
        "return { kind: 'known', value: true };",
        "return 1 / 0;",
    ] {
        let value = match pool.execute(rejected_script, context(1, 1)).await {
            Ok(value) => value,
            Err(WorkerError::Script { .. }) => continue,
            Err(other) => panic!("unexpected worker error: {other:?}"),
        };
        assert!(
            parse_condition_outcome(&value).is_err(),
            "{rejected_script} should be rejected, got {value}"
        );
    }

    pool.shutdown().await;
}

#[tokio::test]
async fn s11_clock_randomness_and_context_are_deterministic_and_frozen() {
    let pool = test_pool(2).await;

    let script = r#"
        var mutationRejected = false;
        try { ctx.now_ms = 999; } catch (error) { mutationRejected = true; }
        return {
            now: api.now,
            dateNow: Date.now(),
            constructedNow: new Date().getTime(),
            epoch: new Date(0).getTime(),
            randomA: api.random(),
            randomB: api.random(),
            mathRandom: Math.random(),
            frozen: Object.isFrozen(ctx),
            mutationRejected: mutationRejected,
            nowAfterMutation: ctx.now_ms
        };
    "#;

    let first = pool.execute(script, context(123_456, 42)).await.unwrap();
    let second = pool.execute(script, context(123_456, 42)).await.unwrap();

    assert_eq!(first, second, "same injected time/seed must replay");
    assert_eq!(first["now"], 123_456);
    assert_eq!(first["dateNow"], 123_456);
    assert_eq!(first["constructedNow"], 123_456);
    assert_eq!(first["epoch"], 0);
    assert_eq!(first["frozen"], true);
    assert_eq!(first["nowAfterMutation"], 123_456);
    let random_a = first["randomA"].as_f64().unwrap();
    assert!((0.0..1.0).contains(&random_a));
    assert_ne!(first["randomA"], first["randomB"]);

    let different_seed = pool.execute(script, context(123_456, 43)).await.unwrap();
    assert_ne!(
        random_a,
        different_seed["randomA"].as_f64().unwrap(),
        "different seeds must produce different streams"
    );

    pool.shutdown().await;
}

fn owner() -> ScriptOwnerId {
    ScriptOwnerId::routine("staircase")
}

fn handler_invocation() -> ScriptInvocation {
    ScriptInvocation {
        owner: owner(),
        definition_revision: 1,
        contract: ScriptOutputContract::RoutineHandler,
        source_body: r#"
            var step = ctx.state.memory.step;
            return {
                actions: [
                    api.actions.setPower({
                        device: { integration_id: "dummy", device_id: "lamp" },
                        power: step === 0
                    }),
                    api.actions.activateScene({
                        scene: "night",
                        targets: { groups: ["staircase"] }
                    })
                ],
                next_state: { step: step + 1 }
            };
        "#
        .to_string(),
        context: json!({
            "now_ms": 1000,
            "seed": 7,
            "state": {"memory": {"step": 0}, "revision": 0}
        }),
        coalesce: CoalescePolicy::Queue,
        run_id: Some("run-1".to_string()),
    }
}

fn admission_token(admission: Admission) -> homectl_server::core::automation::InvocationToken {
    match admission {
        Admission::Accepted(token) | Admission::Coalesced { token, .. } => token,
    }
}

#[tokio::test]
async fn s12_owner_memory_advances_only_for_the_current_result() {
    let pool = test_pool(2).await;
    let mut coordinator = ScriptCoordinator::new();
    coordinator.load_owner(&owner(), 1, json!({"step": 0}));

    let invocation = handler_invocation();
    let first = admission_token(coordinator.submit(&invocation).unwrap());
    let second = admission_token(coordinator.submit(&invocation).unwrap());

    let first_value = pool
        .execute(&invocation.source_body, invocation.context.clone())
        .await
        .unwrap();
    let second_value = pool
        .execute(&invocation.source_body, invocation.context.clone())
        .await
        .unwrap();

    let applied = coordinator.complete_handler(&first, &first_value);
    let CompleteResult::Applied {
        value,
        state_applied,
    } = applied
    else {
        panic!("expected an applied result, got {applied:?}");
    };
    assert!(state_applied);
    assert_eq!(value.actions.len(), 2);
    assert!(matches!(
        value.actions[0],
        NativeAction::SetPower { power: true, .. }
    ));
    assert!(matches!(
        value.actions[1],
        NativeAction::ActivateScene { .. }
    ));
    assert_eq!(coordinator.memory(&owner()), Some(&json!({"step": 1})));

    // The second invocation was admitted against state revision 0.
    assert_eq!(
        coordinator.complete_handler(&second, &second_value),
        CompleteResult::Stale(StaleReason::StateChanged)
    );
    assert_eq!(coordinator.memory(&owner()), Some(&json!({"step": 1})));
    assert_eq!(coordinator.state_revision(&owner()), Some(1));

    pool.shutdown().await;
}

#[tokio::test]
async fn s16_edited_or_disabled_owners_cannot_publish_late_results() {
    let pool = test_pool(1).await;
    let mut coordinator = ScriptCoordinator::new();
    coordinator.load_owner(&owner(), 1, json!({"step": 0}));

    let invocation = handler_invocation();
    let value = pool
        .execute(&invocation.source_body, invocation.context.clone())
        .await
        .unwrap();

    let edited = admission_token(coordinator.submit(&invocation).unwrap());
    coordinator.load_owner(&owner(), 2, json!({"step": 0}));
    assert_eq!(
        coordinator.complete_handler(&edited, &value),
        CompleteResult::Stale(StaleReason::DefinitionChanged)
    );

    let mut current = handler_invocation();
    current.definition_revision = 2;
    let disabled = admission_token(coordinator.submit(&current).unwrap());
    coordinator.set_enabled(&owner(), false);
    assert_eq!(
        coordinator.complete_handler(&disabled, &value),
        CompleteResult::Stale(StaleReason::Disabled)
    );
    pool.shutdown().await;
}

#[tokio::test]
async fn prelude_builders_fail_fast_on_malformed_input() {
    let pool = test_pool(1).await;

    let error = pool
        .execute("api.actions.setPower({});", context(1, 1))
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Script { .. }), "{error:?}");

    let error = pool
        .execute("api.actions.activateScene({});", context(1, 1))
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Script { .. }), "{error:?}");

    // Runtime-handler contract: `next_state` must stay bounded.
    let oversize = pool
        .execute(
            "return { actions: [], next_state: { blob: 'x'.repeat(70000) } };",
            context(1, 1),
        )
        .await
        .unwrap();
    assert!(
        homectl_server::core::automation::parse_routine_handler_outcome(
            &oversize,
            homectl_server::core::automation::MAX_SCRIPT_STATE_BYTES
        )
        .is_err()
    );

    // Typed parse path agrees with the plan fixtures (X05 direction).
    let handlers: RoutineHandlerOutcome =
        homectl_server::core::automation::parse_routine_handler_outcome(
            &pool
                .execute(
                    "return { actions: [api.actions.cancelTimer({ key: 'off' })] };",
                    context(1, 1),
                )
                .await
                .unwrap(),
            homectl_server::core::automation::MAX_SCRIPT_STATE_BYTES,
        )
        .unwrap();
    assert!(matches!(
        handlers.actions[0],
        NativeAction::CancelTimer { .. }
    ));

    pool.shutdown().await;
}
