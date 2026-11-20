import type { Text } from './locale.js'
import { NO_WORKSPACE_ICON } from './options.js'
import type { Unsubscribe } from './types.js'

/** 标记注入行的属性，使各次处理保持幂等。 */
const MARK = 'data-no-workspace-action'

/** 对话界面已经理解的原生失败通知。 */
export type ConversationNotice = (error: unknown) => void

/** 注入的选择器操作的协作者。 */
export interface PickerActionOptions {
  /** 本地化的菜单标签。 */
  text: Pick<Text, 'option'>
  /** 运行哨兵打开操作；可能返回一个 promise。 */
  chooseNotInWorkspace(): unknown
  /** 解析原生失败通知（当界面提供时）。 */
  conversationNotice(): ConversationNotice | undefined
}

/** 菜单行是否属于工作区选择器（而非上下文菜单）。 */
function isWorkspacePicker(menu: Element, footer: Element): boolean {
  if (menu.closest('[data-context-menu]') !== null) return false
  if (menu.querySelector('svg[data-icon*="folder-close"]') === null) return false
  return [...footer.children].some((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
}

/** 携带添加文件夹操作的页脚包装元素。 */
function addTemplate(footer: Element): Element | undefined {
  return [...footer.children].find((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
}

/**
 * 将“不在工作区中”操作镜像到打开的 Workspace 菜单中，放在
 * 包含“添加文件夹”的页脚组内。
 *
 * 原生菜单根据其自身的添加入口构建页脚，从不为此读取工作区快照，
 * 因此实时的添加行会被克隆、重新标记，并插入到它之前。不会向任何快照添加内容，
 * 因此侧边栏、计数和命令面板都无法看到该操作。
 */
export function installPickerFooterAction(options: PickerActionOptions): Unsubscribe {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}

  let observer: MutationObserver | null = null
  let applying = false

  /** 将一个克隆的添加行收编为独立操作。 */
  const adopt = (row: Element): void => {
    const button = row.querySelector('button[role="menuitem"]')
    if (button === null) return
    // 保留克隆的图标槽位，但将其指向“离开项目”字形：
    // 一个加号（添加行）足够，两个会被理解成“又一个新文件夹”。
    for (const icon of row.querySelectorAll('[class*="itemIcon"] svg')) {
      icon.setAttribute('data-icon', NO_WORKSPACE_ICON)
      const use = icon.querySelector('use')
      if (use !== null) use.setAttribute('href', `#${NO_WORKSPACE_ICON}`)
    }
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // 菜单监听 document 上的 Escape，并关闭一次。
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const report = (error: unknown): void => {
        console.warn('no-workspace: opening a standalone chat failed:', error)
        try {
          // 菜单已经关闭，因此通过正常通道报告。
          options.conversationNotice()?.(error)
        } catch {
          // 通知通道是尽力而为的
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

  /** 在每个打开的 Workspace 菜单中插入或刷新该行（每帧一次处理）。 */
  const apply = (): void => {
    if (applying) return
    applying = true
    // 忽略本次处理产生的变更；否则重新插入一个被
    // React 重新渲染掉的行会永远触发观察器。
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
  // 菜单在打开时挂载到文档 body；仅当存在菜单时才重新扫描。
  observer = new MutationObserver(() => {
    if (document.querySelector('[role="menu"]') !== null) apply()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    if (observer !== null) observer.disconnect()
    observer = null
  }
}
