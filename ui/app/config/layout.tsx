import { useRuntimeStatus } from '@/hooks/useConfig';
import { getActiveConfigSection } from './sections';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';

export default function ConfigLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = useLocation().pathname;
  const { data: runtimeStatus } = useRuntimeStatus(5000);
  const reduceMotion = useReducedMotion();
  const activeSection = getActiveConfigSection(pathname);
  const isHub = pathname === '/config';

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Configuration
            </h2>
            <p className="text-sm text-muted-foreground">
              {activeSection && !isHub
                ? `${activeSection.label}: ${activeSection.description}`
                : 'Search integrations, automations, layouts, and runtime settings.'}
            </p>
          </div>
          <Button asChild variant={isHub ? 'secondary' : 'outline'} size="sm">
            <Link to="/config" aria-current={isHub ? 'page' : undefined}>
              Config hub
            </Link>
          </Button>
        </div>
      </div>

      {runtimeStatus?.memory_only_mode && (
        <Alert variant="warning" className="mx-4 mt-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <AlertTitle>Memory-only runtime</AlertTitle>
              <AlertDescription>
                Config changes are live, but a restart will drop them unless you
                export a JSON backup.
              </AlertDescription>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:bg-amber-400/10 dark:text-amber-100"
            >
              <Link to="/config/import-export">Export backup</Link>
            </Button>
          </div>
        </Alert>
      )}

      {/* Content area */}
      <motion.div
        key={pathname}
        animate={{ opacity: 1, y: 0 }}
        className="flex-1 overflow-auto p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)]"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </div>
  );
}
