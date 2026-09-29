import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/ui/primitives/button';

export function NotFoundPage() {
  const location = useLocation();
  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This link may be outdated. Choose a destination below or search for the
        device, room or setting.
      </p>
      <p className="break-all font-mono text-xs text-muted-foreground">
        {location.pathname}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/">Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/groups">Rooms &amp; groups</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/config">Settings</Link>
        </Button>
      </div>
    </main>
  );
}
