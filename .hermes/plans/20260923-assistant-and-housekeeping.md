# Continuation plan — assistant plan staging + dependency housekeeping

Written 2026-09-23. Two independent tasks. Task 1 has a stashed half-finished
implementation to resume; Task 2 is untouched work.

Worktree for both: `~/homectl-wt/panel` (branch `assistant-panel-mobile`).
Run everything through Nix — the host has no `cc`, and `cargo` outside the dev
shell fails with `failed to find tool "cc"`:

    cd ~/homectl-wt/panel && nix develop .#default -c bash -lc 'cd server && …'

---

## Task 1 — a plan must be able to reference what it creates

**Symptom.** The assistant proposed a plan where op-1 created a helper and op-2's
routine used it. Validation rejected op-2 (`Unknown helper '…'`) because
`PlanValidation` is built once from the live snapshot and every operation is
checked against it — nothing an operation creates is visible to the ones after
it. The same blind spot exists in the apply path, which revalidates each
operation in order against the same validator.

**Already fixed, do not redo.** Repair turns now carry the valid group / scene /
helper / source / routine ids and device keys, plus label→id corrections
(commit `788b23be`). That handles the sibling failure where the model writes a
display name (`Patio lights`) into an id field (`patio_lights`).

**Recovery.** The half-finished implementation is stashed:

    cd ~/homectl-wt/panel && git stash list        # staged-creates-wip
    git stash pop

It contains the field/call-site conversion from `RefCell` to `StdMutex` and is
mid-way through — expect compile errors, not a working build.

### Hard-won constraint

`PlanValidation` is passed **by reference** (`&PlanValidation`) into
`apply_plan_operation` (~line 3219) and shared across operations, and that
future must be `Send`. **`RefCell` breaks it** (the route futures stop being
`Send`, which surfaces as puzzling `E0599` errors far from the real cause — it
cost a red build on `main`). Use `std::sync::Mutex`, via short
`.lock().map(…).unwrap_or(false)` reads, never holding a guard across an await.

### Touch points

`server/src/api/config/assistant.rs`
- `struct PlanValidation` (~4334): `group_ids`, `scene_ids` (the reference sets)
  plus the staging sets — `Mutex<HashSet<String>>` for created ids, staged
  groups and staged scenes.
- `catalog: ConfigCatalog` must be wrapped (`Mutex<ConfigCatalog>`) if staging
  goes through it — **check every holder**: the last attempt patched one struct
  and left another call site calling `.lock()` on an unwrapped field.
- `fn build_operation(&self, …)` (~4372), `Create` branch, after the
  "already exists" check: reject an id created twice in one plan, then stage it
  (group → staged groups, scene → staged scenes, and
  `catalog.stage_created(kind.code(), &id, &after)` for the rest).
- The three reference checks reading `group_ids` / `scene_ids` (~4600, 4614,
  4676) must also consult the staged sets.
- The routine compile (~4561,
  `automation::compile_definition_value(&definition, &self.catalog)`) must see
  the staged entities, otherwise `compile.rs` raises `Unknown helper` /
  `Unknown group` for exactly the case being fixed.

`server/src/core/automation/compile.rs`
- `impl ConfigCatalog` — add:

      pub fn stage_created(&mut self, kind: &str, id: &str, body: &serde_json::Value)

  inserting into `groups` / `scenes` / `routines` / `sources` / `helpers`.
  These id types are tuple structs over `String`: `GroupId(id.to_string())`,
  `SourceId(…)`, `HelperId(…)`; `SceneId` / `RoutineId` accept `.into()`.
  Helpers need a `HelperDefinition`: `serde_json::from_value(body.clone())`.

### Test and verification

- Add a `plan_validation` test: a two-operation plan (create a helper, then a
  routine whose program references it) must validate. Fixtures live near
  `plan_validation_compiles_routine_definitions` (~5850).
- Green bar: `cargo fmt`, `cargo build`, `cargo test --quiet --lib
  plan_validation`, `cargo test --quiet --lib compil`.
- **Do not pipe `cargo` into `grep`/`tail`** — the pipeline's exit code is the
  last command's, so a failed build reads as success and gets pushed. That is
  how the red build reached `main`.
- Push to `main` only after a green build, as a Conventional Commit.

---

## Task 2 — dependency housekeeping

GitHub reports **87 Dependabot alerts** on `FruitieX/homectl`'s default branch
(39 high, 33 moderate, 15 low).

Follow the `project-housekeeping` skill. Shape of the work:

- Enumerate alert origins (`gh api repos/FruitieX/homectl/dependabot/alerts`)
  and group by ecosystem: Rust (`Cargo.lock`), npm (`ui/pnpm-lock.yaml`),
  GitHub Actions, Docker.
- Land compatible bumps first (patch/minor inside existing semver ranges) —
  `cargo update`, `pnpm up` — one Conventional Commit, full gates:
  `cargo test` (two known environmental hurl flakes:
  `scene-cycling-mixed.hurl`, `trigger-modes.hurl`) and
  `pnpm tsc && pnpm lint && pnpm test && pnpm exec vite build`.
- Majors individually, each with its own commit and its own CI run. Do not
  batch a major with anything else.
- Toolchain and Rust version come from the flake; no toolchain surgery.

---

## Task 3 — a decision, not yet code

The user's intent for one routine was "if the scene is normal use normal, if
dark use dark". The catalog's *scenes* are `bright`, `car_heater_on/off`, while
`normal` / `dark` are per-group **scene states** (`group_states: {"outdoor":
{"scene_id": "normal"}}`). If there is no DSL construct for "which scene state
is this group in", the model has nowhere to reach — that is a capability gap,
not a bug. Decide the phrasing/construct before asking the assistant to write
such routines.
