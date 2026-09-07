# Backend and UI/API review

Reviewed September 6, 2026, against local commit `0f1281b4` and read-only requests to `https://homectl.fruitiex.org`. No configuration edits, commands, or fault injection were performed on the running home. Local code and deployed code are not assumed to be identical; code-path risks below were inspected locally, not reproduced against production.

## Implementation progress — first correctness pass

Implemented locally after the review:

- Integration, group, scene, and routine CRUD now serialize preparation, runtime application, and persistence. Integration preparation reads current configuration after acquiring the lock; its commit replaces only the integration domain. Imports and migration apply share the lock through persistence, with migration merging against a fresh snapshot.
- Those configuration responses now include `write: { applied, persistence, warning }`. Persistence is `persisted`, `memory_only`, or `failed`. Runtime failures return an error instead of a success response. The settings UI retains per-save warnings across navigation and links to backup export. Warnings are session state and do not survive a browser refresh.
- Integration reload constructs replacements before stopping working integrations and propagates lifecycle failures. On failure it stops replacements and attempts to restart the previous actors. MQTT, cron, circadian, random, and timer tasks are owned by their integration and cancelled on stop/drop. Cron syntax is validated before registration.
- `DeviceCommand` patches carry a device key and requested power, brightness, color, or transition fields. HTTP `POST /api/v1/commands/device` and WebSocket requests use the same actor command. Validation rejects read-only targets and invalid/unsupported changes; commands merge against current actor state instead of trusting a client-supplied Device. Replies carry request IDs and arrive after snapshot publication.
- Live UI controls use these patches and show rejection, timeout, and connection-loss errors. They do not replay commands on reconnect. A reply confirms runtime application, not physical-device delivery.
- Brightness support is explicit metadata, normalized from legacy brightness/color information where no override is supplied. Explicit `false` wins. Off lights keep a brightness slider, unset values are labelled “Not set,” and read-only devices are excluded from live controls. Capability and management changes are retained even when physical state is unchanged.

Validation: 165 server unit tests, 28 HTTP configuration/command integration tests, and 6 scene-cycling tests passed. Coverage includes concurrent integration creates, rejected reloads and stop recovery, timer cancellation, memory-only writes, command validation, snapshot-before-reply ordering, and metadata updates. TypeScript bindings were regenerated; Clippy with warnings denied, UI type-checking/lint/build, and desktop/mobile Chromium interaction checks passed. Browser fixtures exercised command errors, disconnects, off-state dimming, read-only controls, and save warnings across settings navigation. All control/failure tests used local fixtures.

Deployment order: backend first, then UI. The backend retains legacy WebSocket events for compatibility; the updated UI requires the command and brightness-capability additions.

This is the first pass, not completion of the whole roadmap. Legacy event writes and other configuration domains still need migration to the shared result contract. Revision conflict detection, multi-browser configuration invalidation, command idempotency, hardware delivery tracking, transactional cross-entity renames, a configuration inspector, queue policies, and automation templates remain future work. Reload recovery is best effort; it cannot undo external effects already emitted by a failing integration. No production configuration was changed.

## Implementation progress — configuration checks and scene access

Added a read-only `GET /api/v1/config/diagnostics` endpoint and **Settings → Configuration check**. The inspector reads one immutable runtime snapshot without executing scripts, dispatching events, or writing configuration. It reports missing group/device/scene references, cyclic nested groups, malformed scene links, empty groups/targets, read-only scene targets, and unresolved current scene assignments. Availability-dependent checks are deferred during warmup. Issues have stable identifiers and deterministic ordering; warnings appear first, with intentional configurations separated into a “For review” filter. Review links open the matching group, scene, or device settings filtered by ID.

Room pages now put scenes before devices on mobile, show scenes in two columns, support scene search, and allow scenes to be pinned locally in the browser. Repeated activation instructions, per-scene edit buttons, and large scene previews have been removed from the everyday list; room pages provide a single Manage scenes link. Scene actions are restricted to matching writable devices in the current selection. Room overview cards retain on/off controls without repeating the full brightness panel on every card.

Validation: 175 server unit tests passed, including group-cycle membership, warmup suppression, missing references, malformed-link handling, stable issue output, and read-only/stale-assignment inspection. Generated bindings, Clippy with warnings denied, UI type-check/lint/build, and fixture-only production-browser tests passed. Browser checks covered pin persistence, ordering, search, selection scope, read-only exclusion, mobile layout, editor links, filters, warmup, empty results, and an older-backend error. All browser API and WebSocket traffic was intercepted with fixtures; no homectl API calls or physical light changes were made after the user's explicit restriction.

