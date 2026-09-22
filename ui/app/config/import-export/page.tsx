import {
  useConfigExport,
  ConfigExport,
  useRuntimeStatus,
} from '@/hooks/useConfig';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { ConfigPageHeader } from '../page-header';
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
import { Checkbox } from '@/ui/primitives/checkbox';
import { Label } from '@/ui/primitives/label';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Download, Info, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';

export default function ImportExportPage() {
  const { exportConfig, importConfig } = useConfigExport();
  const { data: runtimeStatus } = useRuntimeStatus(5000);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [pendingImport, setPendingImport] = useState<ConfigExport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMemoryOnly = runtimeStatus?.memory_only_mode ?? false;

  const handleExport = async () => {
    try {
      setExporting(true);
      const config = await exportConfig(includeSecrets);

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

      toast.success('Configuration exported successfully');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const stageImport = async (file: File) => {
    try {
      const text = await file.text();
      const config: ConfigExport = JSON.parse(text);
      setPendingImport(config);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Could not read the backup file: ${e.message}`
          : 'Could not read the backup file',
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImport = async () => {
    if (!pendingImport) {
      return;
    }
    try {
      setImporting(true);
      await importConfig(pendingImport);
      toast.success(
        `Imported: ${pendingImport.integrations?.length || 0} integrations, ${pendingImport.groups?.length || 0} groups, ${pendingImport.scenes?.length || 0} scenes, ${pendingImport.routines?.length || 0} routines`,
      );
      setPendingImport(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const pendingImportCounts = pendingImport
    ? [
        {
          label: 'Integrations',
          count: pendingImport.integrations?.length ?? 0,
        },
        { label: 'Groups', count: pendingImport.groups?.length ?? 0 },
        { label: 'Scenes', count: pendingImport.scenes?.length ?? 0 },
        { label: 'Routines', count: pendingImport.routines?.length ?? 0 },
        { label: 'Sources', count: pendingImport.sources?.length ?? 0 },
        { label: 'Floorplans', count: pendingImport.floorplans?.length ?? 0 },
      ]
    : [];

  return (
    <div className="max-w-5xl space-y-5">
      <ConfigPageHeader
        title="Backups & Migration"
        description="Create durable JSON backups, restore runtime configuration, and import legacy TOML."
      />
      <ConfigTabs
        tabs={[
          { label: 'Backups', to: '/config/import-export', active: true },
          { label: 'Migration', to: '/config/migration' },
        ]}
      />

      <Alert variant={isMemoryOnly ? 'warning' : 'default'}>
        <Info className="size-4" />
        <AlertTitle>Durability</AlertTitle>
        <AlertDescription>
          {isMemoryOnly
            ? 'The server is currently running without active database persistence. Export a JSON backup after important changes, because imports and editor updates only live in memory until you persist them again.'
            : 'JSON exports are still the fastest rollback point before large imports or risky edits, even while PostgreSQL persistence is available.'}
        </AlertDescription>
      </Alert>

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
          <CardContent>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <Checkbox
                id="include-secrets"
                checked={includeSecrets}
                onCheckedChange={(checked) =>
                  setIncludeSecrets(checked === true)
                }
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="include-secrets"
                  className="text-sm font-medium"
                >
                  Include secrets
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Off by default: widget tokens and calendar URLs are left out
                  of the file. Turn this on for a backup that can fully restore
                  a fresh instance. Imports keep stored secrets unless the file
                  sets them explicitly.
                </p>
              </div>
            </div>
          </CardContent>
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
                if (file) void stageImport(file);
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

      <ResponsiveOverlay
        open={pendingImport !== null}
        onOpenChange={(open) => {
          if (!open && !importing) {
            setPendingImport(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          }
        }}
        title="Import configuration?"
        description="The file is applied immediately. Existing integrations, groups, scenes, and routines with matching IDs are overwritten."
        className="max-w-lg"
      >
        <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {pendingImportCounts.map((entry) => (
              <div
                key={entry.label}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2"
              >
                <dt className="text-muted-foreground">{entry.label}</dt>
                <dd className="font-medium">{entry.count}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Export a backup first if you are not sure you want to keep the
            current configuration.
          </p>
          <div className="mt-auto flex justify-end gap-2 pt-4">
            <Button
              variant="ghost"
              disabled={importing}
              onClick={() => {
                setPendingImport(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
            >
              Cancel
            </Button>
            <Button disabled={importing} onClick={() => void handleImport()}>
              {importing ? 'Importing…' : 'Import now'}
            </Button>
          </div>
        </div>
      </ResponsiveOverlay>
    </div>
  );
}
