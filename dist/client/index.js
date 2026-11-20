// @local/dsh-no-workspace — generated from src/client by scripts/build-client.mjs; do not edit.

// src/client/locale.ts
var LOCALE_NAMESPACE = "no-workspace";
var DICTIONARIES = {
  zh: {
    /** Hero chip when the conversation has its own automatic directory. */
    standalone: "\u4E0D\u5728\u5DE5\u4F5C\u533A\u4E2D\u5DE5\u4F5C",
    /** Workspace-picker action that moves a conversation off every Workspace. */
    option: "\u4E0D\u4F7F\u7528\u5DE5\u4F5C\u533A"
  },
  en: {
    standalone: "Not in a workspace",
    option: "Use no workspace"
  }
};
var FALLBACK_LABEL = DICTIONARIES.zh.standalone;
var FALLBACK_OPTION = DICTIONARIES.zh.option;
function registerDictionaries(localization) {
  if (localization === void 0) return () => {
  };
  try {
    return localization.register(LOCALE_NAMESPACE, DICTIONARIES);
  } catch (error) {
    console.warn("no-workspace: locale registration failed:", error);
    return () => {
    };
  }
}
function createText(localization) {
  const translate = localization === void 0 ? void 0 : localization.bind(LOCALE_NAMESPACE);
  const resolve = (key, fallback) => {
    if (translate === void 0) return fallback;
    const value = translate(key);
    return value !== void 0 && value.length > 0 && value !== key ? value : fallback;
  };
  return {
    label: () => resolve("standalone", FALLBACK_LABEL),
    option: () => resolve("option", FALLBACK_OPTION),
    revision: () => localization?.getLocale().revision ?? 0,
    subscribe: (listener) => localization?.subscribe(listener)
  };
}

// src/client/options.ts
var NO_WORKSPACE_OPTION_ID = "no-workspace:standalone";
var NO_WORKSPACE_ICON = "dsw-icon-close-outline-regular";
function noWorkspaceOption(sessionId, title) {
  return {
    workspaceId: NO_WORKSPACE_OPTION_ID,
    path: "",
    title,
    sessionIds: sessionId === void 0 ? [] : [sessionId],
    createdAt: "",
    updatedAt: ""
  };
}

// src/client/services.ts
function service(ctx, name) {
  const value = ctx.get(name);
  return value === void 0 || value === null ? void 0 : value;
}
function uiWorkspace(ctx) {
  const value = service(ctx, "uiWorkspace");
  return value !== void 0 && typeof value.startSession === "function" ? value : void 0;
}
function uiSession(ctx) {
  const value = service(ctx, "uiSession");
  return value !== void 0 && value.adapter !== void 0 && value.adapter.current !== void 0 ? value : void 0;
}
function workspaces(ctx) {
  const value = service(ctx, "workspaces");
  return value !== void 0 && value.list !== void 0 ? value : void 0;
}
function sessions(ctx) {
  const value = service(ctx, "sessions");
  return value !== void 0 && value.list !== void 0 ? value : void 0;
}
function connection(ctx) {
  const value = service(ctx, "connection");
  return value !== void 0 && value.rpc !== void 0 && typeof value.rpc.call === "function" ? value : void 0;
}
function layout(ctx) {
  const value = service(ctx, "layout");
  return value !== void 0 && typeof value.beginNavigation === "function" ? value : void 0;
}
function conversation(ctx) {
  const value = service(ctx, "conversation");
  return value !== void 0 && value.input !== void 0 ? value : void 0;
}
function locale(ctx) {
  const value = service(ctx, "locale");
  return value !== void 0 && typeof value.register === "function" && typeof value.bind === "function" ? value : void 0;
}

// src/client/identity.ts
var DIRECTORY_PREFIX = "dsh-chat-";
var pendingCreated;
function baseName(path) {
  if (path === void 0 || path.length === 0) return "";
  return path.split(/[\\/]+/).filter((segment) => segment.length > 0).at(-1) ?? "";
}
function isStandaloneSession(sessionId, cwd) {
  if (sessionId === void 0 || sessionId.length === 0) return false;
  return baseName(cwd) === `${DIRECTORY_PREFIX}${sessionId}`;
}
function rememberCreated(session) {
  pendingCreated = session;
}
function pendingCwd(sessionId) {
  if (sessionId === void 0 || pendingCreated === void 0) return void 0;
  return pendingCreated.sessionId === sessionId ? pendingCreated.cwd : void 0;
}
function isPending(sessionId) {
  return sessionId !== void 0 && pendingCreated !== void 0 && pendingCreated.sessionId === sessionId;
}
function settlePending(sessionId, summaryCwd) {
  if (pendingCreated !== void 0 && pendingCreated.sessionId === sessionId && summaryCwd !== void 0) {
    pendingCreated = void 0;
  }
}
function clearPending() {
  pendingCreated = void 0;
}

