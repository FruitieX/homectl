/**
 * Client for homectl's optional authentication (`/auth/*`, see the server's
 * `auth` module). With authentication disabled `GET /auth/me` reports
 * `enabled: false` and the UI behaves as before.
 */

export type AuthStatus = {
  enabled: boolean;
  authenticated: boolean;
  kind?: 'user' | 'device' | 'token';
  name?: string;
  username?: string | null;
  deviceId?: string | null;
  admin?: boolean;
  error?: string;
};

export type PairingStart = {
  pairingId: string;
  code: string;
  expiresIn: number;
  approveUrl: string;
  pollInterval: number;
};

export type PairingPoll =
  | { status: 'pending'; expiresIn: number }
  | {
      status: 'approved';
      device: { id: string; name: string };
      token: string;
    }
  | { status: 'denied' }
  | { status: 'expired' };

export type PairingRequest = {
  code: string;
  requestedName: string | null;
  userAgent: string | null;
  ip: string | null;
  requestedAt: string;
  expiresIn: number;
};

export type PairedDevice = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  userAgent: string | null;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
};

function apiBase(): string {
  const configured = import.meta.env.API_ENDPOINT;
  return typeof configured === 'string'
    ? configured.trim().replace(/\/+$/, '')
    : '';
}

export function authUrl(path: string): string {
  return `${apiBase()}/auth/${path.replace(/^\/+/, '')}`;
}

export class AuthRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(authUrl(path), {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...rest.headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new AuthRequestError(
      response.status,
      body.error ?? `Request failed (${response.status})`,
    );
  }
  return body as T;
}

/**
 * Current sign-in state. An older server without `/auth/me` answers 404,
 * which means there is no authentication to deal with.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch(authUrl('me'), { credentials: 'include' });
  if (response.status === 404) {
    return { enabled: false, authenticated: true };
  }
  if (!response.ok) {
    throw new Error(`Could not check sign-in (${response.status})`);
  }
  return (await response.json()) as AuthStatus;
}

/** Full-page navigation to the provider; returns here afterwards. */
export function signIn(returnTo: string) {
  window.location.assign(
    `${authUrl('login')}?return=${encodeURIComponent(returnTo)}`,
  );
}

export async function signOut() {
  await request('logout', { method: 'POST', json: {} });
}

export const startPairing = (name?: string) =>
  request<PairingStart>('pair/start', {
    method: 'POST',
    json: name ? { name } : {},
  });

export const pollPairing = (pairingId: string) =>
  request<PairingPoll>('pair/poll', { method: 'POST', json: { pairingId } });

export const fetchPairingRequest = (code: string) =>
  request<PairingRequest>(`pair/request?code=${encodeURIComponent(code)}`);

export const approvePairing = (code: string, name: string) =>
  request<{ device: PairedDevice }>('pair/approve', {
    method: 'POST',
    json: { code, name },
  });

export const denyPairing = (code: string) =>
  request<{ ok: boolean }>('pair/deny', { method: 'POST', json: { code } });

export const fetchPairedDevices = () =>
  request<{ devices: PairedDevice[]; apiTokens: string[] }>('devices');

export const renamePairedDevice = (id: string, name: string) =>
  request<{ device: PairedDevice }>(`devices/${encodeURIComponent(id)}`, {
    method: 'PUT',
    json: { name },
  });

export const revokePairedDevice = (id: string) =>
  request<{ ok: boolean }>(`devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

/** Normalize a typed pairing code: `abcd 2345` → `ABCD-2345`. */
export function formatPairingCode(input: string): string {
  const raw = input.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
}

/** A short, readable description of a browser user agent. */
export function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return 'Unknown browser';
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPad|iPhone|iPod/i.test(userAgent)
      ? 'iOS'
      : /Mac OS X/i.test(userAgent)
        ? 'macOS'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /CrOS/i.test(userAgent)
            ? 'ChromeOS'
            : /Linux/i.test(userAgent)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /curl\//i.test(userAgent)
            ? 'curl'
            : null;
  if (!os && !browser) return userAgent.slice(0, 60);
  return [browser, os].filter(Boolean).join(' on ');
}
