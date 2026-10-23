import {
  CheckCircle2,
  MonitorSmartphone,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  type PairingRequest,
  approvePairing,
  denyPairing,
  describeUserAgent,
  fetchPairingRequest,
  formatPairingCode,
} from '@/lib/auth';
import { useAuthStatus } from '@/ui/auth/AuthGate';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';

type State =
  | { phase: 'enter' }
  | { phase: 'loading' }
  | { phase: 'review'; request: PairingRequest }
  | { phase: 'approved'; name: string }
  | { phase: 'denied' }
  | { phase: 'error'; message: string };

/**
 * Approve a wall display's pairing code. Reached by scanning the QR code on
 * the display (`/pair?code=…`) or by entering the code by hand.
 */
export default function PairApprovalPage() {
  const auth = useAuthStatus();
  const [params, setParams] = useSearchParams();
  const code = params.get('code') ?? '';
  const [typed, setTyped] = useState(code);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<State>(
    code ? { phase: 'loading' } : { phase: 'enter' },
  );

  useEffect(() => {
    if (!code || !auth.admin) return;
    let cancelled = false;
    setState({ phase: 'loading' });
    fetchPairingRequest(code)
      .then((request) => {
        if (cancelled) return;
        setName(request.requestedName ?? 'Wall display');
        setState({ phase: 'review', request });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ phase: 'error', message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [code, auth.admin]);

  if (!auth.enabled) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Sign-in is not enabled on this homectl server, so devices do not need
          to be paired.
        </p>
      </Shell>
    );
  }

  if (!auth.admin) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            Only admins can approve devices. Ask an admin to scan the code or
            enter it under Settings → Paired devices.
          </p>
        </div>
      </Shell>
    );
  }

  const lookUp = (event: FormEvent) => {
    event.preventDefault();
    const formatted = formatPairingCode(typed);
    if (formatted.length < 9) return;
    setParams({ code: formatted }, { replace: true });
  };

  const approve = async () => {
    if (state.phase !== 'review') return;
    setBusy(true);
    try {
      const { device } = await approvePairing(state.request.code, name);
      setState({ phase: 'approved', name: device.name });
    } catch (error) {
      setState({ phase: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const deny = async () => {
    if (state.phase !== 'review') return;
    setBusy(true);
    try {
      await denyPairing(state.request.code);
      setState({ phase: 'denied' });
    } catch (error) {
      setState({ phase: 'error', message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {state.phase === 'enter' && (
        <form className="space-y-4" onSubmit={lookUp}>
          <div className="space-y-2">
            <Label htmlFor="pairing-code">Code shown on the device</Label>
            <Input
              id="pairing-code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="ABCD-2345"
              className="font-mono text-lg tracking-widest"
              value={typed}
              onChange={(event) =>
                setTyped(formatPairingCode(event.target.value))
              }
            />
          </div>
          <Button type="submit" disabled={formatPairingCode(typed).length < 9}>
            Continue
          </Button>
        </form>
      )}
      {state.phase === 'loading' && (
        <p className="text-sm text-muted-foreground">Looking up the code…</p>
      )}
      {state.phase === 'review' && (
        <div className="space-y-5" data-testid="pair-review">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Code</dt>
            <dd className="font-mono font-semibold">{state.request.code}</dd>
            <dt className="text-muted-foreground">Device</dt>
            <dd>{describeUserAgent(state.request.userAgent)}</dd>
            {state.request.ip && (
              <>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="font-mono">{state.request.ip}</dd>
              </>
            )}
          </dl>
          <p className="text-sm text-muted-foreground">
            Only approve a code you can see on the device in front of you. The
            device will be able to control your home until you revoke it.
          </p>
          <div className="space-y-2">
            <Label htmlFor="device-name">Name</Label>
            <Input
              id="device-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={approve} disabled={busy || !name.trim()}>
              <CheckCircle2 />
              Approve
            </Button>
            <Button variant="outline" onClick={deny} disabled={busy}>
              <XCircle />
              Decline
            </Button>
          </div>
        </div>
      )}
      {state.phase === 'approved' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            {state.name} is paired. It opens homectl in a few seconds.
          </p>
          <Button asChild variant="outline">
            <Link to="/config/paired-devices">Paired devices</Link>
          </Button>
        </div>
      )}
      {state.phase === 'denied' && (
        <p className="text-sm text-muted-foreground">
          Declined. The device shows that the request was declined.
        </p>
      )}
      {state.phase === 'error' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              setParams({}, { replace: true });
              setTyped('');
              setState({ phase: 'enter' });
            }}
          >
            Enter a code
          </Button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
          <MonitorSmartphone />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Approve a device
          </h1>
          <p className="text-sm text-muted-foreground">
            Give a wall display lasting access to homectl.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        {children}
      </div>
    </div>
  );
}
