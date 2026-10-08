import { toast } from 'sonner';

/**
 * Confirms a change with an Undo action instead of asking up front. `undo`
 * should write through the normal API path, so it is validated and recorded
 * like any other edit.
 */
export function offerUndo(
  message: string,
  undo: () => Promise<unknown>,
  restoredMessage = 'Change undone',
) {
  toast.success(message, {
    duration: 10000,
    action: {
      label: 'Undo',
      onClick: () => {
        undo().then(
          () => toast.success(restoredMessage),
          (error: unknown) =>
            toast.error(
              error instanceof Error ? error.message : 'Could not undo.',
            ),
        );
      },
    },
  });
}

/** A saved row as a create request: the server issues a fresh revision. */
export function asNewItem<T extends object>(item: T): T {
  const { revision_token: _revision, ...rest } = item as T & {
    revision_token?: unknown;
  };
  return rest as T;
}
