# AI Configuration Assistant — Implementation Plan

Status: deployed; feedback round 1 implemented (see "Feedback round 1" below).
Untracked working document.

## Goal

One assistant surface for creating, editing and deleting any config entity. The
assistant produces a **plan** (proposed operations) that the user reviews and
explicitly applies. Nothing is written before Apply.

Entity kinds (all menu items under automation, core, and floorplan editing):
`routine`, `scene`, `group`, `device`, `floorplan`, `integration`, `helper`,
`computed_source`.

Resolved decisions:
- Ops: create / update / delete.
- Retrieval: deterministic server-side search (no semantic search in v1).
- Review UI: lightweight expandable diff (collapsed: which entities changed;
  expanded: changed fields / final state), floorplan preview where possible.

## Backend

### Types — `server/src/types/assistant.rs`

```rust
pub enum AssistantEntityKind { Routine, Scene, Group, Device, Floorplan, Integration, Helper, ComputedSource }

pub struct AssistantAttachment { pub kind: AssistantEntityKind, pub id: Option<String>, pub label: Option<String> }

pub struct AssistantPlanRequest { pub prompt: String, pub attachments: Vec<AssistantAttachment> }

pub struct AssistantOperation {
    pub op_id: String,                       // "op-1"
    pub op: AssistantOpKind,                 // Create | Update | Delete
    pub kind: AssistantEntityKind,
    pub target_id: Option<String>,           // required for update/delete
    pub label: String,                       // human label for the review list
    pub before: Option<serde_json::Value>,   // masked snapshot for update/delete
    pub after: Option<serde_json::Value>,    // proposed state for create/update
    pub warnings: Vec<String>,               // destructive/in-use/etc.
}

pub struct AssistantPlan {
    pub plan_id: String,
    pub summary: String,
    pub operations: Vec<AssistantOperation>,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
}

pub struct ApplyAssistantPlanRequest { pub accepted_operation_ids: Vec<String> }
pub struct ApplyAssistantPlanResponse { pub results: Vec<AssistantOperationResult> }
pub struct AssistantOperationResult { pub op_id: String, pub ok: bool, pub error: Option<String> }
```

### Endpoints — extend `server/src/api/config/assistant.rs`

- `POST /api/v1/config/assistant/plan` — resolve attachments + deterministic
  search, call provider, parse strict JSON envelope, validate every op, store
  plan in a TTL store, return masked plan. Optional `history` is accepted and
  capped server-side.
- `POST /api/v1/config/assistant/plans/{plan_id}/apply` — re-validate accepted
  ops, apply in dependency order, return per-op results, drop the plan.
- `POST /api/v1/config/assistant/chat` — unified streaming turn (feedback
  round 1): SSE events `status` / `delta` / `usage` / `plan` / `action` /
  `error`; routes one prompt to either a config plan or a light-state action;
  aborts provider work when the client disconnects.
- `POST /api/v1/config/assistant/actions/{action_id}/apply` — quick-apply a
  stored light-state action through the normal device command path (single
  use; re-validated against the live catalog).
- `DELETE /api/v1/config/assistant/actions/{action_id}` — discard a stored
  action without applying it.
- `GET /api/v1/config/assistant/search?kind=&q=` — deterministic entity search
  (id/name substring, exact > prefix > substring, cap results). Used by the
  context builder and available to the UI.
- Existing `assistant/draft` and `assistant/apply` (one-off light action) stay
  as-is for compatibility; the UI no longer calls `assistant/apply`.

### Plan store

In-memory `Mutex<HashMap<String, AssistantPlan>>` on `AppState`-adjacent
shared state (or a dedicated `PlanStore` owned by the assistant module), TTL
~15 min, capped (~50 plans), swept on access. No DB table in v1.

### Context builder

- Per-kind adapter trait with: `list/search`, `schema_hint` (JSON shape +
  field docs for the prompt), `snapshot(id)` (masked), `validate(op)`,
  `apply(op)`.
- Attachments: resolve to masked snapshots; system prompt states the user is
  viewing that entity and changes should be scoped to it unless the request
  clearly needs more.
- Global prompts: tokenize prompt, deterministic search across kinds, include
  top matches (cap ~30) with minimal JSON; the model may only reference IDs
  present in context.
- Provider output: strict JSON `{summary, operations:[...]}`; unknown kinds,
  unknown IDs, or malformed ops → 422 with a readable error.

### Validation and apply (reuse existing write paths)

- routine: v2 compiler validation + id/name rules.
- scene/group: existing config validation + scene dry-run where available.
- device: metadata/capability constraints.
- floorplan: layout schema.
- integration: config schema; secrets masked in plan, omitted secret fields on
  update keep the stored value.
- helper: automation definition validation.
- computed_source: source definition validation (+ preview compute).
- Apply order: creates in dependency order (groups → scenes → routines),
  updates, then deletes in reverse; each op executed via the existing
  `StateHandle`/config write functions. Per-op success/error captured.
- Caps: max ~40 ops per plan; secrets never leave the server unmasked.

## Frontend

- `ui/assistant/AssistantPanel.tsx` — prompt input, attachment chips, message
  list, plan cards. Reuse the floorplan assistant dialog patterns.
- `ui/assistant/AttachmentChip.tsx` — removable chip (kind icon + label).
- `ui/assistant/PlanCard.tsx` — summary, per-op accept toggles, warnings,
  Apply/Discard; collapsed list = entity + op; expandable diff.
- `ui/assistant/OperationDiff.tsx` — changed-field list; expandable to final
  state; per-kind renderers (routine form read-only, generic JSON table).
