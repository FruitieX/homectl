import type { DeviceCommand } from '@/bindings/DeviceCommand';
import type { DeviceCommandResult } from '@/bindings/DeviceCommandResult';

const pending = new Map<
  string,
  { socket: WebSocket; finish: (error?: string) => void }
>();

export function sendDeviceCommand(
  socket: WebSocket,
  command: DeviceCommand,
): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN)
    return Promise.reject(
      new Error('Not connected. Try again when the connection returns.'),
    );
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timeout);
      pending.delete(command.request_id);
      if (error) reject(new Error(error));
      else resolve();
    };
    const timeout = setTimeout(
      () =>
        finish(
          'No runtime confirmation received. The device may have changed; check its state before trying again.',
        ),
      10000,
    );
    pending.set(command.request_id, { socket, finish });
    try {
      socket.send(JSON.stringify({ DeviceCommand: command }));
    } catch {
      finish('Could not send the device change.');
    }
  });
}

export function receiveDeviceCommandResult(
  socket: WebSocket,
  result: DeviceCommandResult,
) {
  const entry = pending.get(result.request_id);
  if (entry?.socket === socket)
    entry.finish(
      result.applied
        ? undefined
        : (result.error ?? 'The device change was rejected.'),
    );
}

export function disconnectDeviceCommands(socket: WebSocket) {
  for (const entry of pending.values()) {
    if (entry.socket === socket)
      entry.finish(
        'Connection lost before runtime confirmation. Check the device state after reconnecting.',
      );
  }
}
