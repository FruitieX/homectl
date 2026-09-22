import { type ReactNode, useEffect, useState } from 'react';

import { buttonVariants } from '@/ui/primitives/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/primitives/alert-dialog';

export type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void;
};

let currentRequest: ConfirmRequest | null = null;
let publish: ((request: ConfirmRequest | null) => void) | null = null;

function setRequest(request: ConfirmRequest | null) {
  currentRequest = request;
  publish?.(request);
}

/**
 * Imperative replacement for window.confirm() that renders a themed,
 * accessible AlertDialog. Resolves true when the user confirms.
 *
 * Uses a module-level subscription rather than a jotai atom: the app is
 * wrapped in a Jotai `Provider`, so writing through `getDefaultStore()`
 * would never reach the host component.
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setRequest({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [request, setRequestState] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    publish = setRequestState;
    if (currentRequest) {
      setRequestState(currentRequest);
    }
    return () => {
      publish = null;
    };
  }, []);

  const settle = (confirmed: boolean) => {
    currentRequest?.resolve(confirmed);
    setRequest(null);
  };

  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description ? (
            <AlertDialogDescription>
              {request.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {request?.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            className={
              request?.destructive
                ? buttonVariants({ variant: 'destructive' })
                : undefined
            }
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function confirmDestructive(
  title: ReactNode,
  description?: ReactNode,
  confirmLabel = 'Delete',
): Promise<boolean> {
  return confirmDialog({ title, description, confirmLabel, destructive: true });
}