- `ui/assistant/preview/` — floorplan preview reusing floorplan rendering with
  proposed entities applied; scene/group changes highlighted.
- Entry points: global assistant button (header/settings nav) plus an "Ask AI"
  action in each settings area/dialog that preloads an attachment chip.
- State: jotai atoms for panel open/attachments/messages/plan; ephemeral.

## Phases

1. Server: types, plan store, deterministic search, plan endpoint with
   routine + scene + group adapters, validation, tests.
2. Server: remaining kinds (device, floorplan, integration, helper, computed
   source) + apply endpoint + tests.
3. UI: panel, attachments, plan card, generic diff; wire global + per-area
   entry points.
4. UI: floorplan preview, per-kind previews, polish, tests.
5. Docs (AGENTS.md), deploy, live verification.

## Feedback round 1 (implemented)

User feedback after deployment. All five items below are implemented; the
legacy `/assistant/plan` and `/assistant/apply` endpoints remain for
compatibility but the UI now uses the unified streaming endpoint.

### 1. Conversation continuity

- `AssistantPlanRequest` and `AssistantChatRequest` gained an optional
  `history: [{role: "user"|"assistant", content}]`, oldest turn first.
- The server caps history to the newest 16 messages / 8000 characters, with
  each message truncated to 2000 characters (`history_messages`), so oversized
  or adversarial history cannot blow up the provider context.
- The UI keeps the thread in an in-memory jotai atom: it survives panel
  close/reopen and route changes but is never written to storage, so it dies
  with the browser session. A "New thread" button clears the conversation,
  the context meter, and the attachment chips.

### 2. Streaming, cancel, and context meter

- `POST /assistant/chat` responds with `text/event-stream`:
  - `status` — progress states (`phase`, `message`, `attempt`); emitted even
    when the provider does not stream.
  - `delta` — provider `choices[0].delta.content` text as it arrives.
  - `usage` — provider-reported token counts when present, otherwise a
    character-based estimate (`approximate: true`).
  - `plan` / `action` — exactly one terminal result, stored server-side.
  - `error` — readable failure message (validation, provider, transport).
- Provider streaming is requested with `stream: true` +
  `stream_options.include_usage`. If the provider rejects or ignores
  streaming, the server falls back to the existing non-streaming call (which
  keeps the json_mode / reasoning_effort retry ladder) and only progress
  states are streamed. The SSE parser buffers bytes per frame so multi-byte
  characters split across HTTP chunks are not corrupted.
- Cancel: the client aborts the fetch with an `AbortController`; the server
  wraps the SSE body in a `CancelOnDrop` stream guard that flips a
  `tokio::sync::watch` channel when hyper drops the body. The provider
  request/response future is raced against that watch, so a disconnect stops
  upstream work instead of only ignoring it.
- Context meter: the panel shows `totalTokens / contextWindow` from the last
  turn with a small progress bar, labelled approximate. The context window
  comes from `HOMECTL_ASSISTANT_CONTEXT_WINDOW` / the stored `contextWindow`
  setting (default 128k).

### 3. Unified "Ask AI" and "Plan changes"

- One panel (`ui/assistant/AssistantPanel.tsx`) handles both config plans and
  immediate light-state requests. `ui/app/map/AssistantActionDialog.tsx` and
  the dedicated floorplan buttons are removed.
- Routing design: a single provider call returns a JSON envelope with an
  optional `kind` field (`"action"` or `"plan"`). The server infers `action`
  when only `changes` is populated and `plan` otherwise, then validates
  against the matching catalog. This keeps one round trip and one context
  (config context + controllable-device catalog) per turn; no separate
  classifier call.
- Light-state results are stored as `AssistantAction` entries in the same TTL
  store as plans and rendered as a card with a per-device change list and an
  "Apply now" button. Applying calls
  `POST /assistant/actions/{id}/apply`, which re-validates against the live
  catalog and applies through the normal `StateHandle` device command path.
- No-blind-write rule preserved: a light change is never written on the
  provider turn, only when the user explicitly clicks Apply. (The legacy
  `/assistant/apply` endpoint still applies immediately for compatibility.)
- Device scope: the request accepts `deviceKeys`; the context builder only
  exposes those controllable devices, and out-of-scope keys are rejected
  during validation.

### 4. Floorplan AppBar

- The floorplan toolbar keeps only the floorplan tabs and the View popover.
  The two extra AI buttons ("Plan changes", "Ask AI") are gone; the single
  icon-only assistant button in the global AppBar is the one entry point,
  consistent with every other page.
- The AppBar search field (`CommandPaletteTrigger`) is removed entirely. The
  navigation rail (desktop) and bottom navigation (mobile) both expose Search,
  and Ctrl+K / Ctrl+P still opens the command palette.

### 5. Server and bindings

- New/changed types: `AssistantChatRequest`, `AssistantHistoryMessage`,
  `AssistantMessageRole`, `AssistantAction`, `AssistantActionChange`,
  `AssistantActionColor`, `AssistantActionChangeResult`,
  `ApplyAssistantActionResponse`, `AssistantUsage`; `AssistantPlanRequest`
  gained optional `history`.
- TS bindings regenerated via the ignored `export_bindings` test; AGENTS.md
  updated with the new endpoints, settings, and UI behavior.
- Deferred: server-side conversation persistence (deliberately out of scope),
  token-exact metering (provider-dependent), and an integration test for
  mid-stream disconnect cancellation (the guard is unit-sized and exercised
  manually; a blocking test client makes this awkward).
