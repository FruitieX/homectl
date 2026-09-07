import type { DeviceCommand } from '@/bindings/DeviceCommand';
import type { DeviceCommandResult } from '@/bindings/DeviceCommandResult';
import type { SceneCommand } from '@/bindings/SceneCommand';
import type { SceneCommandResult } from '@/bindings/SceneCommandResult';
import type { WebSocketRequest } from '@/bindings/WebSocketRequest';

type CommandKind = 'device' | 'scene';
const pending = new Map<
  string,
  { socket: WebSocket; kind: CommandKind; finish: (error?: string) => void }
>();

function sendCommand(
  socket: WebSocket,
  requestId: string,
  kind: CommandKind,
  message: WebSocketRequest,
): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN)
    return Promise.reject(
      new Error('Not connected. Try again when the connection returns.'),
    );
  if (pending.has(requestId))
    return Promise.reject(new Error('This command is already pending.'));
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timeout);
      pending.delete(requestId);
      if (error) reject(new Error(error));
      else resolve();
    };
    const timeout = setTimeout(
      () =>
        finish(
          'No runtime confirmation received. Devices may have changed; check their state before trying again.',
        ),
      10000,
    );
    pending.set(requestId, { socket, kind, finish });
    try {
      socket.send(JSON.stringify(message));
    } catch {
      finish(`Could not send the ${kind} change.`);
    }
  });
}

export function sendDeviceCommand(
  socket: WebSocket,
  command: DeviceCommand,
): Promise<void> {
  return sendCommand(socket, command.request_id, 'device', {
    DeviceCommand: command,
  });
}
export function sendSceneCommand(
  socket: WebSocket,
  command: SceneCommand,
): Promise<void> {
  return sendCommand(socket, command.request_id, 'scene', {
    SceneCommand: command,
  });
}
function receiveResult(
  socket: WebSocket,
  result: DeviceCommandResult | SceneCommandResult,
  kind: CommandKind,
) {
  const entry = pending.get(result.request_id);
  if (entry?.socket === socket && entry.kind === kind)
    entry.finish(
      result.applied
        ? undefined
        : (result.error ?? `The ${kind} change was rejected.`),
    );
}
export function receiveDeviceCommandResult(
  socket: WebSocket,
  result: DeviceCommandResult,
) {
  receiveResult(socket, result, 'device');
}
export function receiveSceneCommandResult(
  socket: WebSocket,
  result: SceneCommandResult,
) {
  receiveResult(socket, result, 'scene');
}
export function disconnectDeviceCommands(socket: WebSocket) {
  for (const entry of pending.values()) {
    if (entry.socket === socket)
      entry.finish(
        'Connection lost before runtime confirmation. Check device states after reconnecting.',
      );
  }
}