// src/client/sessions.ts
function identityOf(binding) {
  if (binding === void 0) return void 0;
  const identity = binding.key ?? binding.sessionId;
  return typeof identity === "string" && identity.length > 0 ? identity : void 0;
}
function summaryOf(controller, sessionId) {
  if (controller === void 0 || sessionId === void 0 || sessionId.length === 0) return void 0;
  return controller.list.getSnapshot().byId?.[sessionId];
}
function cwdOf(controller, sessionId) {
  const pending = pendingCwd(sessionId);
  if (pending !== void 0) return pending;
  return summaryOf(controller, sessionId)?.cwd;
}
function currentNewConversation(ctx) {
  const binding = uiSession(ctx)?.adapter.current.getSnapshot();
  const sessionId = identityOf(binding);
  if (sessionId === void 0) return void 0;
  const controller = sessions(ctx);
  const summary = summaryOf(controller, sessionId);
  const blank = summary === void 0 ? isPending(sessionId) : summary.blank === true;
  if (!blank) return "active";
  if (isStandaloneSession(sessionId, cwdOf(controller, sessionId))) return "standalone";
  const items = workspaces(ctx)?.list.getSnapshot().items ?? [];
  const listed = items.some((item) => item.sessionIds.includes(sessionId));
  return listed ? "workspace" : void 0;
}

// src/client/standalone.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
async function createUngroupedSession(ctx, agentPreset, signal) {
  const link = connection(ctx);
  if (link === void 0) throw new Error("no-workspace: connection service is unavailable");
  const payload = { args: { request: agentPreset === void 0 ? {} : { agentPreset } } };
  const result = await link.rpc.call("/api", "no-workspace/create", payload, signal);
  if (!isRecord(result) || result["ok"] !== true) {
    const failure = isRecord(result) ? result : {};
    const code = failure.error?.code;
    const message = failure.error?.message;
    const error = new Error(message !== void 0 && message.length > 0 ? message : "no-workspace/create returned no value");
    if (code !== void 0) Object.assign(error, { code });
    throw error;
  }
  const value = result["value"];
  const sessionId = isRecord(value) ? value["sessionId"] : void 0;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("no-workspace/create returned no sessionId");
  }
  const rawCwd = isRecord(value) ? value["cwd"] : void 0;
  const cwd = typeof rawCwd === "string" && rawCwd.length > 0 ? rawCwd : void 0;
  if (cwd !== void 0) rememberCreated({ sessionId, cwd });
  return { sessionId, cwd };
}

