import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import {
  CarHeaterModalState,
  CarHeaterTimer,
  carModalDefaultState,
  useCarHeaterModalOpenState,
  useCarHeaterModalState,
} from '@/hooks/carHeaterModalState';
import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import clsx from 'clsx';
import deepEqual from 'deep-equal';
import { produce } from 'immer';
import { Edit, Settings, Trash, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Accordion, Button, Input, Modal, Tabs, Toggle } from 'react-daisyui';
import { useToggle } from 'usehooks-ts';

const carHeaterDeviceKey = 'tuya_devices/bfe553b84e883ace37nvxw';
const UnmemoizedCarHeaterModal = () => {
  const ws = useWebsocket();
  const appState = useWebsocketState();
  const { state, toggleEnabled, storeState } = useCarHeaterModalState();

  const { open, setOpen } = useCarHeaterModalOpenState();
  const close = useCallback(() => setOpen(false), [setOpen]);

  const carHeaterDevice = appState?.devices[carHeaterDeviceKey];

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
    <Modal.Legacy
      responsive
      open={open}
      onClickBackdrop={close}
      className="pt-0"
    >
      <Button
        size="sm"
        shape="circle"
        className="absolute right-2 top-2"
        onClick={close}
      >
        ✕
      </Button>
      <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 z-10 bg-base-100 bg-opacity-75 backdrop-blur">
        <div className="flex items-center justify-between font-bold">
          <div className="mx-4 text-center">Car heater timer</div>
          <Button onClick={close} variant="outline">
            <X />
          </Button>
        </div>
      </Modal.Header>
      {
        <div className="flex flex-wrap gap-3">
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
          <Button onClick={addTimer}>Add timer</Button>
        </div>
      }
    </Modal.Legacy>
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
    <Accordion defaultChecked={index === 0} icon="plus" className="bg-base-200">
      <Accordion.Title
        className={clsx('text-xl font-medium', !enabled && 'text-neutral-500')}
      >
        {`${name}` +
          (enabled
            ? ` (${String(hour).padStart(2, '0')}:${String(minute).padStart(
                2,
                '0',
              )}, ${repeat === 'weekday' ? 'weekdays' : repeat})`
            : ' (inactive)')}
      </Accordion.Title>
      <Accordion.Content>
        <div>When do you need to leave?</div>
        <div className="flex gap-6 pt-3 pb-6 flex-wrap">
          <div className="form-control">
            <label className="text-center">
              <span className="label-text">Hour</span>
            </label>
            <div className="flex">
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
                size="lg"
                className="w-20 text-2xl"
                value={String(state.hour).padStart(2, '0')}
                onChange={(event) =>
                  setState(index, {
                    ...state,
                    hour: event.currentTarget.valueAsNumber,
                  })
                }
                min={0}
                max={23}
              />
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
          <div className="form-control">
            <label className="text-center">
              <span className="label-text">Minute</span>
            </label>
            <div className="flex">
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
                size="lg"
                className="w-20 text-2xl"
                value={String(state.minute).padStart(2, '0')}
                onChange={(event) =>
                  setState(index, {
                    ...state,
                    minute: event.currentTarget.valueAsNumber,
                  })
                }
                step={5}
                min={0}
                max={59}
              />
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
        <div className="flex gap-6 flex-wrap">
          <div className="form-control pr-6">
            <label className="pb-1">Enabled</label>
            <Toggle
              checked={state.enabled}
              onChange={() =>
                setState(index, { ...state, enabled: !state.enabled })
              }
              size="lg"
            />
          </div>
          <div className="form-control">
            <label>Repeat</label>
            <Tabs variant="boxed">
              <Tabs.Tab
                active={state.repeat === 'once'}
                onClick={() => setState(index, { ...state, repeat: 'once' })}
              >
                Once
              </Tabs.Tab>
              <Tabs.Tab
                active={state.repeat === 'weekday'}
                onClick={() => setState(index, { ...state, repeat: 'weekday' })}
              >
                Weekdays
              </Tabs.Tab>
              <Tabs.Tab
                active={state.repeat === 'daily'}
                onClick={() => setState(index, { ...state, repeat: 'daily' })}
              >
                Daily
              </Tabs.Tab>
            </Tabs>
          </div>
        </div>
        {showSettings && (
          <>
            <div className="flex pt-6 gap-3 flex-wrap">
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
                  <Button onClick={toggleRenameActive} startIcon={<Edit />}>
                    Rename
                  </Button>
                  <Button
                    onClick={() => remove(index)}
                    startIcon={<Trash />}
                    color="error"
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </>
        )}
        <div className="pt-3">
          {state?.enabled
            ? `Heater will turn on at ${String(timerOnDate.getHours()).padStart(
                2,
                '0',
              )}:${String(timerOnDate.getMinutes()).padStart(2, '0')}` +
              (state?.repeat === 'once'
                ? ''
                : state?.repeat === 'weekday'
                  ? ' every weekday'
                  : ' daily')
            : 'Heater timer is off'}
          <Button
            className="absolute bottom-0 right-0 bg-transparent border-transparent"
            onClick={toggleShowSettings}
            startIcon={<Settings />}
          />
        </div>
      </Accordion.Content>
    </Accordion>
  );
};

export const CarHeaterModal = memo(UnmemoizedCarHeaterModal);
