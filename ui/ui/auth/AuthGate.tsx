import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
  KeyRound,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { renderSVG } from 'uqr';

import {
  type AuthStatus,
  type PairingStart,
  fetchAuthStatus,
  pollPairing,
  signIn,
  startPairing,
} from '@/lib/auth';
import { setFeedbackButtonHidden } from '@/lib/feedbackWidget';
import { HomectlLogo } from '@/ui/HomectlLogo';
import { Button } from '@/ui/primitives/button';

/** Sign-in state; `enabled: false` when the server has no authentication. */
export const authStatusAtom = atom<AuthStatus>({
  enabled: false,
  authenticated: true,
});

export const useAuthStatus = () => useAtomValue(authStatusAtom);

/** Remembers that this browser is a wall display waiting to be paired. */
const PAIRING_MODE_KEY = 'homectl.pairingMode';
/** Visiting this path starts pairing directly (handy for kiosk start URLs). */
export const PAIR_DEVICE_PATH = '/pair-device';

function readPairingMode() {
  try {
    return window.localStorage.getItem(PAIRING_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePairingMode(on: boolean) {
  try {
    if (on) window.localStorage.setItem(PAIRING_MODE_KEY, '1');
    else window.localStorage.removeItem(PAIRING_MODE_KEY);
  } catch {
    /* storage unavailable: pairing still works for this page load */
  }
}

function currentPath() {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="app-ambient relative grid min-h-dvh flex-1 place-items-center overflow-hidden bg-background p-4 text-foreground sm:p-6">
      <div className="relative z-10 w-full max-w-md rounded-[2rem] border border-border/60 bg-card/70 p-6 shadow-2xl backdrop-blur-2xl sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl text-foreground">
            <HomectlLogo className="size-8" />
          </div>
          <div>
            <div className="font-semibold tracking-[-0.03em]">homectl</div>
            <div className="text-xs text-muted-foreground">Home automation</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignInScreen({ onPairDevice }: { onPairDevice: () => void }) {
  return (
    <AuthCard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.045em]">
            Sign in to homectl
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use your passkey to continue.
          </p>
        </div>
        <Button
          className="w-full"
          size="lg"
          onClick={() =>
            signIn(
              window.location.pathname === PAIR_DEVICE_PATH
                ? '/'
                : currentPath(),
            )
          }
        >
          <KeyRound />
          Sign in with passkey
        </Button>
        <button
          type="button"
          className="mx-auto flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={onPairDevice}
        >
          <MonitorSmartphone className="size-4" />
          Set up as a wall display
        </button>
      </div>
    </AuthCard>
  );
}

type PairingState =
  | { phase: 'starting' }
  | { phase: 'waiting'; pairing: PairingStart }
  | { phase: 'denied' }
  | { phase: 'error'; message: string };

/**
 * Shown on an unpaired wall display: a short code and a QR code that an
 * admin approves from their phone. Codes renew themselves when they expire,
 * so a display left on this screen stays ready.
 */
export function PairDeviceScreen({ onCancel }: { onCancel: () => void }) {
  const [state, setState] = useState<PairingState>({ phase: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const begin = async () => {
      try {
        const pairing = await startPairing();
        if (cancelled.current) return;
        setState({ phase: 'waiting', pairing });
        const poll = async () => {
          if (cancelled.current) return;
          try {
            const result = await pollPairing(pairing.pairingId);
            if (cancelled.current) return;
            if (result.status === 'approved') {
              writePairingMode(false);
              // The response set the device cookie; reload into the app.
              window.location.replace('/');
              return;
            }
            if (result.status === 'denied') {
              setState({ phase: 'denied' });
              return;
            }
            if (result.status === 'expired') {
              void begin();
              return;
            }
          } catch {
            /* transient network error: keep polling */
          }
          timer = setTimeout(poll, Math.max(2, pairing.pollInterval) * 1000);
        };
        timer = setTimeout(poll, Math.max(2, pairing.pollInterval) * 1000);
      } catch (error) {
        if (cancelled.current) return;
        setState({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        // Retry on its own: a display should recover without a tap.
        timer = setTimeout(() => setAttempt((n) => n + 1), 15000);
      }
    };
    void begin();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  const qr =
    state.phase === 'waiting'
      ? renderSVG(state.pairing.approveUrl, {
          border: 2,
          whiteColor: '#ffffff',
          blackColor: '#000000',
        })
      : null;

  return (
    <AuthCard>
      <div className="space-y-6" data-testid="pair-device-screen">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.045em]">
            Pair this device
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Scan the QR code with a phone signed in to homectl, or enter the
            code under Settings → Paired devices.
          </p>
        </div>
        {state.phase === 'waiting' && (
          <div className="flex flex-col items-center gap-5">
            <div
              className="size-56 overflow-hidden rounded-2xl bg-white p-1 [&>svg]:size-full"
              aria-label="QR code for approving this device"
              role="img"
              // uqr renders a self-contained SVG from the approval URL.
              dangerouslySetInnerHTML={{ __html: qr ?? '' }}
            />
            <div
              className="font-mono text-4xl font-semibold tracking-[0.12em]"
              data-testid="pairing-code"
            >
              {state.pairing.code}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Waiting for approval…
            </div>
          </div>
        )}
        {state.phase === 'starting' && (
          <p className="text-sm text-muted-foreground">Getting a code…</p>
        )}
        {state.phase === 'denied' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The pairing request was declined.
            </p>
            <Button className="w-full" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw />
              Get a new code
            </Button>
          </div>
        )}
        {state.phase === 'error' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Could not start pairing: {state.message}. Retrying shortly.
            </p>
            <Button className="w-full" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        )}
        <button
          type="button"
          className="mx-auto block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={onCancel}
        >
          Sign in with a passkey instead
        </button>
      </div>
    </AuthCard>
  );
}

/**
 * Wraps the app. With authentication enabled and no session or device
 * credential, shows the sign-in (or pairing) screen instead of the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [pairing, setPairing] = useState(
    () => window.location.pathname === PAIR_DEVICE_PATH || readPairingMode(),
  );
  const setAuthStatus = useSetAtom(authStatusAtom);

  const check = useCallback(async () => {
    try {
      const next = await fetchAuthStatus();
      setStatus(next);
      setAuthStatus(next);
    } catch {
      // Server unreachable: let the app's connection screen explain it.
      setStatus({ enabled: false, authenticated: true });
    }
  }, [setAuthStatus]);

  useEffect(() => {
    void check();
  }, [check]);

  // A session can end while the app is open (device revoked, signed out
  // elsewhere): an API 401 re-checks and brings back the sign-in screen.
  useEffect(() => {
    if (!status?.enabled || !status.authenticated) return;
    const originalFetch = window.fetch;
    let rechecking = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401 && !rechecking) {
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : args[0].url;
        if (/\/api\//.test(url)) {
          rechecking = true;
          void check().finally(() => {
            rechecking = false;
          });
        }
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [status, check]);

  // Paired wall displays have no one to write feedback: hide the injected
  // feedback-hub button there.
  const isDevice = Boolean(status?.authenticated && status.kind === 'device');
  useEffect(() => {
    if (isDevice) return setFeedbackButtonHidden(true);
  }, [isDevice]);

  const needsSignIn = Boolean(status?.enabled && !status.authenticated);
  // Opening an approval link (QR code) while signed out goes straight to
  // the passkey prompt and returns to the approval page.
  const approvalLink =
    needsSignIn &&
    window.location.pathname === '/pair' &&
    !status?.error &&
    !pairing;
  useEffect(() => {
    if (approvalLink) signIn(currentPath());
  }, [approvalLink]);

  if (status === null || approvalLink) {
    return (
      <AuthCard>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AuthCard>
    );
  }

  if (needsSignIn) {
    if (status.error) {
      return (
        <AuthCard>
          <div className="space-y-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-300">
              <ShieldAlert />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.045em]">
              Sign-in is misconfigured
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {status.error}
            </p>
          </div>
        </AuthCard>
      );
    }
    if (pairing) {
      return (
        <PairDeviceScreen
          onCancel={() => {
            writePairingMode(false);
            setPairing(false);
            if (window.location.pathname === PAIR_DEVICE_PATH) {
              window.history.replaceState(null, '', '/');
            }
          }}
        />
      );
    }
    return (
      <SignInScreen
        onPairDevice={() => {
          writePairingMode(true);
          setPairing(true);
        }}
      />
    );
  }

  return children;
}
