# Routine script scene rollouts

A v2 routine script can return an `activateScene` action with a spatial rollout:

```javascript
return {
  actions: [api.actions.activateScene({
    scene: "normal",
    targets: { groups: ["hall"] },
    rollout: {
      style: "spatial",
      source: { kind: "triggering_device" },
      durationMs: 1500,
    },
  })],
};
```

`source` may instead be `{ kind: "device", device: { integration_id, device_id } }` for a fixed origin. The triggering device is captured when the routine matches, so an asynchronous script result still uses the original button or sensor. If no device triggered the run, the rollout has no spatial origin and the scene applies immediately. `durationMs` follows the same bounds as native routine rollouts.

Script actions use the native scene planner after the worker returns. The rollout changes dispatch timing; scene targets and intent guards use the usual routine behavior.

## Reusable code

Routine programs and script steps can select shared function blocks and call
`api.functions.call(id, { namedInputs })`. JavaScript action blocks remain
named nodes in a native flow. JavaScript condition blocks work in filters and
choose branches; computed helpers expose derived state to native triggers and
widgets. See [JavaScript reuse](javascript-reuse.md) for contracts, examples,
previews and freshness behavior.
