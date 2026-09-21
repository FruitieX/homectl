import { atom, getDefaultStore, useAtom } from 'jotai';
import { type ReactNode } from 'react';

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

const confirmRequestAtom = atom<ConfirmRequest | null>(null);

/**
 * Imperative replacement for window.confirm() that renders a themed,
 * accessible AlertDialog. Resolves true when the user confirms.
 */
export function confirmDialog(
  options: ConfirmDialogOptions,
): Promise<boolean> {
  const store = getDefaultStore();
  return new Promise<boolean>((resolve) => {
    store.set(confirmRequestAtom, { ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [request, setRequest] = useAtom(confirmRequestAtom);

  const settle = (confirmed: boolean) => {
    request?.resolve(confirmed);
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
