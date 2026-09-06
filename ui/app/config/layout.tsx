import { useConfigWriteWarnings } from '@/hooks/configWriteStatus';
import { useRuntimeStatus } from '@/hooks/useConfig';
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
  const writeWarnings = useConfigWriteWarnings();
  const { data: runtimeStatus } = useRuntimeStatus(5000);
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full flex-col bg-background">
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

      {Object.entries(writeWarnings).length > 0 && (
        <Alert variant="warning" className="mx-4 mt-4 w-auto shrink-0">
          <AlertTitle>Changes not saved to the database</AlertTitle>
          <AlertDescription className="space-y-2">
            {Object.entries(writeWarnings).map(([key, warning]) => (
              <p key={key}>
                <strong>{key}</strong>: {warning}
              </p>
            ))}
            <Button asChild variant="outline" size="sm">
              <Link to="/config/import-export">Export backup</Link>
            </Button>
          </AlertDescription>
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
