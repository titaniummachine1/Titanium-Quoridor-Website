const STORAGE_KEY = 'quoridor.playSettings.v1';

/** @returns {{ players: string[], playerAiSettings: object[], playerAiSettingsMemory: object[] } | null} */
export function loadPersistedPlaySettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.players) || parsed.players.length !== 2) {
      return null;
    }
    return {
      players: parsed.players,
      playerAiSettings: Array.isArray(parsed.playerAiSettings)
        ? parsed.playerAiSettings
        : [{}, {}],
      playerAiSettingsMemory: Array.isArray(parsed.playerAiSettingsMemory)
        ? parsed.playerAiSettingsMemory
        : [{}, {}],
    };
  } catch {
    return null;
  }
}

export function savePersistedPlaySettings(settings) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        players: settings.players,
        playerAiSettings: settings.playerAiSettings,
        playerAiSettingsMemory: settings.playerAiSettingsMemory,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}