// src/client/navigation.ts
function wantsDraftInitialization(draftOptions) {
  if (draftOptions === void 0) return false;
  return draftOptions.prompt !== void 0 || (draftOptions.whenDraftExists ?? (draftOptions.clearPreviousDraft === true ? "replace" : "keep")) === "replace";
}
function installNavigation(ctx) {
  const resolved = ctx.get("uiWorkspace");
  if (resolved === void 0 || typeof resolved.startSession !== "function") {
    console.warn("no-workspace: uiWorkspace.startSession is unavailable; client entry skipped");
    return void 0;
  }
  const service2 = resolved;
  const hadOwnStartSession = Object.prototype.hasOwnProperty.call(service2, "startSession");
  const originalStartSession = service2.startSession;
  const hadOwnOpenWorkspace = Object.prototype.hasOwnProperty.call(service2, "openWorkspace");
  const originalOpenWorkspace = service2.openWorkspace;
  const wrapsOpenWorkspace = typeof originalOpenWorkspace === "function";
  const lifetime = new AbortController();
  const inFlight = /* @__PURE__ */ new Map();
  let disposed = false;
  let startEpoch = 0;
  const requestSession = (agentPreset) => {
    const key = agentPreset === void 0 ? "" : `preset:${agentPreset}`;
    const pending = inFlight.get(key);
    if (pending !== void 0) return pending;
    const created = createUngroupedSession(ctx, agentPreset, lifetime.signal).finally(() => {
      if (inFlight.get(key) === created) inFlight.delete(key);
    });
    inFlight.set(key, created);
    return created;
  };
  const reportFailure = (error) => {
    const record = typeof error === "object" && error !== null ? error : {};
    const code = typeof record["code"] === "string" ? record["code"] : void 0;
    const message = typeof record["message"] === "string" && record["message"].length > 0 ? record["message"] : String(error);
    if (typeof service2.notify === "function") {
      try {
        service2.notify({ kind: "createFailed", message: code === void 0 ? message : `${code}: ${message}` });
      } catch {
      }
    }
    console.warn("no-workspace: new conversation failed:", error);
  };
  function focusComposer(attempts = 12) {
    try {
      const input = conversation(ctx)?.input;
      if (typeof input?.focus === "function") input.focus();
    } catch (error) {
      console.warn("no-workspace: focusing the composer failed:", error);
    }
    if (attempts > 1) {
      const timer = setTimeout(() => {
        if (!disposed) focusComposer(attempts - 1);
      }, 120);
      const maybeNodeTimer = timer;
      if (typeof maybeNodeTimer.unref === "function") maybeNodeTimer.unref();
    }
  }
  const applyDraft = (sessionId, draftOptions) => {
    if (draftOptions === void 0) return;
    try {
      const sessions2 = sessions(ctx);
      const conversation2 = conversation(ctx);
      const binding = sessions2?.binding(sessionId);
      if (conversation2 === void 0 || binding === void 0) {
        throw new Error("draft initialization services are unavailable");
      }
      const outcome = conversation2.input.requestDraftInitialization(binding, draftOptions);
      if (outcome === "blocked") throw new Error("the draft is blocked by a pending submission");
    } catch (error) {
      console.warn("no-workspace: draft initialization failed:", error);
    }
  };
  function startStandalone(options, migrate) {
    const { agentPreset, ...draftOptions } = options ?? {};
    const initializeDraft = wantsDraftInitialization(options === void 0 ? void 0 : draftOptions);
    const epoch = ++startEpoch;
    const restorationAtStart = service2.restorationNavigation;
    const layout2 = layout(ctx) ?? void 0;
    const navigation = typeof layout2?.beginNavigation === "function" ? layout2.beginNavigation() : lifetime.signal;
    return requestSession(agentPreset).then(({ sessionId }) => {
      if (disposed || epoch !== startEpoch) return;
      let activeNavigation = navigation;
      if (activeNavigation.aborted) {
        const restoration = service2.restorationNavigation;
        const initialRestoreTookOver = restorationAtStart === void 0 && restoration !== void 0 && !restoration.aborted;
        if (!initialRestoreTookOver) return;
        activeNavigation = layout2.beginNavigation();
      }
      const beforeOpen = initializeDraft || migrate !== void 0 ? (id) => {
        if (migrate !== void 0) {
          try {
            migrate(id);
          } catch (error) {
            console.warn("no-workspace: draft migration failed:", error);
          }
        }
        if (initializeDraft) applyDraft(id, draftOptions);
      } : void 0;
      if (typeof service2.replaceMain === "function") {
        service2.replaceMain(sessionId, activeNavigation, "reveal", beforeOpen);
      } else {
        beforeOpen?.(sessionId);
        service2.openSession(sessionId);
      }
      if (!initializeDraft) focusComposer();
    }).catch((error) => {
      const name = typeof error === "object" && error !== null ? error.name : void 0;
      if (!disposed && epoch === startEpoch && name !== "AbortError") reportFailure(error);
    });
  }
  function startSession(workspaceId, options) {
    if (workspaceId !== void 0) {
      startEpoch += 1;
      return originalStartSession.apply(this ?? service2, [workspaceId, options]);
    }
    if (!wantsDraftInitialization(options) && inFlight.size === 0) {
      const existing = currentNewConversation(ctx);
      if (existing === "standalone") return void 0;
      if (existing === "workspace") {
        startEpoch += 1;
        return originalStartSession.apply(this ?? service2, [workspaceId, options]);
      }
    }
    return startStandalone(options);
  }
  function openWorkspace(workspaceId, beforeOpen, options) {
    if (workspaceId !== NO_WORKSPACE_OPTION_ID) {
      startEpoch += 1;
      return originalOpenWorkspace?.apply(this ?? service2, [workspaceId, beforeOpen, options]);
    }
    if (inFlight.size === 0 && currentNewConversation(ctx) === "standalone") return Promise.resolve();
    return startStandalone(void 0, beforeOpen);
  }
  ctx.effect(
    () => {
      service2.startSession = startSession;
      if (wrapsOpenWorkspace) service2.openWorkspace = openWorkspace;
      return () => {
        disposed = true;
        lifetime.abort();
        inFlight.clear();
        if (hadOwnStartSession) service2.startSession = originalStartSession;
        else delete service2.startSession;
        if (wrapsOpenWorkspace) {
          if (hadOwnOpenWorkspace) service2.openWorkspace = originalOpenWorkspace;
          else delete service2.openWorkspace;
        }
      };
    },
    "no-workspace: wrap uiWorkspace startSession/openWorkspace"
  );
  return {
    wrapsOpenWorkspace,
    openOption: () => openWorkspace.call(service2, NO_WORKSPACE_OPTION_ID, void 0, void 0)
  };
}

