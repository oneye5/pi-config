import type { ChatPrefs } from '../../shared/protocol';

export type ChatPrefKey = keyof ChatPrefs;
export type ChatPrefContextType = 'reasoning' | 'toolCalls';

export interface ChatPrefMenuItem<K extends ChatPrefKey = ChatPrefKey> {
  key: K;
  label: string;
}

export interface ChatPrefMenuSection {
  id: string;
  label?: string;
  items: ChatPrefMenuItem[];
}

export const CHAT_PREF_MENU_SECTIONS: readonly ChatPrefMenuSection[] = [
  {
    id: 'transcript',
    label: 'Transcript',
    items: [
      { key: 'autoExpandReasoning', label: 'Auto-expand reasoning' },
      { key: 'autoExpandToolCalls', label: 'Auto-expand tool calls' },
    ],
  },
  {
    id: 'notifications',
    label: 'Alerts',
    items: [
      {
        key: 'suppressCompletionNotifications',
        label: 'Suppress completion alerts',
      },
    ],
  },
] as const;

export function toggleChatPref<K extends ChatPrefKey>(prefs: ChatPrefs, key: K): Pick<ChatPrefs, K> {
  return { [key]: !prefs[key] } as Pick<ChatPrefs, K>;
}

export function getChatPrefContextKey(type: ChatPrefContextType): ChatPrefKey {
  return type === 'reasoning' ? 'autoExpandReasoning' : 'autoExpandToolCalls';
}

export function getChatPrefContextLabel(type: ChatPrefContextType): string {
  return type === 'reasoning' ? 'Auto-expand reasoning' : 'Auto-expand tool calls';
}

export function getChatPrefContextValue(prefs: ChatPrefs, type: ChatPrefContextType): boolean {
  return prefs[getChatPrefContextKey(type)];
}

export function toggleChatPrefForContext(
  prefs: ChatPrefs,
  type: ChatPrefContextType,
): Partial<ChatPrefs> {
  return toggleChatPref(prefs, getChatPrefContextKey(type));
}
