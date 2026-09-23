import { AlertTriangle, RotateCw } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { Button } from '@/ui/primitives/button';

/**
 * Shown when a route throws. React Router's default screen is a wall of
 * minified stack trace, which is unusable on a phone; this keeps the failure
 * legible and offers the actions that actually recover the app.
 */
export function RouteErrorScreen() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      <span className="grid size-10 place-items-center rounded-2xl bg-destructive/15 text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <h1 className="text-base font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => window.location.reload()}>
          <RotateCw />
          Reload
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
