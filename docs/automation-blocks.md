# Reusable automation blocks

Blocks are user-managed definitions under **Settings → Blocks**. An action block
contains ordered native actions; a condition block contains a predicate. Define
typed inputs, build the behavior using the routine editors, and bind fields to
inputs. Callers select a block and supply arguments or use its defaults. An
independent copy has its own definition and callers.

Calls expand when the routine compiles. Conditions participate in the same
three-valued evaluation as native predicates, and actions run in the calling
routine's frame, trigger context, execution policy and effect planner. They do
not launch another routine. Nested calls are supported; recursion is rejected.

Edits revalidate all affected enabled routines before taking effect. Their
revisions advance, invalidating queued work and captured timers from the older
definition. The block and caller revisions are persisted together. A block with
callers cannot be deleted. The editor retains drafts and reports concurrent
changes rather than silently overwriting them.

Blocks support group, scene, helper, device, target selection, rollout, boolean,
number, duration, string and enum inputs. Rollout arguments can be `null` for
simultaneous application or a spatial rollout object. A whole value is bound
using `{"$input":"name"}`; strings and script source are never interpolated.
Block inputs are validated against the configuration catalog as well as their
value types. A required helper input acquires its concrete helper type from the
caller, where writes receive normal helper-value validation.

The initial implementation keeps blocks stateless: timer operations, scripts
and invoking other routines stay in the calling routine. Helpers can be read
and written explicitly. Existing scripts remain available for custom behavior.
A block is limited to 16 inputs, 64 KiB, and 8 nested calls. Expanded definitions
also obey the existing routine action, condition, and branch-depth bounds. An
action call occupies one native branch node in addition to its expanded body;
plan node IDs include the call site and block revision.

Definitions live in the database and are included in exports as a default-empty
`blocks` collection. JSON restore/import persists that collection; older backups
omit it and restore an empty collection. Bootstrap TOML is unchanged.

API: `GET /api/v1/config/blocks`, `PUT /api/v1/config/blocks/{id}`, and
`DELETE /api/v1/config/blocks/{id}`. Saves accept `expected` for optimistic
concurrency or `create_only: true` for creation, alongside the block document.

For current JavaScript support and proposed scripted blocks/shared functions,
see [JavaScript reuse](javascript-reuse.md).
