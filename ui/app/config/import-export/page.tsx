import {
  useConfigExport,
  ConfigExport,
  useRuntimeStatus,
} from '@/hooks/useConfig';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { Download, Info, Upload, X } from 'lucide-react';
import { useState, useRef } from 'react';

export default function ImportExportPage() {
  const { exportConfig, importConfig } = useConfigExport();
  const { data: runtimeStatus } = useRuntimeStatus(5000);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMemoryOnly = runtimeStatus?.memory_only_mode ?? false;

  const handleExport = async () => {
    try {
      setExporting(true);
      setError(null);
      const config = await exportConfig();

      // Download as JSON file
      const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homectl-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Configuration exported successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    try {
      setImporting(true);
      setError(null);

      const text = await file.text();
      const config: ConfigExport = JSON.parse(text);

      await importConfig(config);
      setSuccess(
        `Imported: ${config.integrations?.length || 0} integrations, ${config.groups?.length || 0} groups, ${config.scenes?.length || 0} scenes, ${config.routines?.length || 0} routines`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Import / Export Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Create durable JSON backups and restore runtime configuration safely.
        </p>
      </div>

      <Alert variant={isMemoryOnly ? 'warning' : 'default'}>
        <Info className="size-4" />
        <AlertTitle>Durability</AlertTitle>
        <AlertDescription>
          {isMemoryOnly
            ? 'The server is currently running without active database persistence. Export a JSON backup after important changes, because imports and editor updates only live in memory until you persist them again.'
            : 'JSON exports are still the fastest rollback point before large imports or risky edits, even while PostgreSQL persistence is available.'}
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Operation failed</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="ghost" size="icon" onClick={() => setError(null)}>
              <X />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{success}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSuccess(null)}
            >
              <X />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* Export */}
        <Card>
          <CardHeader>
            <CardTitle>Export Configuration</CardTitle>
            <CardDescription>
              Download a JSON backup of all integrations, groups, scenes, and
              routines.
              {isMemoryOnly
                ? ' This file is the durable copy of your current runtime state while the server stays memory-only.'
                : ' Keep one before major changes so you can roll the config back quickly.'}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={handleExport}
              disabled={exporting}
              className="w-full sm:w-auto"
            >
              <Download />
              {exporting ? 'Exporting…' : 'Download Backup'}
            </Button>
          </CardFooter>
        </Card>

        {/* Import */}
        <Card>
          <CardHeader>
            <CardTitle>Import Configuration</CardTitle>
            <CardDescription>
              Upload a JSON configuration file. Existing items with matching IDs
              will be updated.
              {isMemoryOnly
                ? ' Importing updates the live runtime immediately, so export again afterward if you need the result to survive a restart before persistence is back.'
                : ' Imports still apply immediately and then persist to PostgreSQL.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
              }}
              disabled={importing}
            />
            {importing && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Upload className="size-4 animate-pulse" /> Importing…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertTitle>Configuration Hot-Reload</AlertTitle>
        <AlertDescription>
          Changes made through these editors are applied immediately without
          restarting the server.
        </AlertDescription>
      </Alert>
    </div>
  );
}
