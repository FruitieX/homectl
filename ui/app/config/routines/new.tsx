import { ArrowRight, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  clearCreationDraft,
  describeDraftAge,
  loadCreationDraft,
  saveCreationDraft,
} from '@/lib/creationDraft';
import {
  WEEKDAY_LABELS,
  buildJourneyDefinition,
  describeExpected,
  describeFieldValue,
  describeFreshness,
  describeJourney,
  describeSchedule,
  deviceFieldOptions,
  emptyJourney,
  slugifyRoutineId,
  toCron,
  validateJourney,
  type JourneyContext,
  type JourneyDraft,
} from '@/lib/routineJourney';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';

/** The creation journey shows one decision at a time. */
type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: 'When it runs',
  2: 'What it does',
  3: 'Review',
};
import {
  useDeviceDisplayNames,
  useRoutines,
  useScenes,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { RoutineWhatIfPreview } from '@/ui/RoutineWhatIfPreview';
import { openAssistantPanelAtom } from '@/assistant/state';
import { useSetAtom } from 'jotai';
import { ConfigPageHeader } from '../page-header';
import { Advanced } from '@/ui/primitives/advanced';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Skeleton } from '@/ui/primitives/skeleton';
import { StatusRegion } from '@/ui/config/StatusRegion';
import { cn } from '@/lib/cn';

const INTENTS: {
  id: 'change' | 'schedule' | 'manual' | 'copy';
  title: string;
  description: string;
}[] = [
  {
    id: 'change',
    title: 'Something changes',
    description: 'A light, switch, or sensor reports a new value.',
  },
  {
    id: 'schedule',
    title: 'At a time of day',
    description: 'Run on chosen days at a local time.',
  },
  {
    id: 'manual',
    title: 'Only when you start it',
    description: 'Never on its own: you trigger it from the app.',
  },
  {
    id: 'copy',
    title: 'Copy an existing routine',
    description: 'Start from one that already works, then adjust it.',
  },
];

