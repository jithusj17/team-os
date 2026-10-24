import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'team-os:theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply() {
  const choice = readChoice();
  const dark = choice === 'dark' || (choice === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  listeners.forEach((l) => l());
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  apply();
}

export function initTheme() {
  media.addEventListener('change', apply);
  apply();
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, readChoice);
}
