
import { ChatSession, UserSettings } from '../types';

const SESSIONS_KEY = 'mini_ai_sessions';
const ACTIVE_ID_KEY = 'mini_ai_active_id';
const SETTINGS_KEY = 'mini_ai_settings';

export const storageService = {
  saveSessions: (sessions: ChatSession[]) => {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error("Failed to save sessions:", e);
    }
  },
  getSessions: (): ChatSession[] => {
    try {
      const saved = localStorage.getItem(SESSIONS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to load sessions:", e);
      return [];
    }
  },
  saveActiveSessionId: (id: string | null) => {
    try {
      if (id) localStorage.setItem(ACTIVE_ID_KEY, id);
      else localStorage.removeItem(ACTIVE_ID_KEY);
    } catch (e) {
      console.error("Failed to save active session ID:", e);
    }
  },
  getActiveSessionId: (): string | null => {
    return localStorage.getItem(ACTIVE_ID_KEY);
  },
  saveSettings: (settings: UserSettings) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },
  getSettings: (): UserSettings | null => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to load settings:", e);
      return null;
    }
  }
};
