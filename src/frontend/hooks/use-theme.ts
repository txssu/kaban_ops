import { useCallback, useSyncExternalStore } from 'react'

type ThemePreference = 'light' | 'dark' | 'system'

let preference: ThemePreference =
  (localStorage.getItem('theme') as ThemePreference) || 'system'

function getPreference(): ThemePreference {
  return preference
}

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function applyTheme(pref: ThemePreference) {
  const isDark =
    pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

function setPreference(pref: ThemePreference) {
  preference = pref
  applyTheme(pref)
  if (pref === 'system') {
    localStorage.removeItem('theme')
  } else {
    localStorage.setItem('theme', pref)
  }
  for (const cb of listeners) cb()
}

// Re-apply when OS preference changes and user is on "system"
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (preference === 'system') {
    applyTheme('system')
    for (const cb of listeners) cb()
  }
})

const cycle: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getPreference)
  const resolved = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
  const toggle = useCallback(() => {
    setPreference(cycle[pref])
  }, [pref])
  return { preference: pref, resolved, toggle }
}
