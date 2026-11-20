import type { Locale, Unsubscribe } from './types.js'

/** 此插件拥有的 locale 命名空间；字典位于 `locale/*.json`。 */
export const LOCALE_NAMESPACE = 'no-workspace'

/** 此客户端入口添加的标签。键在各语言间保持稳定。 */
export const DICTIONARIES = {
  zh: {
    /** 当对话拥有其自己的自动目录时的 Hero 芯片。 */
    standalone: '不在工作区中工作',
    /** 将对话从所有工作区移出的工作区选择器操作。 */
    option: '不使用工作区',
  },
  en: {
    standalone: 'Not in a workspace',
    option: 'Use no workspace',
  },
} as const

/** 在 locale 服务之前（或没有它时）使用的中文标签。 */
export const FALLBACK_LABEL = DICTIONARIES.zh.standalone
/** 在 locale 服务之前（或没有它时）使用的中文菜单操作。 */
export const FALLBACK_OPTION = DICTIONARIES.zh.option

/** 解析后的实时翻译标签，以及改变它们的修订版本号。 */
export interface Text {
  label(): string
  option(): string
  revision(): number
  subscribe(listener: () => void): Unsubscribe | undefined
}

/**
 * 每个客户端生命周期只注册一次字典。
 * 注册是受保护的：重复的 `(namespace, locale)` 对会抛出异常，
 * 而缺少 locale 服务的较旧客户端只会保留回退标签。
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

/** 构建 Hero 芯片和选择器操作所使用的标签查找。 */
export function createText(localization: Locale | undefined): Text {
  const translate = localization === undefined ? undefined : localization.bind(LOCALE_NAMESPACE)
  const resolve = (key: keyof typeof DICTIONARIES.zh, fallback: string): string => {
    if (translate === undefined) return fallback
    const value = translate(key)
    // 缺失的键会以键本身的形式返回；此时保留字典值。
    return value !== undefined && value.length > 0 && value !== key ? value : fallback
  }
  return {
    label: () => resolve('standalone', FALLBACK_LABEL),
    option: () => resolve('option', FALLBACK_OPTION),
    revision: () => localization?.getLocale().revision ?? 0,
    subscribe: (listener) => localization?.subscribe(listener),
  }
}
