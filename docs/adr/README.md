# Architecture Decision Records: Automation v2

These ADRs capture the normative decisions from the homectl automation v2 plan
(`homectl-automation-v2-implementation-plan.md`, baseline `5aef129c`) so code
reviews can cite a durable document instead of the plan text.

They describe the **target** model. Until the corresponding work package lands,
v1 behavior remains authoritative and is captured by the P00 characterization
fixtures (`server/tests/automation_baseline.rs`, module
`homectl_server::core::automation_baseline`).

| ADR | Topic | Plan sections |
|---|---|---|
| [0001](0001-automation-domain-model.md) | Domain model and terminology | 1.1 |
| [0002](0002-triggers-and-temporal-behavior.md) | Triggers, transitions, temporal behavior | 1.2 |
| [0003](0003-conditions-unknowns-groups.md) | Conditions, unknowns/errors, group semantics | 1.3, 1.4 |
| [0004](0004-versioned-definitions-and-compiler.md) | Versioned definitions, compiler, persistence | 2 |
| [0005](0005-events-plans-and-execution.md) | Coherent events, action plans, execution | 3, 4 |
| [0006](0006-scheduler-and-timers.md) | Server-owned scheduler, timers, recovery | 5 |
| [0007](0007-javascript-environment.md) | JavaScript worker environment and contracts | 6 |

## Status

All ADRs are **accepted as target design** (P00, not yet implemented). They are
not a description of shipping behavior.