export default function NewRoutinePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: routines, create } = useRoutines();
  const { data: scenes, loading: scenesLoading } = useScenes();
  const devicesState = useDevicesState();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();

  // After a choice, the fields it reveals become the obvious next focus.
  const revealRef = useRef<HTMLDivElement | null>(null);
  const focusRevealed = () => {
    requestAnimationFrame(() => {
      const container = revealRef.current;
      if (!container) return;
      container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const field = container.querySelector<HTMLElement>(
        'input, select, textarea, button',
      );
      field?.focus({ preventScroll: true });
    });
  };
  const [draft, setDraft] = useState<JourneyDraft>(() => {
    const restored = loadCreationDraft<JourneyDraft>('routine');
    const presetScene = searchParams.get('scene');
    const base = restored?.payload
      ? { ...emptyJourney(), ...restored.payload }
      : emptyJourney();
    if (presetScene) {
      base.outcome = 'scene';
      base.sceneId = presetScene;
    }
    return base;
  });
  const [restoredAt, setRestoredAt] = useState<number | null>(() => {
    const restored = loadCreationDraft<JourneyDraft>('routine');
    return restored?.savedAt ?? null;
  });
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [deviceQuery, setDeviceQuery] = useState('');
  const [sceneQuery, setSceneQuery] = useState('');
  const [routineQuery, setRoutineQuery] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const openAssistant = useSetAtom(openAssistantPanelAtom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setRestoredNotice(restoredAt !== null && !searchParams.get('scene'));
  }, [restoredAt, searchParams]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const update = useCallback((patch: Partial<JourneyDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      saveCreationDraft('routine', next);
      return next;
    });
  }, []);

  const deviceDisplayNameMap = useMemo(
    () =>
      deviceDisplayNames.reduce<Record<string, string>>((names, row) => {
        names[row.device_key] = row.display_name;
        return names;
      }, {}),
    [deviceDisplayNames],
  );
  const labelFor = useCallback(
    (key: string) =>
      getDeviceDisplayLabelFromKey(
        key,
        devicesState?.[key]?.name ?? key,
        deviceDisplayNameMap,
      ),
    [deviceDisplayNameMap, devicesState],
  );

  const context: JourneyContext = useMemo(
    () => ({
      hasDevice: (key) => Boolean(devicesState?.[key]),
      hasScene: (id) => (scenes ?? []).some((scene) => scene.id === id),
      deviceLabel: labelFor,
      sceneLabel: (id) =>
        (scenes ?? []).find((scene) => scene.id === id)?.name ?? id,
      routineLabel: (id) =>
        (routines ?? []).find((routine) => routine.id === id)?.name ?? id,
    }),
    [devicesState, labelFor, routines, scenes],
  );

  const deviceEntries = useMemo(
    () =>
      Object.entries(devicesState ?? {})
        .map(([key, device]) => ({ key, label: labelFor(key), device }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [devicesState, labelFor],
  );
  const deviceSearch = deviceQuery.trim().toLowerCase();
  const matchingDevices = deviceEntries
    .filter(
      (entry) =>
        !deviceSearch ||
        `${entry.label} ${entry.key}`.toLowerCase().includes(deviceSearch),
    )
    .slice(0, 6);

  const fieldOptions = deviceFieldOptions(devicesState?.[draft.deviceKey]);
  const selectedField = fieldOptions.find(
    (option) => option.path === draft.fieldPath,
  );

  const sceneSearch = sceneQuery.trim().toLowerCase();
  const matchingScenes = (scenes ?? [])
    .filter(
      (scene) =>
        !sceneSearch ||
        `${scene.name} ${scene.id}`.toLowerCase().includes(sceneSearch),
    )
    .slice(0, 5);

  const missing = validateJourney(draft, context, (routineId) =>
    (routines ?? []).some((routine) => routine.id === routineId),
  );
  const effectiveName = draft.name;
  const effectiveId =
    draft.id.trim() || slugifyRoutineId(effectiveName || 'routine');
  const idTaken = (routines ?? []).some(
    (routine) => routine.id === effectiveId,
  );
  const sourceRoutine = (routines ?? []).find(
    (routine) => routine.id === draft.copyFromId,
  );
  const matchingRoutines = (routines ?? [])
    .filter((routine) => routine.id !== effectiveId)
    .filter((routine) => {
      const search = routineQuery.trim().toLowerCase();
      return (
        !search ||
        `${routine.name} ${routine.id}`.toLowerCase().includes(search)
      );
    })
    .slice(0, 6);
  const [step, setStep] = useState<Step>(1);
  // Continue only advances once the current step has an answer.
  const startIsValid =
    draft.intent !== '' && (draft.intent !== 'copy' || draft.copyFromId !== '');
  const errorStep: 'when' | 'then' | 'review' | null = error
    ? /scene/i.test(error)
      ? 'then'
      : /trigger|device|schedule|cron|condition|time|field/i.test(error)
        ? 'when'
        : 'review'
    : null;
  const reviewSentence = describeJourney(draft, context);

  const createRoutine = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const definition =
        draft.intent === 'copy' && sourceRoutine?.definition_v2
          ? sourceRoutine.definition_v2
          : buildJourneyDefinition(draft);
      // The server stores u64 durations as numbers; bigints never survive JSON.
      const serialized = JSON.parse(
        JSON.stringify(definition, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value,
        ),
      );
      await create({
        id: effectiveId,
        name: effectiveName.trim(),
        enabled: draft.enabled,
        semantics_version: 2,
        definition_v2: serialized,
        rules: [],
        actions: [],
      } as never);
      clearCreationDraft('routine');
      navigate(`/config/routines/${encodeURIComponent(effectiveId)}?created=1`);
      setStep(3);
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : 'Could not create the routine';
      setError(message);
      // Send the person to the step the server complained about.
      setStep(
        /scene/i.test(message)
          ? 2
          : /trigger|device|schedule|cron|condition|time|field/i.test(message)
            ? 1
            : 3,
      );
    } finally {
      setSaving(false);
    }
  };

  if (scenesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <ConfigPageHeader
        title="New routine"
        description="Describe what should start it and what it should do. The app writes the definition for you."
      />

      <nav className="flex items-center gap-2 text-xs" aria-label="Steps">
        <span className="font-medium text-foreground">Step {step} of 3</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="truncate text-muted-foreground">
          {STEP_LABELS[step]}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {([1, 2, 3] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Go to step ${value}: ${STEP_LABELS[value]}`}
              aria-current={step === value ? 'step' : undefined}
              onClick={() => setStep(value)}
              className={cn(
                'size-6 rounded-full border text-[11px] font-medium transition',
                step === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              {value}
            </button>
          ))}
        </span>
      </nav>

      {restoredNotice && restoredAt ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              Restored your unfinished routine from{' '}
              {describeDraftAge(restoredAt, now)}.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearCreationDraft('routine');
                setDraft(emptyJourney());
                setRestoredAt(null);
                setRestoredNotice(false);
              }}
            >
              Start over
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {searchParams.get('scene') ? (
        <Alert>
          <AlertDescription>
            The scene you just created is selected as the outcome below.
          </AlertDescription>
        </Alert>
      ) : null}

      {step === 1 ? (
        <>
          {/* 1. What should start it? */}
          <section
            className={cn(
              'space-y-3 rounded-2xl border border-border bg-background/70 p-4',
              errorStep === 'when' && 'ring-1 ring-destructive/50',
            )}
          >
            <h2 className="text-sm font-semibold">What should start this?</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {INTENTS.map((intent) => {
                const selected = draft.intent === intent.id;
                return (
                  <button
                    key={intent.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      update({ intent: intent.id });
                      focusRevealed();
                    }}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {intent.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {intent.description}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openAssistant({ kind: 'routine' })}
                className="rounded-xl border border-dashed border-border p-3 text-left transition-colors hover:border-primary/50"
              >
                <span className="block text-sm font-medium">
                  Describe it to the assistant
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Write what you want in your own words and let the assistant
                  draft it.
                </span>
              </button>
            </div>

            <div ref={revealRef} tabIndex={-1} className="outline-none">
              {errorStep === 'when' && error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    The server rejected the start above: {error}
                  </AlertDescription>
                </Alert>
              ) : null}

              {draft.intent === 'copy' ? (
                <div className="space-y-2 border-t border-border pt-3">
                  {draft.copyFromId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {sourceRoutine?.name ?? draft.copyFromId}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {sourceRoutine?.enabled
                          ? 'Enabled today'
                          : 'Disabled today'}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update({ copyFromId: '', name: '' })}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        aria-label="Search routines to copy"
                        placeholder="Search routines"
                        value={routineQuery}
                        onChange={(event) =>
                          setRoutineQuery(event.target.value)
                        }
                      />
                      <ul className="space-y-1">
                        {matchingRoutines.map((routine) => (
                          <li key={routine.id}>
                            <button
                              type="button"
                              onClick={() =>
                                update({
                                  copyFromId: routine.id,
                                  name: `${routine.name} copy`,
                                })
                              }
                              className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/50"
                            >
                              <span className="truncate">{routine.name}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {routine.id}
                              </span>
                            </button>
                          </li>
                        ))}
                        {matchingRoutines.length === 0 ? (
                          <li className="text-sm text-muted-foreground">
                            No routines match that search.
                          </li>
                        ) : null}
                      </ul>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    A copy keeps the source routine&apos;s start and actions
                    exactly as they are, including any advanced parts this page
                    does not show. Edit them afterwards on the routine page.
                  </p>
                </div>
              ) : null}

              {draft.intent === 'change' ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Device</span>
                    {draft.deviceKey ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {labelFor(draft.deviceKey)}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">
                          {draft.deviceKey}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update({ deviceKey: '', fieldPath: '' })
                          }
                        >
                          Change
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          aria-label="Search devices"
                          placeholder="Search devices by name or id"
                          value={deviceQuery}
                          onChange={(event) =>
                            setDeviceQuery(event.target.value)
                          }
                        />
                        <ul className="space-y-1">
                          {matchingDevices.map((entry) => {
                            const options = deviceFieldOptions(entry.device);
                            return (
                              <li key={entry.key}>
                                <button
                                  type="button"
                                  disabled={options.length === 0}
                                  onClick={() =>
                                    update({
                                      deviceKey: entry.key,
                                      fieldPath: options[0]?.path ?? '',
                                      fieldKind: options[0]?.kind ?? 'boolean',
                                      value:
                                        options[0]?.kind === 'boolean'
                                          ? 'true'
                                          : '',
                                      anyValue: false,
                                    })
                                  }
                                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/50 disabled:opacity-50"
                                >
                                  <span className="truncate">
                                    {entry.label}
                                  </span>
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {options.length === 0
                                      ? 'no reported values'
                                      : options
                                          .map((option) => option.label)
                                          .join(', ')}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                          {matchingDevices.length === 0 ? (
                            <li className="text-sm text-muted-foreground">
                              No devices match that search.
                            </li>
                          ) : null}
                        </ul>
                      </>
                    )}
                  </div>

                  {draft.deviceKey && fieldOptions.length > 0 ? (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">
                        Value to watch
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {fieldOptions.map((option) => (
                          <button
                            key={option.path}
                            type="button"
                            aria-pressed={draft.fieldPath === option.path}
                            onClick={() =>
                              update({
                                fieldPath: option.path,
                                fieldKind: option.kind,
                                value: option.kind === 'boolean' ? 'true' : '',
                              })
                            }
                            className={cn(
                              'rounded-lg border px-2.5 py-1 text-xs',
                              draft.fieldPath === option.path
                                ? 'border-primary bg-primary/5'
                                : 'border-border',
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {selectedField ? (
                        <p className="text-xs text-muted-foreground">
                          Current value:{' '}
                          {describeFieldValue(selectedField) ?? 'not reported'}
                          {selectedField.updatedAt
                            ? ` · updated ${describeFreshness(selectedField.updatedAt, now)}`
                            : ''}
                          . Recent changes are not stored for this device, so no
                          history is shown.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {draft.deviceKey && draft.fieldPath ? (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">
                        When should it start?
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-pressed={draft.anyValue}
                          onClick={() => update({ anyValue: true })}
                          className={cn(
                            'rounded-lg border px-2.5 py-1 text-xs',
                            draft.anyValue
                              ? 'border-primary bg-primary/5'
                              : 'border-border',
                          )}
                        >
                          Any change
                        </button>
                        <button
                          type="button"
                          aria-pressed={!draft.anyValue}
                          onClick={() => update({ anyValue: false })}
                          className={cn(
                            'rounded-lg border px-2.5 py-1 text-xs',
                            !draft.anyValue
                              ? 'border-primary bg-primary/5'
                              : 'border-border',
                          )}
                        >
                          A specific value
                        </button>
                      </div>
                      {!draft.anyValue ? (
                        draft.fieldKind === 'boolean' ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              aria-pressed={draft.value === 'true'}
                              onClick={() => update({ value: 'true' })}
                              className={cn(
                                'rounded-lg border px-2.5 py-1 text-xs',
                                draft.value === 'true'
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border',
                              )}
                            >
                              Turns on
                            </button>
                            <button
                              type="button"
                              aria-pressed={draft.value === 'false'}
                              onClick={() => update({ value: 'false' })}
                              className={cn(
                                'rounded-lg border px-2.5 py-1 text-xs',
                                draft.value === 'false'
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border',
                              )}
                            >
                              Turns off
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {draft.fieldKind === 'number' ? (
                              <select
                                aria-label="Comparison"
                                className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
                                value={draft.operator}
                                onChange={(event) =>
                                  update({
                                    operator: event.target
                                      .value as JourneyDraft['operator'],
                                  })
                                }
                              >
                                <option value="eq">is exactly</option>
                                <option value="gt">is above</option>
                                <option value="lt">is below</option>
                                <option value="ne">is not</option>
                              </select>
                            ) : null}
                            <Input
                              aria-label="Expected value"
                              className="max-w-40"
                              value={draft.value}
                              onChange={(event) =>
                                update({ value: event.target.value })
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              {describeExpected(draft)}
                            </span>
                          </div>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {draft.intent === 'schedule' ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Time of day</span>
                    <Input
                      type="time"
                      className="max-w-40"
                      aria-label="Time of day"
                      value={draft.time}
                      onChange={(event) => update({ time: event.target.value })}
                    />
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">Days</span>
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAY_LABELS.map((label, index) => {
                        const selected = draft.days.includes(index);
                        return (
                          <button
                            key={`${label}-${index}`}
                            type="button"
                            aria-pressed={selected}
                            aria-label={
                              [
                                'Sunday',
                                'Monday',
                                'Tuesday',
                                'Wednesday',
                                'Thursday',
                                'Friday',
                                'Saturday',
                              ][index]
                            }
                            onClick={() =>
                              update({
                                days: selected
                                  ? draft.days.filter((day) => day !== index)
                                  : [...draft.days, index],
                              })
                            }
                            className={cn(
                              'size-8 rounded-lg border text-xs',
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {describeSchedule(draft.time, draft.days)}
                    {toCron(draft.time, draft.days) ? (
                      <>
                        {' '}
                        · engine expression{' '}
                        <span className="font-mono">
                          {toCron(draft.time, draft.days)}
                        </span>{' '}
                        (times are
                        {` ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Helsinki'}`}
                        )
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}

              {draft.intent === 'change' ? (
                <Advanced
                  label="Extra conditions"
                  description="Narrow the trigger further."
                >
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">
                      Only if it stays this way for (minutes)
                    </span>
                    <Input
                      className="max-w-32"
                      inputMode="numeric"
                      placeholder="e.g. 5"
                      value={draft.forMinutes}
                      onChange={(event) =>
                        update({ forMinutes: event.target.value })
                      }
                    />
                    <span className="block text-xs text-muted-foreground">
                      Leave empty to run as soon as the change is reported.
                    </span>
                  </label>
                </Advanced>
              ) : null}
            </div>
          </section>
          {step === 1 ? (
            <div className="flex items-center justify-between gap-2">
              {step > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep((step - 1) as Step)}
                >
                  Back
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                {step === 1 && !startIsValid ? (
                  <span className="text-xs text-muted-foreground">
                    Choose what should start it to continue.
                  </span>
                ) : null}
                <Button
                  size="sm"
                  disabled={step === 1 && !startIsValid}
                  onClick={() => setStep((step + 1) as Step)}
                >
                  Continue
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          {/* 2. What should happen? */}
          <section
            className={cn(
              'space-y-3 rounded-2xl border border-border bg-background/70 p-4',
              errorStep === 'then' && 'ring-1 ring-destructive/50',
            )}
          >
            <h2 className="text-sm font-semibold">What should happen?</h2>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'scene', label: 'Activate a scene' },
                  { id: 'power_on', label: 'Turn a device on' },
                  { id: 'power_off', label: 'Turn a device off' },
                ] as const
              ).map((outcome) => (
                <button
                  key={outcome.id}
                  type="button"
                  aria-pressed={draft.outcome === outcome.id}
                  onClick={() => update({ outcome: outcome.id })}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs',
                    draft.outcome === outcome.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border',
                  )}
                >
                  {outcome.label}
                </button>
              ))}
            </div>

            {errorStep === 'then' && error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  The server rejected the action above: {error}
                </AlertDescription>
              </Alert>
            ) : null}

            {draft.outcome === 'scene' ? (
              <div className="space-y-2 border-t border-border pt-3">
                {draft.sceneId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {(scenes ?? []).find(
                        (scene) => scene.id === draft.sceneId,
                      )?.name ?? draft.sceneId}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update({ sceneId: '' })}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      aria-label="Search scenes"
                      placeholder="Search scenes"
                      value={sceneQuery}
                      onChange={(event) => setSceneQuery(event.target.value)}
                    />
                    <ul className="space-y-1">
                      {matchingScenes.map((scene) => (
                        <li key={scene.id}>
                          <button
                            type="button"
                            onClick={() => update({ sceneId: scene.id })}
                            className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/50"
                          >
                            <span className="truncate">{scene.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {scene.id}
                            </span>
                          </button>
                        </li>
                      ))}
                      {matchingScenes.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                          No scenes match that search.
                        </li>
                      ) : null}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Nothing there yet?{' '}
                      <Link
                        className="underline"
                        to="/config/scenes/new"
                        onClick={() => saveCreationDraft('routine', draft)}
                      >
                        Create a scene
                      </Link>{' '}
                      and come back: your routine draft is kept, and the new
                      scene is selected automatically.
                    </p>
                  </>
                )}
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    Only on these devices (optional)
                  </span>
                  <select
                    aria-label="Scene target device"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    value={draft.actionDeviceKey}
                    onChange={(event) =>
                      update({ actionDeviceKey: event.target.value })
                    }
                  >
                    <option value="">The scene&apos;s own targets</option>
                    {deviceEntries.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">
                    Leave as the scene&apos;s own targets unless this routine
                    should only affect one device.
                  </span>
                </label>
              </div>
            ) : null}

            {draft.outcome === 'power_on' || draft.outcome === 'power_off' ? (
              <div className="space-y-2 border-t border-border pt-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Device</span>
                  <select
                    aria-label="Action device"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    value={draft.actionDeviceKey || draft.deviceKey}
                    onChange={(event) =>
                      update({ actionDeviceKey: event.target.value })
                    }
                  >
                    <option value="">Choose a device…</option>
                    {deviceEntries.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>
          {step === 2 ? (
            <div className="flex items-center justify-between gap-2">
              {step > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep((step - 1) as Step)}
                >
                  Back
                </Button>
              ) : (
                <span />
              )}
              <Button size="sm" onClick={() => setStep((step + 1) as Step)}>
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 3 ? (
        <>
          {/* 3. Review */}
          <section className="space-y-3 rounded-2xl border border-border bg-background/70 p-4">
            <h2 className="text-sm font-semibold">Review</h2>
            <p className="text-sm">{reviewSentence}</p>
            <p className="text-xs text-muted-foreground">
              This routine runs only when the start above matches. Activating a
              scene can change every device that scene targets.
            </p>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={draft.name}
                placeholder="Evening lights"
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Details
              </summary>
              <label className="mt-3 block space-y-1.5">
                <span className="text-sm font-medium">ID</span>
                <Input
                  className="font-mono"
                  value={effectiveId}
                  onChange={(event) => update({ id: event.target.value })}
                />
                <span className="block text-xs text-muted-foreground">
                  {idTaken
                    ? 'That id is already used by another routine.'
                    : 'Used by routines, scenes, and links.'}
                </span>
              </label>
            </details>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                This routine will start running when you create it.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={draft.enabled}
                  onChange={(event) =>
                    update({ enabled: event.target.checked })
                  }
                />
                <span className="text-muted-foreground">
                  Enable it right after creating
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                {draft.enabled
                  ? 'Enabled by default. Uncheck to save it off instead; nothing runs until you enable it later.'
                  : 'Saved off: it will not react until you enable it on the routine page.'}
              </p>
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={missing.length > 0}
                aria-expanded={showPreview}
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview ? 'Hide preview' : 'Preview what it would do now'}
              </Button>
              {showPreview && devicesState ? (
                <RoutineWhatIfPreview
                  definition={
                    draft.intent === 'copy' && sourceRoutine?.definition_v2
                      ? sourceRoutine.definition_v2
                      : buildJourneyDefinition(draft)
                  }
                  devices={devicesState}
                />
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {missing.length > 0 ? (
        <Alert>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-1">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <StatusRegion message={status} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={saving || missing.length > 0 || idTaken}
          onClick={() => void createRoutine()}
        >
          {saving ? 'Creating…' : 'Create routine'}
        </Button>
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => navigate('/config/routines')}
        >
          Cancel
        </Button>
        <Link className="text-xs underline" to="/config/routines">
          Back to routines
        </Link>
      </div>
    </div>
  );
}
