import type { ComponentProps } from 'react';

export function HomectlLogo(props: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 192 192"
      fill="none"
      stroke="currentColor"
      strokeWidth="16"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 64 96 16 176 64M32 80v96h128V80" />
    </svg>
  );
}
