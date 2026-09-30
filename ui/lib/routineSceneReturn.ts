/** Select a newly created scene only in schema-defined native action blocks.
 * Script/condition/extension payloads can contain lookalike objects and are opaque. */
export function applyCreatedScene<T>(
  definition: T,
  nodeId: string,
  sceneId: string,
): {
  definition: T;
  applied: boolean;
} {
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  let applied = false;
  const updateSteps = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const next = value.map((item) => {
      const step = object(item);
      if (!step || applied) return item;
      if (step.id === nodeId && step.action === 'activate_scene') {
        applied = changed = true;
        const { select: _selection, ...rest } = step;
        return { ...rest, scene_id: sceneId };
      }
      if (step.action !== 'choose' || !Array.isArray(step.branches))
        return item;
      let branchChanged = false;
      const branches = step.branches.map((item) => {
        const branch = object(item);
        if (!branch) return item;
        const steps = updateSteps(branch.steps);
        if (steps === branch.steps) return item;
        branchChanged = true;
        return { ...branch, steps };
      });
      if (!branchChanged) return item;
      changed = true;
      return { ...step, branches };
    });
    return changed ? next : value;
  };
  const body = object(definition),
    program = object(body?.program);
  if (!body || program?.kind !== 'native')
    return { definition, applied: false };
  const steps = updateSteps(program.steps);
  return {
    definition:
      steps === program.steps
        ? definition
        : ({ ...body, program: { ...program, steps } } as T),
    applied,
  };
}
