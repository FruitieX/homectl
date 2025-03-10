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
import {
  Accordion,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Toggle,
} from 'react-daisyui';
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
        <div className="flex gap-6 pt-3 pb-6 flex-wrap justify-around">
          <Form>
            <Form.Label className="text-center">
              <span className="label-text">Hour</span>
            </Form.Label>
            <div className="flex">
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
                size="lg"
                className="w-14 text-2xl text-center"
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
                className="border-zinc-700"
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
          </Form>
          <Form>
            <Form.Label className="text-center">
              <span className="label-text">Minute</span>
            </Form.Label>
            <div className="flex">
              <Button
                size="lg"
                variant="outline"
                className="border-zinc-700"
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
                size="lg"
                className="w-14 text-2xl text-center"
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
                className="border-zinc-700"
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
          </Form>
        </div>
        <div className="flex gap-6 flex-wrap pb-3">
          <Form className="flex flex-1 flex-col">
            <Form.Label title="Enabled" className="flex-col">
              <Toggle
                checked={state.enabled}
                className="flex-1"
                onChange={() =>
                  setState(index, { ...state, enabled: !state.enabled })
                }
                size="lg"
              />
            </Form.Label>
          </Form>
          <Form className="flex flex-1 flex-col">
            <Form.Label title="Repeat" className="flex-col w-full pb-1" />
            <div className="flex justify-center w-full">
              <Button
                type="button"
                color={state.repeat === 'once' ? 'primary' : 'ghost'}
                onClick={() => setState(index, { ...state, repeat: 'once' })}
                size="sm"
              >
                Once
              </Button>
              <Button
                type="button"
                color={state.repeat === 'weekday' ? 'primary' : 'ghost'}
                onClick={() => setState(index, { ...state, repeat: 'weekday' })}
                size="sm"
              >
                Weekdays
              </Button>
              <Button
                type="button"
                color={state.repeat === 'daily' ? 'primary' : 'ghost'}
                onClick={() => setState(index, { ...state, repeat: 'daily' })}
                size="sm"
              >
                Daily
              </Button>
            </div>
          </Form>
        </div>
        <Divider className="my-0" />
        {showSettings && (
          <>
            <div className="flex py-3 gap-3 flex-wrap">
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
                  <Button
                    onClick={toggleRenameActive}
                    startIcon={<Edit />}
                    className="flex-1"
                  >
                    Rename
                  </Button>
                  <Button
                    onClick={() => remove(index)}
                    startIcon={<Trash />}
                    color="error"
                    className="flex-1"
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </>
        )}
        <div className="pt-3 flex justify-between items-center">
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
            className="bg-transparent border-transparent"
            onClick={toggleShowSettings}
            startIcon={<Settings />}
            color="ghost"
          />
        </div>
      </Accordion.Content>
    </Accordion>
  );
};

export const CarHeaterModal = memo(UnmemoizedCarHeaterModal);
