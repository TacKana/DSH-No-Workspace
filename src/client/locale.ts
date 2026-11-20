import type { Locale, Unsubscribe } from './types.js'

/** Locale namespace owned by this plugin; dictionaries live in `locale/*.json`. */
export const LOCALE_NAMESPACE = 'no-workspace'

/** Labels this client entry adds. Keys are stable across languages. */
export const DICTIONARIES = {
  zh: {
    /** Hero chip when the conversation has its own automatic directory. */
    standalone: '不在工作区中工作',
    /** Workspace-picker action that moves a conversation off every Workspace. */
    option: '不使用工作区',
  },
  en: {
    standalone: 'Not in a workspace',
    option: 'Use no workspace',
  },
} as const

/** Chinese label used before (or without) the locale service. */
export const FALLBACK_LABEL = DICTIONARIES.zh.standalone
/** Chinese menu action used before (or without) the locale service. */
export const FALLBACK_OPTION = DICTIONARIES.zh.option

/** Resolved, live-translated labels plus the revision that changes them. */
export interface Text {
  label(): string
  option(): string
  revision(): number
  subscribe(listener: () => void): Unsubscribe | undefined
}

/**
 * Register the dictionaries once per client lifetime.
 * Registration is guarded: a duplicate `(namespace, locale)` pair throws, and
 * an older client without a locale service simply keeps the fallback labels.
 */
export function registerDictionaries(localization: Locale | undefined): Unsubscribe {
  if (localization === undefined) return () => {}
  try {
    return localization.register(LOCALE_NAMESPACE, DICTIONARIES)
  } catch (error) {
    console.warn('no-workspace: locale registration failed:', error)
    return () => {}
  }
}

/** Build the label lookup used by the Hero chip and the picker action. */
export function createText(localization: Locale | undefined): Text {
  const translate = localization === undefined ? undefined : localization.bind(LOCALE_NAMESPACE)
  const resolve = (key: keyof typeof DICTIONARIES.zh, fallback: string): string => {
    if (translate === undefined) return fallback
    const value = translate(key)
    // A missing key comes back as the key itself; keep the dictionary value then.
    return value !== undefined && value.length > 0 && value !== key ? value : fallback
  }
  return {
    label: () => resolve('standalone', FALLBACK_LABEL),
    option: () => resolve('option', FALLBACK_OPTION),
    revision: () => localization?.getLocale().revision ?? 0,
    subscribe: (listener) => localization?.subscribe(listener),
  }
}
