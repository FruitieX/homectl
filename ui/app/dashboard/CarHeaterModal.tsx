import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import {
  CarHeaterModalState,
  CarHeaterTimer,
  carModalDefaultState,
  useCarHeaterModalOpenState,
  useCarHeaterModalState,
} from '@/hooks/carHeaterModalState';
import { useDeviceState, useWebsocket } from '@/hooks/websocket';
import clsx from 'clsx';
import deepEqual from 'deep-equal';
import { produce } from 'immer';
import { Edit, Plus, Settings, Trash } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToggle } from 'usehooks-ts';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Separator } from '@/ui/primitives/separator';
import { Switch } from '@/ui/primitives/switch';

const carHeaterDeviceKey = 'tuya_devices/bfe553b84e883ace37nvxw';
const UnmemoizedCarHeaterModal = () => {
  const ws = useWebsocket();
  const carHeaterDevice = useDeviceState(carHeaterDeviceKey);
  const { state, toggleEnabled, storeState } = useCarHeaterModalState();

  const { open, setOpen } = useCarHeaterModalOpenState();
  const close = useCallback(() => setOpen(false), [setOpen]);

  const [formState, setFormState] =
    useState<CarHeaterModalState>(carModalDefaultState);

  const toggleHeater = useCallback(
    (power: boolean) => {
      if (carHeaterDevice) {
        const device = produce(carHeaterDevice, (draft) => {
          if ('Controllable' in draft.data) {
            draft.data.Controllable.state.power = power;
            draft.data.Controllable.scene_id = null;
          }
        });

        const msg: WebSocketRequest = {
          EventMessage: {
            SetInternalState: {
              device,
              skip_external_update: false,
              skip_db_update: null,
            },
          },
        };

        const data = JSON.stringify(msg);
        ws?.send(data);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carHeaterDevice?.id, ws],
  );
  // TODO: depends on outside temperature
  const warmupMinutes = 40;

  // Periodically check if the heater should be toggled
  const prevCheckTime = useRef(new Date());
  useEffect(() => {
    const timeout = setInterval(() => {
      const currentDate = new Date();

      state.timers.forEach((timer, index) => {
        const { enabled, repeat, hour, minute } = timer;
        if (!enabled) return;

        if (repeat === 'weekday') {
          const currentDate = new Date();
          // Sunday is 0, Saturday is 6
          if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            return;
          }
        }

        const timerOffDate = new Date();
        timerOffDate.setHours(hour, minute, 0, 0);

        const timerOnDate = new Date(
          timerOffDate.getTime() - warmupMinutes * 60 * 1000,
        );

        const shouldTurnOn =
          prevCheckTime.current <= timerOnDate && currentDate >= timerOnDate;

        const shouldTurnOff =
          prevCheckTime.current <= timerOffDate && currentDate >= timerOffDate;

        if (shouldTurnOn) {
          console.log('Turning heater on');
          toggleHeater(true);
        }

        if (shouldTurnOff) {
          console.log('Turning heater off');
          toggleHeater(false);

          if (repeat === 'once') {
            toggleEnabled(index, false);
          }
        }
      });

      prevCheckTime.current = currentDate;
    }, 1000);

    return () => clearInterval(timeout);
  }, [state, toggleEnabled, toggleHeater]);

  const openRef = useRef(open);
  useEffect(() => {
    if (openRef.current !== open) {
      openRef.current = open;

      if (open) {
        setFormState(state);
      }
    }
  }, [open, openRef, state, formState]);

  const submit = useCallback(
    (index: number, newState?: CarHeaterTimer) => {
      if (newState) {
        const combined = {
          timers: formState.timers.map((timer, i) =>
            i === index ? newState : timer,
          ),
        };
        setFormState(combined);
        storeState(combined);
      } else {
        storeState(formState);
      }
    },
    [formState, storeState],
  );

  const addTimer = () => {
    setFormState({
      ...formState,
      timers: [
        ...formState.timers,
        {
          enabled: false,
          name: `Timer ${formState.timers.length + 1}`,
          repeat: 'once',
          hour: new Date().getHours() + 2,
          minute: 0,
        },
      ],
    });
  };

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
      title="Car heater timer"
      description="Schedule the heater to warm the car before departure."
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3 px-5 pb-5 md:px-0 md:pb-0">
        {formState.timers.map((timer, index) => (
          <CarHeaterModalForm
            key={index}
            modalOpen={open}
            state={timer}
            storedState={state.timers[index]}
            setState={(index, state) => {
              setFormState({
                ...formState,
                timers: formState.timers.map((t, i) =>
                  i === index ? state : t,
                ),
              });
            }}
            remove={() =>
              setFormState({
                ...formState,
                timers: formState.timers.filter((_, i) => i !== index),
              })
            }
            index={index}
            submit={submit}
          />
        ))}
        <Button onClick={addTimer} className="w-full sm:w-fit">
          <Plus />
          Add timer
        </Button>
      </div>
    </ResponsiveOverlay>
  );
};

type CarHeaterModalFormProps = {
  state: CarHeaterTimer;
  storedState: CarHeaterTimer;
  setState: (index: number, state: CarHeaterTimer) => void;
  remove: (index: number) => void;
  index: number;
  submit: (index: number, state?: CarHeaterTimer) => void;
  modalOpen: boolean;
};

