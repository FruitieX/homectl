import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  type PairedDevice,
  describeUserAgent,
  fetchPairedDevices,
  formatPairingCode,
  renamePairedDevice,
  revokePairedDevice,
  signOut,
} from '@/lib/auth';
import { useAuthStatus } from '@/ui/auth/AuthGate';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ConfigPageHeader } from '../page-header';

const PAIRED_DEVICES_QUERY = ['auth', 'paired-devices'];

function formatTime(value: string | null) {
  if (!value) return 'Never';
  const time = new Date(value);
  if (Number.isNaN(time.valueOf())) return value;
  const seconds = Math.round((Date.now() - time.valueOf()) / 1000);
  if (seconds < 90) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return time.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function AccountCard() {
  const auth = useAuthStatus();
  const description =
    auth.kind === 'user'
      ? `Signed in as ${auth.name}${auth.username && auth.username !== auth.name ? ` (${auth.username})` : ''}${auth.admin ? ', admin' : ''}.`
      : auth.kind === 'device'
        ? `This display is paired as “${auth.name}”. An admin can revoke it here on another device.`
        : `Using the API token “${auth.name}”.`;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-sm leading-6">{description}</p>
      </div>
      {auth.kind === 'user' && (
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await signOut();
            } finally {
              window.location.assign('/');
            }
          }}
        >
          <LogOut />
          Sign out
        </Button>
      )}
    </section>
  );
}

function DeviceRow({ device }: { device: PairedDevice }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: PAIRED_DEVICES_QUERY });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await renamePairedDevice(device.id, name);
      setEditing(false);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const revoke = async () => {
    const confirmed = await confirmDialog({
      title: `Revoke ${device.name}?`,
      description:
        'The device is signed out right away and has to be paired again to use homectl.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokePairedDevice(device.id);
      toast.success(`${device.name} revoked`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <li
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="paired-device"
    >
      <div className="min-w-0 space-y-1">
        {editing ? (
          <form className="flex gap-2" onSubmit={save}>
            <Input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              aria-label="Device name"
            />
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(device.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="font-medium">{device.name}</div>
        )}
        <div className="text-xs leading-5 text-muted-foreground">
          Last seen {formatTime(device.lastSeenAt).toLocaleLowerCase()}
          {device.lastSeenIp ? ` from ${device.lastSeenIp}` : ''} ·{' '}
          {describeUserAgent(device.userAgent)} · Paired by {device.createdBy}{' '}
          {formatTime(device.createdAt).toLocaleLowerCase()}
        </div>
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${device.name}`}
          >
            <Pencil />
            Rename
          </Button>
          <Button variant="outline" size="sm" onClick={revoke}>
            <Trash2 />
            Revoke
          </Button>
        </div>
      )}
    </li>
  );
}

function AdminSection() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: PAIRED_DEVICES_QUERY,
    queryFn: fetchPairedDevices,
    refetchInterval: 30000,
  });

  return (
    <>
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="font-semibold">Pair a device</h2>
        <p className="text-sm text-muted-foreground">
          Open homectl on the wall display and choose “Set up as a wall
          display”. Scan its QR code with this phone, or enter its code here.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(
              `/pair?code=${encodeURIComponent(formatPairingCode(code))}`,
            );
          }}
        >
          <Input
            placeholder="ABCD-2345"
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="Pairing code"
            className="max-w-48 font-mono tracking-widest"
            value={code}
            onChange={(event) => setCode(formatPairingCode(event.target.value))}
          />
          <Button type="submit" disabled={formatPairingCode(code).length < 9}>
            Continue
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Paired devices</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        )}
        {data && data.devices.length === 0 && (
          <EmptyState
            icon={<MonitorSmartphone />}
            title="No paired devices"
            description="Wall displays you pair appear here."
          />
        )}
        {data && data.devices.length > 0 && (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
            {data.devices.map((device) => (
              <DeviceRow key={device.id} device={device} />
            ))}
          </ul>
        )}
        {data && data.apiTokens.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            API tokens configured on the server (HOMECTL_API_TOKENS):{' '}
            {data.apiTokens.join(', ')}. Change them in the server
            configuration.
          </p>
        )}
      </section>
    </>
  );
}

export default function PairedDevicesPage() {
  const auth = useAuthStatus();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ConfigPageHeader
        title="Paired devices"
        description="Wall displays and dashboards that stay signed in without a passkey."
      />
      {!auth.enabled ? (
        <EmptyState
          icon={<KeyRound />}
          title="Sign-in is not enabled"
          description="This homectl server has no authentication configured, so every device on the network can use it without pairing."
        />
      ) : (
        <>
          <AccountCard />
          {auth.admin ? (
            <AdminSection />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only admins can pair and revoke devices.
            </p>
          )}
        </>
      )}
    </div>
  );
}