// src/client/picker-menu.ts
var MARK = "data-no-workspace-action";
function isWorkspacePicker(menu, footer) {
  if (menu.closest("[data-context-menu]") !== null) return false;
  if (menu.querySelector('svg[data-icon*="folder-close"]') === null) return false;
  return [...footer.children].some((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null);
}
function addTemplate(footer) {
  return [...footer.children].find((wrap) => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null);
}
function installPickerFooterAction(options) {
  if (typeof document === "undefined" || typeof MutationObserver !== "function") return () => {
  };
  let observer = null;
  let applying = false;
  const adopt = (row) => {
    const button = row.querySelector('button[role="menuitem"]');
    if (button === null) return;
    for (const icon of row.querySelectorAll('[class*="itemIcon"] svg')) {
      icon.setAttribute("data-icon", NO_WORKSPACE_ICON);
      const use = icon.querySelector("use");
      if (use !== null) use.setAttribute("href", `#${NO_WORKSPACE_ICON}`);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const report = (error) => {
        console.warn("no-workspace: opening a standalone chat failed:", error);
        try {
          options.conversationNotice()?.(error);
        } catch {
        }
      };
      try {
        Promise.resolve(options.chooseNotInWorkspace()).catch(report);
      } catch (error) {
        report(error);
      }
    });
    const labelNode = row.querySelector('[class*="itemLabel"]');
    if (labelNode !== null) labelNode.textContent = options.text.option();
  };
  const apply2 = () => {
    if (applying) return;
    applying = true;
    observer?.disconnect();
    try {
      const label = options.text.option();
      for (const menu of document.querySelectorAll('[role="menu"]')) {
        const footer = menu.querySelector('[role="presentation"][class*="footer"]');
        if (footer === null || !isWorkspacePicker(menu, footer)) continue;
        const template = addTemplate(footer);
        if (template === void 0) continue;
        const duplicates = footer.querySelectorAll(`[${MARK}]`);
        for (let index = 1; index < duplicates.length; index += 1) duplicates[index]?.remove();
        let row = footer.querySelector(`[${MARK}]`);
        if (row === null) {
          row = template.cloneNode(true);
          row.setAttribute(MARK, "1");
          for (const check of row.querySelectorAll('[class*="check"]')) check.remove();
          for (const button of row.querySelectorAll("button")) {
            for (const name of [...button.classList]) {
              if (name.includes("selected")) button.classList.remove(name);
            }
          }
          adopt(row);
          footer.insertBefore(row, template);
        } else {
          const labelNode = row.querySelector('[class*="itemLabel"]');
          if (labelNode !== null && labelNode.textContent !== label) labelNode.textContent = label;
          if (row.nextElementSibling !== template) footer.insertBefore(row, template);
        }
      }
    } finally {
      observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
      applying = false;
    }
  };
  apply2();
  observer = new MutationObserver(() => {
    if (document.querySelector('[role="menu"]') !== null) apply2();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    if (observer !== null) observer.disconnect();
    observer = null;
  };
}

// src/client/workspace-view.ts
var MAX_SOURCES = 16;
function installWorkspacePickerView(uiSession2, workspaces2, sessions2, text) {
  const current = uiSession2.adapter.current;
  const sources = /* @__PURE__ */ new Map();
  function build(sessionId, standalone, title) {
    const entry = { list: void 0, row: void 0, snapshot: void 0 };
    return {
      getSnapshot() {
        if (!standalone) return workspaces2.list.getSnapshot();
        const list = workspaces2.list.getSnapshot();
        if (entry.list === list && entry.snapshot !== void 0) return entry.snapshot;
        entry.list = list;
        entry.row ??= noWorkspaceOption(sessionId, title);
        entry.snapshot = { ...list, items: [...list.items, entry.row] };
        return entry.snapshot;
      },
      subscribe(listener) {
        const offList = workspaces2.list.subscribe(listener);
        const offSessions2 = sessions2.list.subscribe(listener);
        const offText = text.subscribe(listener);
        return () => {
          offList();
          offSessions2();
          offText?.();
        };
      }
    };
  }
  const sourceFor = (rawSessionId) => {
    const sessionId = rawSessionId !== void 0 && rawSessionId.length > 0 ? rawSessionId : void 0;
    if (sessionId === void 0) return workspaces2.list;
    const cwd = cwdOf(sessions2, sessionId);
    const standalone = isStandaloneSession(sessionId, cwd);
    const title = standalone ? text.label() : "";
    const key = `${sessionId}\0${cwd ?? ""}\0${String(standalone)}\0${title}\0${String(text.revision())}`;
    const known = sources.get(key);
    if (known !== void 0) return known;
    const source = build(sessionId, standalone, title);
    if (sources.size > MAX_SOURCES) sources.clear();
    sources.set(key, source);
    return source;
  };
  let providerDispose;
  let installingProvider = false;
  const syncProvider = () => {
    const sessionId = identityOf(current.getSnapshot());
    if (sessionId !== void 0) settlePending(sessionId, summaryOf(sessions2, sessionId)?.cwd);
    if (sessionId === void 0) {
      if (providerDispose !== void 0) {
        const dispose = providerDispose;
        providerDispose = void 0;
        dispose();
      }
      return;
    }
    if (providerDispose === void 0 && !installingProvider) {
      installingProvider = true;
      try {
        providerDispose = uiSession2.provide({
          hooks: ["workspaces"],
          resolve: (binding) => ({ hooks: { workspaces: sourceFor(identityOf(binding)) } })
        });
      } finally {
        installingProvider = false;
      }
    }
  };
  const offCurrent = current.subscribe(syncProvider);
  const offSessions = sessions2.list.subscribe(syncProvider);
  syncProvider();
  return () => {
    offCurrent();
    offSessions();
    if (providerDispose !== void 0) {
      const dispose = providerDispose;
      providerDispose = void 0;
      dispose();
    }
    sources.clear();
    clearPending();
  };
}

// src/client/index.ts
var PACKAGE_ID = "@local/dsh-no-workspace";
var inject = ["uiWorkspace", "connection", "sessions", "uiSession", "workspaces", "locale"];
function noticeChannel(ctx) {
  const service2 = uiWorkspace(ctx);
  if (service2 === void 0 || typeof service2.notify !== "function") return void 0;
  return (error) => {
    const record = typeof error === "object" && error !== null ? error : {};
    const code = typeof record["code"] === "string" ? record["code"] : void 0;
    const message = typeof record["message"] === "string" && record["message"].length > 0 ? record["message"] : String(error);
    try {
      service2.notify?.({ kind: "createFailed", message: code === void 0 ? message : `${code}: ${message}` });
    } catch {
    }
  };
}
function apply(ctx) {
  const navigation = installNavigation(ctx);
  if (navigation === void 0) return;
  ctx.effect(
    () => registerDictionaries(locale(ctx)),
    "no-workspace: locale dictionaries"
  );
  const text = createText(locale(ctx));
  const uiSession2 = uiSession(ctx);
  const workspaces2 = workspaces(ctx);
  const sessions2 = sessions(ctx);
  if (uiSession2 !== void 0 && workspaces2 !== void 0 && sessions2 !== void 0) {
    ctx.effect(
      () => installWorkspacePickerView(uiSession2, workspaces2, sessions2, text),
      "no-workspace: conversation workspace view"
    );
    if (navigation.wrapsOpenWorkspace) {
      ctx.effect(
        () => installPickerFooterAction({
          text,
          chooseNotInWorkspace: () => navigation.openOption(),
          conversationNotice: () => noticeChannel(ctx)
        }),
        "no-workspace: picker footer action"
      );
    }
  }
}
var module = { inject, apply };
var loader = window.__ModuleLoader__;
if (loader !== void 0) loader.load({ id: PACKAGE_ID, factory: () => module });
