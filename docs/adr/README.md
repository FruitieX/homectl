# Architecture Decision Records: Automation v2

These ADRs capture the normative decisions for automation v2 so code reviews
can cite durable design documents.

They describe the **target** model. Until the corresponding work package lands,
v1 behavior remains authoritative and is captured by the P00 characterization
fixtures (`server/tests/automation_baseline.rs`, module
`homectl_server::core::automation_baseline`).

| ADR | Topic |
|---|---|
| [0001](0001-automation-domain-model.md) | Domain model and terminology |
| [0002](0002-triggers-and-temporal-behavior.md) | Triggers, transitions, temporal behavior |
| [0003](0003-conditions-unknowns-groups.md) | Conditions, unknowns/errors, group semantics |
| [0004](0004-versioned-definitions-and-compiler.md) | Versioned definitions, compiler, persistence |
| [0005](0005-events-plans-and-execution.md) | Coherent events, action plans, execution |
| [0006](0006-scheduler-and-timers.md) | Server-owned scheduler, timers, recovery |
| [0007](0007-javascript-environment.md) | JavaScript worker environment and contracts |

## Status

All ADRs are **accepted as target design** (P00, not yet implemented). They are
not a description of shipping behavior.
