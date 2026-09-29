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