Limits: this first inspector does not evaluate scripts or routine behavior, prove linked-scene cycles, check hardware reachability, or apply repairs. Pins are browser-local preferences, not shared home configuration. Separating physical rooms from other collections still needs an explicit configuration model; existing groups have not been guessed or reclassified. Scene activation used the legacy event path at this stage; runtime acknowledgments are implemented in the next pass below.

## Implementation progress — save consistency and scene commands

Core settings accept partial updates, preserving omitted service settings and credentials. Core and service settings persist in one transaction. Routine updates persist the complete current routine collection atomically, so retrying a failed rename repairs the old database ID and references. Device label and sensor configuration writes also report persistence outcomes. Settings warnings remain visible until a successful save.

Typed HTTP and WebSocket scene commands validate the complete selection before changing runtime state, reject invalid or empty selections, and acknowledge after snapshot publication. Room controls show pending state and errors; the scene editor displays activation failures inside its dialog. Replies confirm runtime application, not hardware delivery. Timeouts and disconnects do not replay commands.

The dashboard header now groups editing and fullscreen controls, removes the healthy connection badge, and hides editing entirely in fullscreen. A single-layout dashboard no longer reserves a toolbar row, and widgets no longer inherit the grid-help tooltip. Navigation uses an SVG rendition of the existing house logo.

Validation: 184 server unit tests passed, including isolated SQLite rollback/retry and scene validation/snapshot tests. Binding generation, Clippy with warnings denied, UI type checking, lint, and production build passed. Browser fixtures cover scene correlation, rejection, timeout, disconnect, no replay, editor errors, and persistence warning recovery. No homectl API calls or physical light changes were made.

Remaining limits include physical-delivery acknowledgments, revisioned synchronization, and the broader execution/configuration refactors below.

## Observations from the running instance

- 75 devices: 52 controllable and 23 sensors.
- 13 integration instances, 29 groups (16 visible), 18 scenes, 35 routines, one dashboard layout.
- 14 routines contain `nightlight` in their IDs and implement related room/button scene cycling.
- Three circadian integrations share schedule structure but vary color/brightness profiles for different lights.
- Group membership includes physical rooms, floors, manufacturer collections, all devices, and heaters. These are useful collections, but they are not all rooms.
- No unresolved device keys were found in the returned flattened group memberships.
- 47 controllable devices had null brightness in the observed state. This includes dimmable lights assigned an off scene; absent current brightness does not establish lack of dimming support.
- Five outdoor spots are `UnmanagedReadOnly`. The group `outdoor_small_spots` currently has no members.
- The recent 500-entry log buffer contained 75 warnings, all from device scene resolution. Samples identify those outdoor spots with an unresolved `normal` scene state. This is evidence of a state/configuration mismatch, not proof that the physical devices are malfunctioning.
- Routine history was empty at inspection time; the implementation retains a maximum of 500 entries in memory, so absence does not prove routines never ran.
- A ten-second passive WebSocket observation received one initial state message, about 119 KB, and no subsequent patches. Raw device payloads account for about 46 KB of that snapshot. This observation does not establish high steady-state traffic or a performance problem.
- Health endpoints returned 200 and runtime status reported persistence available. The code's readiness check only tests warmup, and persistence availability only tests whether a database handle exists. Neither proves a recent successful database operation.
- API reads succeeded without credentials in these requests. Network/proxy access restrictions were not audited. The local API routes have no application authorization filters and use permissive CORS. Write access was not tested.

## 1. Correct configuration save and reload semantics

Priority: highest correctness work.

`server/src/api/config.rs::create_group` and `update_group` discard actor errors and log persistence failures before returning success. Integration create/update paths similarly log application/persistence failures and can return success. Memory-only operation is intentional, but it must be visible in the response to that specific save.

Introduce a shared configuration service with validation, revisions, and explicit results: applied revision, persistence outcome, and integration-application status where relevant. Make the UI distinguish saved durably, applied only in memory, and failed. Surface failed persistence attempts even when the connection handle still exists. Preserve offline startup/fallback behavior.

