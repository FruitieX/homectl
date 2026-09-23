import type { AssistantAction } from '../bindings/AssistantAction';
import type { AssistantActionChange } from '../bindings/AssistantActionChange';
import type { AssistantActionChangeResult } from '../bindings/AssistantActionChangeResult';
import type { DevicesState } from '../bindings/DevicesState';
import type { AssistantHistoryMessage } from '../bindings/AssistantHistoryMessage';
import type { AssistantPlan } from '../bindings/AssistantPlan';
import type { AssistantUsage } from '../bindings/AssistantUsage';

/**
 * Parsed SSE events from `POST /api/v1/config/assistant/chat`. The parser is
 * transport-only: it validates the envelope and leaves payload typing to the
 * generated bindings.
 */
export type AssistantSseEvent =
  | { type: 'status'; phase: string; message: string; attempt?: number }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: AssistantUsage }
  | { type: 'plan'; plan: AssistantPlan }
  | { type: 'action'; action: AssistantAction }
  | { type: 'answer'; text: string }
  | { type: 'thread'; thread: { id: string; name: string } }
  | { type: 'error'; message: string };

function parseFrame(frame: string): AssistantSseEvent | null {
  let event = 'message';
  let data = '';
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data += (data ? '\n' : '') + line.slice('data:'.length).trimStart();
    }
  }
  if (!data) {
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (event) {
    case 'status':
      return {
        type: 'status',
        phase: typeof payload.phase === 'string' ? payload.phase : '',
        message: typeof payload.message === 'string' ? payload.message : '',
        attempt:
          typeof payload.attempt === 'number' ? payload.attempt : undefined,
      };
    case 'delta':
      return {
        type: 'delta',
        text: typeof payload.text === 'string' ? payload.text : '',
      };
    case 'usage':
      return { type: 'usage', usage: payload as unknown as AssistantUsage };
    case 'plan':
      return { type: 'plan', plan: payload as unknown as AssistantPlan };
    case 'action':
      return { type: 'action', action: payload as unknown as AssistantAction };
    case 'answer':
      return {
        type: 'answer',
        text: typeof payload.text === 'string' ? payload.text : '',
      };
    case 'thread':
      return {
        type: 'thread',
        thread: {
          id: typeof payload.id === 'string' ? payload.id : '',
          name: typeof payload.name === 'string' ? payload.name : '',
        },
      };
    case 'error':
      return {
        type: 'error',
        message:
          typeof payload.message === 'string'
            ? payload.message
            : 'Assistant request failed',
      };
    default:
      return null;
  }
}

/**
 * Split complete SSE frames out of a text buffer. Returns the parsed events
 * plus the trailing partial frame so callers can append the next chunk.
 */
export function parseAssistantSseEvents(text: string): {
  events: AssistantSseEvent[];
  rest: string;
} {
  const normalized = text.replace(/\r\n/g, '\n');
  const events: AssistantSseEvent[] = [];
  let rest = normalized;
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const frame = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const event = parseFrame(frame);
    if (event) {
      events.push(event);
    }
    boundary = rest.indexOf('\n\n');
  }
  return { events, rest };
}

export interface AssistantHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 6_000;
const MAX_HISTORY_MESSAGE_CHARS = 1_500;

/**
 * Cap a client-side conversation into the history payload. The newest turns
 * survive; the server applies its own caps on top of this. History is
 * session-only and never persisted.
 */
export function buildAssistantHistory(
  entries: readonly AssistantHistoryEntry[],
): AssistantHistoryMessage[] {
  const history: AssistantHistoryMessage[] = [];
  let chars = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const content = entry.content.trim();
    if (!content) {
      continue;
    }
    const capped =
      content.length > MAX_HISTORY_MESSAGE_CHARS
        ? `${content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}…`
        : content;
    if (chars + capped.length > MAX_HISTORY_CHARS && history.length > 0) {
      break;
    }
    chars += capped.length;
    history.unshift({ role: entry.role, content: capped });
    if (history.length >= MAX_HISTORY_MESSAGES) {
      break;
    }
  }
  return history;
}

/** Compact token count for the context meter (approximate by design). */
export function formatTokenCount(value: number | bigint): string {
  const tokens = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0';
  }
  if (tokens < 1_000) {
    return String(Math.round(tokens));
  }
  if (tokens < 10_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** One-line description of a proposed light-state change. */
export function describeAssistantActionChange(
  change: AssistantActionChange,
): string {
  const parts: string[] = [];
  if (change.power === true) {
    parts.push('on');
  } else if (change.power === false) {
    parts.push('off');
  }
  if (change.brightness !== undefined) {
    parts.push(`${Math.round(change.brightness * 100)}%`);
  }
  if (change.color) {
    parts.push(
      `h ${Math.round(change.color.h)}° · s ${Math.round(change.color.s * 100)}%`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}

/**
 * Scene links to remember before an apply clears them. Applying a proposal
 * detaches each light from its scene; remembering the scene lets the device
 * list offer to restore it, the same way a manual change does.
 */
export function scenesToRemember(
  deviceKeys: string[],
  devices: DevicesState | null,
): Record<string, string> {
  const remembered: Record<string, string> = {};
  for (const key of deviceKeys) {
    const device = devices?.[key];
    if (!device) {
      continue;
    }
    const sceneId =
      'Controllable' in device.data ? device.data.Controllable.scene_id : null;
    if (sceneId) {
      remembered[key] = sceneId;
    }
  }
  return remembered;
}

/**
 * Collapsed label for the affected-device list of an action card: how many
 * devices the proposal touches, plus the failure count once it has been
 * applied, so a partial failure stays visible while the list is collapsed.
 */
export function affectedDevicesSummary(
  deviceCount: number,
  results: AssistantActionChangeResult[] | null,
): string {
  const devices = `${deviceCount} device${deviceCount === 1 ? '' : 's'}`;
  const failed = (results ?? []).filter((result) => !result.ok).length;
  return failed > 0 ? `${devices} · ${failed} failed` : devices;
}

/** Percentage of the model context window used, clamped to 0..100. */
export function contextUsagePercent(usage: AssistantUsage): number {
  const total = Number(usage.totalTokens);
  const window = Number(usage.contextWindow);
  if (!Number.isFinite(total) || !Number.isFinite(window) || window <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (total / window) * 100));
}
