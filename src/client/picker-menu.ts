import type { Text } from './locale.js'
import { NO_WORKSPACE_ICON } from './options.js'
import type { Unsubscribe } from './types.js'

/** Attribute that marks the injected row, so passes stay idempotent. */
const MARK = 'data-no-workspace-action'

/** Native failure notice the conversation surface already understands. */
export type ConversationNotice = (error: unknown) => void

/** Collaborators of the injected picker action. */
export interface PickerActionOptions {
  /** Localized menu label. */
  text: Pick<Text, 'option'>
  /** Runs the sentinel open; may return a promise. */
  chooseNotInWorkspace(): unknown
  /** Resolves the native failure notice, when the surface offers one. */
  conversationNotice(): ConversationNotice | undefined
}

/** Whether a menu row belongs to the Workspace picker (not a context menu). */
function isWorkspacePicker(menu: Element, footer: Element): boolean {
  if (menu.closest('[data-context-menu]') !== null) return false
  if (menu.querySelector('svg[data-icon*="folder-close"]') === null) return false
  return [...footer.children].some((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
}

/** The footer wrapper that carries the add-folder action. */
function addTemplate(footer: Element): Element | undefined {
  return [...footer.children].find((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
}

/**
 * Mirror a "not in a workspace" action into the open Workspace menu, inside the
 * footer group that holds "add folder".
 *
 * The native menu builds its footer from its own add entries and never reads the
 * Workspace snapshot for it, so the live add row is cloned, re-labelled and
 * inserted just before it. Nothing is added to any snapshot, so the sidebar,
 * counts and the command palette cannot see the action.
 */
export function installPickerFooterAction(options: PickerActionOptions): Unsubscribe {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}

  let observer: MutationObserver | null = null
  let applying = false

  /** Adopt a cloned add row as the standalone action. */
  const adopt = (row: Element): void => {
    const button = row.querySelector('button[role="menuitem"]')
    if (button === null) return
    // Keep the cloned icon slot but point it at the "leave a project" glyph:
    // one plus (the add row) is enough, two read as "another new folder".
    for (const icon of row.querySelectorAll('[class*="itemIcon"] svg')) {
      icon.setAttribute('data-icon', NO_WORKSPACE_ICON)
      const use = icon.querySelector('use')
      if (use !== null) use.setAttribute('href', `#${NO_WORKSPACE_ICON}`)
    }
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // The Menu listens for Escape on the document and closes once.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const report = (error: unknown): void => {
        console.warn('no-workspace: opening a standalone chat failed:', error)
        try {
          // The menu is already closed, so report through the normal channel.
          options.conversationNotice()?.(error)
        } catch {
          // the notice channel is best-effort
        }
      }
      try {
        Promise.resolve(options.chooseNotInWorkspace()).catch(report)
      } catch (error) {
        report(error)
      }
    })
    const labelNode = row.querySelector('[class*="itemLabel"]')
    if (labelNode !== null) labelNode.textContent = options.text.option()
  }

  /** Insert or refresh the row in every open Workspace menu (one pass per frame). */
  const apply = (): void => {
    if (applying) return
    applying = true
    // Ignore the mutations this pass performs; otherwise re-inserting a row that
    // React re-rendered away would trigger the observer forever.
    observer?.disconnect()
    try {
      const label = options.text.option()
      for (const menu of document.querySelectorAll('[role="menu"]')) {
        const footer = menu.querySelector('[role="presentation"][class*="footer"]')
        if (footer === null || !isWorkspacePicker(menu, footer)) continue
        const template = addTemplate(footer)
        if (template === undefined) continue

        const duplicates = footer.querySelectorAll(`[${MARK}]`)
        for (let index = 1; index < duplicates.length; index += 1) duplicates[index]?.remove()

        let row = footer.querySelector(`[${MARK}]`)
        if (row === null) {
          row = template.cloneNode(true) as Element
          row.setAttribute(MARK, '1')
          for (const check of row.querySelectorAll('[class*="check"]')) check.remove()
          for (const button of row.querySelectorAll('button')) {
            for (const name of [...button.classList]) {
              if (name.includes('selected')) button.classList.remove(name)
            }
          }
          adopt(row)
          footer.insertBefore(row, template)
        } else {
          const labelNode = row.querySelector('[class*="itemLabel"]')
          if (labelNode !== null && labelNode.textContent !== label) labelNode.textContent = label
          if (row.nextElementSibling !== template) footer.insertBefore(row, template)
        }
      }
    } finally {
      observer?.observe(document.body, { childList: true, subtree: true, characterData: true })
      applying = false
    }
  }

  apply()
  // Menus mount at the document body on open; only re-scan while one exists.
  observer = new MutationObserver(() => {
    if (document.querySelector('[role="menu"]') !== null) apply()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    if (observer !== null) observer.disconnect()
    observer = null
  }
}