There is also a concrete lost-update risk in integration hot reload: `apply_runtime_integrations_change` clones configuration before acquiring its apply lock, performs external work, and `commit_runtime_integrations_update` replaces the whole runtime configuration. A concurrent group/scene edit can be overwritten, and two integration edits can start from the same old configuration. Runtime configuration and already-rebuilt derived state can then disagree.

Acquire/revalidate the relevant revision before preparation, commit only the affected domain, and reject or rebase conflicting edits. Keep slow lifecycle work outside the state actor. Track failed reloads explicitly and define how old/new actors are cleaned up after partial failure.

Tests: overlapping integration/group edits, two integration reloads, disconnected persistence during save, actor failure, and failed integration start. Assert returned outcomes and both runtime and stored configuration.

## 2. Replace public internal events with typed commands

Priority: highest UI/API work.

The UI sends an entire Device through `EventMessage(SetInternalState)`. The server eventually stores a clone of the submitted device. This couples the client to runtime internals and permits an old UI snapshot to overwrite newer fields unrelated to the requested adjustment.

Introduce public commands such as SetPower, SetBrightness, SetColor, ActivateScene, and ApplyGroupState. They carry target keys and the requested change, not client-authored capabilities, raw payloads, or management policy. The actor merges commands against current state and enforces write permissions.

Both HTTP and WebSocket should enter the same command handler and return a request ID and structured acceptance/rejection. Later events can report runtime application and integration dispatch/failure. Report physical confirmation only where the integration supplies evidence. Add idempotency for commands that may be retried; do not automatically replay an old toggle after reconnect.

Keep internal Event private to the runtime. Use a distinct, generated public API schema and a protocol version. This also avoids HTTP action validation diverging from the raw WebSocket event path.

## 3. Make device semantics explicit

Priority: prerequisite for trustworthy controls.

The capability model lists color modes but lacks explicit power/brightness support, device role, sensor units, freshness, and a concise writable-policy field. Current desired state, reported state, and supported features must be separate concepts.

The live null-brightness and read-only devices expose defects in the latest UI pass too: `DeviceQuickControls` infers dimming support from a non-null value and the new controls do not respect read-only management. Correct these as part of the contract work rather than adding more name-based heuristics.

Add explicit capabilities and constraints, normalized readings with units, device role where known/configured, and write permissions derived from management policy. Preserve unknown values honestly. Retain raw integration payloads for diagnostics, fetched when needed.

Define color temperature units and conversions at the boundary. Returning HS-converted state to the UI should not require the UI to round-trip that representation for a power command.

Add separate semantic room/area membership and control collections. Keep cross-room/manufacturer/floor groups available; don't expose every group as a physical room or infer a safe lights-only scope from “All.”

## 4. Build a configuration inspector and execution explanation

Priority: highest diagnostic value for this configuration.

Expose a read-only inspection result identifying unresolved scene targets, stale scene assignments, empty referenced groups, invalid device/scene references, read-only action targets, and dependency cycles. Report warnings with links to the affected editor and a proposed repair; do not silently rewrite configurations.

For the five outdoor spots, inspect whether retaining `normal` after moving to read-only/unmanaged mode is intended. Handle unresolved assignments deliberately and deduplicate repeated warnings. The existing empty outdoor subgroup may be intentional and should not be filled automatically.

Extend existing state-source metadata and routine history into an explanation of each command: originating button/sensor, matched rules, scene resolution, group/device overrides, queued dispatch, and outcome. Persist bounded history with retention, or make durable diagnostics optional. Build on the existing simulation support for a dry-run preview that cannot publish to physical integrations.

The `normal` scene's price script defaults a missing price to zero. Introduce explicit missing/stale-input behavior and test what the user wants in that situation; missing price and free electricity should not accidentally be equivalent.

## 5. Simplify repeated automation configuration

Priority: largest reduction in maintenance work.

Represent common remote-button mappings and room scene cycles as reusable, parameterized definitions. The fourteen nightlight routines are a concrete starting point. A definition can take input events, target group, ordered scenes, trigger mode, and rollout settings, then compile into existing rules/actions. Keep generated behavior inspectable and allow individual exceptions.

Normalize remote events at the integration boundary where practical. Currently raw JSON paths and normalized sensor values coexist, and trigger mode defaults mix with explicit edge/pulse/level settings. Preserve those semantics during migration and show them clearly.

