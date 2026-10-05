import { atom } from 'jotai';
import type { SceneClipboard } from '@/lib/sceneClipboard';

/** Session-only, so a target copied in one scene can be pasted into another. */
export const sceneClipboardAtom = atom<SceneClipboard | null>(null);
