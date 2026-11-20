/**
 * `@local/dsh-no-workspace` — Host entry.
 *
 * The plugin is a bundle row: `cordis.patch.yml` inserts `no-workspace`, whose
 * `Config` is `{ root }`. Everything the Host does lives in `service.ts`.
 */
import { Remote } from '@deepseek-ai/dsh-typert-protocol'

import NoWorkspaceService from './service.js'

export default NoWorkspaceService

// DSH discovers Remote methods from decorator metadata. This entry is plain ESM
// with no build-time decorator transform, so the decorator is applied to the
// prototype directly; its initializer target is the instance prototype, exactly
// what TypeScript's `@Remote` would produce.
const prototype = NoWorkspaceService.prototype
Remote(prototype.create, {
  kind: 'method',
  name: 'create',
  static: false,
  private: false,
  addInitializer(initialize): void {
    initialize.call(Object.create(prototype))
  },
})
