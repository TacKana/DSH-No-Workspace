/**
 * `@local/dsh-no-workspace` —— Host 入口。
 *
 * 该插件是一个 bundle 行：`cordis.patch.yml` 插入 `no-workspace`，其
 * `Config` 为 `{ root }`。Host 的一切行为都位于 `service.ts` 中。
 */
import { Remote } from '@deepseek-ai/dsh-typert-protocol';
import NoWorkspaceService from './service.js';
export default NoWorkspaceService;
// DSH 从装饰器元数据中发现 Remote 方法。本入口是纯 ESM，
// 没有构建期的装饰器变换，因此装饰器直接应用于原型；
// 其初始化目标就是实例原型，与 TypeScript 的 `@Remote` 所产生的结果完全一致。
const prototype = NoWorkspaceService.prototype;
Remote(prototype.create, {
    kind: 'method',
    name: 'create',
    static: false,
    private: false,
    addInitializer(initialize) {
        initialize.call(Object.create(prototype));
    },
});
