import type { ReactNode } from 'react';
export function SettingsSection({
  id,
  title,
  description,
  actions,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="settings-section"
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className="settings-section-heading">
        <div className="min-w-0 flex-[1_1_12rem]">
          <h2 id={id ? `${id}-title` : undefined} tabIndex={-1}>
            {title}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {actions && (
          <div className="flex max-w-full flex-wrap gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
