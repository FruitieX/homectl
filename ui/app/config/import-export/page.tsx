import { useConfigExport, ConfigExport } from '@/hooks/useConfig';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { ConfigPageHeader } from '../page-header';
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
import { Download, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';

export default function ImportExportPage() {
  const { exportConfig, importConfig } = useConfigExport();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [pendingImport, setPendingImport] = useState<ConfigExport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        title="Backups & migration"
        description="Save a copy of your setup or restore one you saved earlier."
      />
      <ConfigTabs
        tabs={[
          { label: 'Backups', to: '/config/import-export', active: true },
          { label: 'Migration', to: '/config/migration' },
        ]}
      />

      <div className="grid gap-5 md:grid-cols-2">
        {/* Export */}
        <Card>
          <CardHeader>
            <CardTitle>Download a backup</CardTitle>
            <CardDescription>
              Save your connections, rooms, scenes, routines, and other settings
              in a JSON file.
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
                  Turn this on if the backup must restore API keys and other
                  credentials on a new server. Keep that file private.
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
              {exporting ? 'Preparing…' : 'Download backup'}
            </Button>
          </CardFooter>
        </Card>

        {/* Import */}
        <Card>
          <CardHeader>
            <CardTitle>Restore from a backup</CardTitle>
            <CardDescription>
              Choose a JSON backup to review. Items with matching IDs will be
              updated when you confirm.
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
