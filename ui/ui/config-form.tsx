import { type ComponentProps, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function ConfigFormSection({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: ComponentProps<'section'> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      className={cn(
        'rounded-3xl border border-border bg-background/70 p-4 shadow-sm sm:p-5',
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {title ? (
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function ConfigFormGrid({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}
      {...props}
    />
  );
}

export function ConfigField({
  label,
  description,
  className,
  children,
  ...props
}: ComponentProps<'label'> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className={cn('grid gap-2', className)} {...props}>
      <span className="text-sm font-medium leading-none text-foreground">
        {label}
      </span>
      {description ? (
        <span className="text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      ) : null}
      {children}
    </label>
  );
}

export function ConfigToggleRow({
  label,
  description,
  children,
  className,
  ...props
}: ComponentProps<'label'> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 p-4 transition hover:bg-muted/50',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        {description ? (
          <span className="block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

export function ConfigFormActions({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-5 mt-6 flex flex-col-reverse gap-2 border-t border-border bg-popover/95 px-5 py-4 backdrop-blur sm:flex-row sm:justify-end md:mx-0 md:px-0',
        className,
      )}
      {...props}
    />
  );
}

export function ConfigReadOnlyGrid({
  className,
  ...props
}: ComponentProps<'dl'>) {
  return (
    <dl
      className={cn(
        'grid gap-3 rounded-2xl bg-muted/30 p-4 sm:grid-cols-2',
        className,
      )}
      {...props}
    />
  );
}

export function ConfigReadOnlyItem({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="wrap-break-word text-sm font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

export function ConfigHelpPanel({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