const CarHeaterModalForm = (props: CarHeaterModalFormProps) => {
  const { state, storedState, setState, remove, index, submit, modalOpen } =
    props;
  const { enabled, repeat, hour, minute, name } = state;

  const timerOffDate = new Date();
  timerOffDate.setHours(state?.hour, state?.minute, 0, 0);

  // TODO: depends on outside temperature
  const warmupMinutes = 40;
  const timerOnDate = new Date(
    timerOffDate.getTime() - warmupMinutes * 60 * 1000,
  );

  const [nameInput, setNameInput] = useState(state.name);
  const [renameActive, toggleRenameActive, setRenameActive] = useToggle(false);
  const openRef = useRef(modalOpen);

  useEffect(() => {
    if (openRef.current !== modalOpen && !modalOpen) {
      const trimmedName = nameInput.trim();
      const newState = { ...state, name: trimmedName };
      if (!deepEqual(newState, storedState)) {
        // console.log(`submitting ${index}`, newState);
        submit(index, newState);
        setNameInput(trimmedName);
        setRenameActive(false);
      }
    }
    openRef.current = modalOpen;
  }, [
    modalOpen,
    nameInput,
    state,
    storedState,
    index,
    setRenameActive,
    submit,
  ]);

  const [showSettings, toggleShowSettings] = useToggle(false);

  return (
    <details open={index === 0}>
      <summary
        className={clsx(
          'flex cursor-pointer list-none items-center justify-between rounded-3xl border border-border bg-card px-4 py-3 text-lg font-medium shadow-sm',
          !enabled && 'text-muted-foreground',
        )}
      >
        <span>
          {`${name}` +
            (enabled
              ? ` (${String(hour).padStart(2, '0')}:${String(minute).padStart(
                  2,
                  '0',
                )}, ${repeat === 'weekday' ? 'weekdays' : repeat})`
              : ' (inactive)')}
        </span>
        <Plus className="size-4" />
      </summary>
      <Card className="mt-2">
        <CardContent className="space-y-4 pt-5">
          <div className="text-sm text-muted-foreground">
            When do you need to leave?
          </div>
          <div className="flex flex-wrap justify-around gap-6 pb-2">
            <div className="grid gap-2 text-center">
              <Label>Hour</Label>
              <div className="flex">
                <Button
                  size="lg"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setState(index, {
                      ...state,
                      hour: Math.max(0, state.hour - 1),
                    })
                  }
                >
                  -
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-12 w-16 rounded-none text-center text-2xl"
                  value={String(state.hour).padStart(2, '0')}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;

                    if (isNaN(value)) {
                      return;
                    }

                    setState(index, {
                      ...state,
                      hour: event.currentTarget.valueAsNumber,
                    });
                  }}
                  min={0}
                  max={23}
                />
                <Button
                  size="lg"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setState(index, {
                      ...state,
                      hour: Math.min(23, state.hour + 1),
                    })
                  }
                >
                  +
                </Button>
              </div>
            </div>
            <div className="grid gap-2 text-center">
              <Label>Minute</Label>
              <div className="flex">
                <Button
                  size="lg"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setState(index, {
                      ...state,
                      minute: Math.max(0, state.minute - 5),
                    })
                  }
                >
                  -
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-12 w-16 rounded-none text-center text-2xl"
                  value={String(state.minute).padStart(2, '0')}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;

                    if (isNaN(value)) {
                      return;
                    }

                    setState(index, {
                      ...state,
                      minute: event.currentTarget.valueAsNumber,
                    });
                  }}
                  step={5}
                  min={0}
                  max={59}
                />
                <Button
                  size="lg"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setState(index, {
                      ...state,
                      minute: Math.min(55, state.minute + 5),
                    })
                  }
                >
                  +
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pb-3">
            <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-border p-3">
              <Label>Enabled</Label>
              <Switch
                checked={state.enabled}
                onCheckedChange={() =>
                  setState(index, { ...state, enabled: !state.enabled })
                }
              />
            </div>
            <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-border p-3">
              <Label>Repeat</Label>
              <div className="flex justify-center gap-1">
                <Button
                  type="button"
                  variant={state.repeat === 'once' ? 'default' : 'ghost'}
                  onClick={() => setState(index, { ...state, repeat: 'once' })}
                  size="sm"
                >
                  Once
                </Button>
                <Button
                  type="button"
                  variant={state.repeat === 'weekday' ? 'default' : 'ghost'}
                  onClick={() =>
                    setState(index, { ...state, repeat: 'weekday' })
                  }
                  size="sm"
                >
                  Weekdays
                </Button>
                <Button
                  type="button"
                  variant={state.repeat === 'daily' ? 'default' : 'ghost'}
                  onClick={() => setState(index, { ...state, repeat: 'daily' })}
                  size="sm"
                >
                  Daily
                </Button>
              </div>
            </div>
          </div>
          <Separator />
          {showSettings && (
            <div className="flex flex-wrap gap-3 py-3">
              {renameActive ? (
                <>
                  <Input
                    value={nameInput}
                    onChange={(event) =>
                      setNameInput(event.currentTarget.value)
                    }
                  />
                  <Button
                    onClick={() => {
                      setNameInput(state.name);
                      setRenameActive(false);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={toggleRenameActive} className="flex-1">
                    <Edit />
                    Rename
                  </Button>
                  <Button
                    onClick={() => remove(index)}
                    variant="destructive"
                    className="flex-1"
                  >
                    <Trash />
                    Delete
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
            <span>
              {state?.enabled
                ? `Heater will turn on at ${String(
                    timerOnDate.getHours(),
                  ).padStart(2, '0')}:${String(
                    timerOnDate.getMinutes(),
                  ).padStart(2, '0')}` +
                  (state?.repeat === 'once'
                    ? ''
                    : state?.repeat === 'weekday'
                      ? ' every weekday'
                      : ' daily')
                : 'Heater timer is off'}
            </span>
            <Button variant="ghost" size="icon" onClick={toggleShowSettings}>
              <Settings />
            </Button>
          </div>
        </CardContent>
      </Card>
    </details>
  );
};

export const CarHeaterModal = UnmemoizedCarHeaterModal;
