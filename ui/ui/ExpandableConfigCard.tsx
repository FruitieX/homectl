'use client';

import {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useEffect,
} from 'react';

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  summary: ReactNode;
  dialogTitle: ReactNode;
  dialogSubtitle?: ReactNode;
  dialogBoxClassName?: string;
  cardClassName?: string;
  children: ReactNode;
};

export function ExpandableConfigCard({
  open,
  onOpen,
  onClose,
  summary,
  dialogTitle,
  dialogSubtitle,
  dialogBoxClassName,
  cardClassName,
  children,
}: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLFormElement>) => {
    event.preventDefault();
    onClose();
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={handleCardKeyDown}
        className={`card bg-base-200 shadow-xl cursor-pointer transition hover:shadow-2xl focus:outline-none focus-visible:ring focus-visible:ring-primary ${cardClassName ?? ''}`}
      >
        <div className="card-body p-6">{summary}</div>
      </div>

      {open && (
        <dialog className="modal modal-open">
          <div
            className={`modal-box w-11/12 max-w-5xl ${dialogBoxClassName ?? ''}`}
          >
            <button
              type="button"
              className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="space-y-1 pr-8">
              <div className="text-lg font-bold">{dialogTitle}</div>
              {dialogSubtitle ? (
                <div className="text-sm opacity-70">{dialogSubtitle}</div>
              ) : null}
            </div>
            <div className="mt-4">{children}</div>
          </div>
          <form
            method="dialog"
            className="modal-backdrop"
            onClick={handleBackdropClick}
          >
            <button type="button" onClick={onClose}>
              close
            </button>
          </form>
        </dialog>
      )}
    </>
  );
}