Share circadian schedule definitions while allowing per-device/group color and brightness profiles. The three current instances are not exact duplicates: their intentional tuning must survive any consolidation.

Use the existing simulation engine to replay representative button, occupancy, price, and timer events against proposed changes. Start with explicit templates and previews, not an opaque new automation language.

## 6. Bound execution and make congestion observable

Keep the single state actor, immutable snapshots, per-integration actors, and existing outbound coalescing/rate limits. They are useful foundations.

State, event, integration-command, and deferred-work queues are unbounded. Per-client WebSocket queues are already bounded; don't describe the entire application as unbounded. Introduce queue policies by event class: coalesce replaceable state, preserve button edges, reject overloaded admin requests explicitly, and avoid silently dropping important commands.

The deferred worker serializes persistence and integration dispatch work. A slow persistence operation can delay later work even though state mutation itself remains responsive. Separate work with different ordering requirements, preserving order per device/scene/key. Measure enqueue-to-start latency, queue age, throughput, and dispatch delay before selecting limits.

The live Zigbee integration limits outbound updates to one per 200 ms. Twenty distinct queued changes therefore span about 3.8 seconds between first and last dispatch, before other delays. Spatial rollout timing cannot be understood without this queue. Show pending work and distinguish requested rollout duration from achieved dispatch timing; don't simply remove the rate limit.

Boa scripts execute synchronously during scene/rule evaluation. The inspected engine setup applies no execution limits, and the installed Boa version defaults the loop limit to its maximum. A problematic script can monopolize the state actor. Add engine execution limits, isolate evaluation behind a bounded worker boundary, and cap input/output sizes. An async timeout alone cannot preempt synchronous JavaScript execution.

Script dependencies are currently inferred from literal bracket access in source text. Computed device lookups can escape that analysis. Require explicit dependencies or track accesses, with conservative invalidation when uncertain.

## 7. Strengthen state synchronization

Add a stream/session identifier and monotonically increasing revisions to snapshots and patches. Initial state delivery and broadcasts currently share the client channel without a revision contract. Clients should detect gaps, resynchronize, and clearly distinguish connected transport from a loaded/current snapshot.

Review slow-client teardown: removing a sender from the broadcast registry does not itself establish that the peer received an explicit close or knows it must resynchronize. Close/cancel the full connection or request resync on overflow.

Emit configuration revision/invalidation events so a second browser refreshes cached configuration after an edit. Current React Query mutation invalidation updates the initiating browser; the runtime WebSocket stream does not provide a general config-cache invalidation protocol.

Consider subscriptions and on-demand raw payloads after measuring representative traffic. The observed 119 KB initial snapshot alone is not a reason for a transport rewrite.

## 8. Consolidate the API contract and code boundaries

Use ts-rs consistently for public request/response types. ActionBuilder, RuleBuilder, configuration hooks, and dashboard hooks currently hand-maintain parts of the schema alongside generated bindings. A shared command/config contract plus contract tests is more valuable than changing frameworks.

Split the roughly 4,400-line config API module into domain handlers, validation/reference rewriting, configuration application, and persistence. Keep routes thin; place cross-domain invariants in the configuration service, not duplicated handlers. Replace silent error swallowing with typed results while preserving the intentional fallback model.

Add a build/version/protocol identifier to diagnostics to compare deployed and local behavior. Make health report actor progress and recent persistence status separately from process liveness and warmup. Do not make intentional memory-only operation indistinguishable from accidental persistence failure.

Confirm the deployment's trust boundary. If access is intended beyond a trusted network, add authentication, authorization for control/configuration/diagnostics, a WebSocket origin policy, and credential redaction. These API reads required no credentials from this environment; that does not establish the absence of network controls elsewhere.

## Suggested sequence

1. Fix configuration lost updates and truthful save outcomes; add concurrency/failure tests.
2. Add typed commands and results, explicit capabilities/write permissions, and correct the UI's null-brightness/read-only behavior.
3. Add configuration diagnostics and durable execution explanations; resolve the outdoor scene warnings with a reviewed repair.
4. Add revisioned synchronization and config invalidation; improve queue metrics, work separation, and script limits.
5. Introduce remote/scene-cycle templates and shared circadian schedules, validated through simulation before migrating live configuration.

Make each step independently deployable. No database, framework, actor architecture, or transport replacement is required to get these benefits.
