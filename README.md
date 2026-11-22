# DSH No-Workspace Chat

<p align="center">
  <strong>A DeepSeek Harness (DSH) plugin that automatically creates an isolated working directory for each new conversation.</strong>
</p>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

---

## What It Does

**DSH No-Workspace Chat** (`@local/dsh-no-workspace`) removes the friction of having to create or pick a workspace before chatting in **DeepSeek Harness (DSH)**:

- **Instant isolated conversations**: Click the global **New Chat** button in the DSH sidebar (or use the native shortcut) and start typing right away. The plugin automatically creates a dedicated directory `dsh-chat-<session-id>` for the conversation.
- **Keeps your workspace list clean**: Auto-created directories are saved as the conversation's native working directory and appear under **Ungrouped**, never cluttering your sidebar workspace list or workspace count. The top directory badge shows *Not working in a workspace* instead of exposing the internal folder name.
- **Smart draft reuse & persistence**: Clicking **New Chat** again while still in an empty draft reuses the current session without creating duplicate directories; a new directory is only allocated after you send the first message. Files on disk are preserved when you archive a chat or disable the plugin.
- **Switch out of a workspace anytime**: When a chat is currently inside a workspace, the workspace picker menu adds a **Use no workspace** option right above *Add Workspace*, switching the chat to a fresh isolated directory and focusing the input box.

## Environment & Requirements

| Item | Requirement / Details |
| :--- | :--- |
| **Host Application** | DeepSeek Harness (DSH), verified on **DSH `0.2.2-rc.5`** (Windows Desktop & CLI) |
| **Plugin Architecture** | Host service (Node.js / Cordis bundle via `cordis.patch.yml`) + Web client (`@deepseek-ai/dsh-client-ui-workspace`) |
| **Build / Dev Runtime** | Node.js (v22+ recommended), npm, TypeScript, esbuild |

## Installation

### Option 1: Install via DSH UI

1. Open **Plugins** in DSH and click **+ Add Plugin**.
2. Paste the repository URL (or download a prebuilt `.tgz` from [GitHub Releases](../../releases)):
   ```text
   https://github.com/TacKana/DSH-No-Workspace
   ```
3. Click **Install**.

> To update to a newer version later, uninstall the existing plugin first and then install it again.

### Option 2: Install via CLI / Release Package

You can also install directly from the GitHub repository or a `.tgz` archive downloaded from [GitHub Releases](../../releases) using the DSH CLI:

```powershell
# Install directly from GitHub
dsh plugin add https://github.com/TacKana/DSH-No-Workspace

# Or install from a downloaded .tgz package (use file:, not link:)
dsh plugin add "file:$(Resolve-Path '.\local-dsh-no-workspace-<version>.tgz')"
```

If you are building from source:

```powershell
npm ci
npm run build
npm pack --ignore-scripts
```

## Configuration

Open **Plugins → Workspace-free chat** in DSH:

- **`root`**: Absolute path on the host machine where conversation directories will be created (e.g. `D:\DSH\Chats`). When left empty, it defaults to `<profile>/session-workspaces`. Changing this setting only affects newly created conversations.

## Project Structure

```text
src/host/     Host-side (Node.js): entry point, Cordis service, directory allocation, errors
src/client/   Browser-side: entry point & modules (locale, identity, sessions, standalone,
              options, workspace-view, picker-menu, navigation)
types/        Ambient type declarations for host dependencies inside DSH
scripts/      Build script (esbuild bundler for client)
dist/         Compiled outputs: dist/host (tsc) & dist/client/index.js (esbuild)
test/         Unit/integration tests (test/client/) and E2E smoke tests (test/dev-*.mjs)
```

## Development & Testing

```powershell
npm run build      # Build both host (tsc) and client (esbuild)
npm run typecheck  # Strict TypeScript checks for both host and client configs
npm test           # Client unit tests + Cordis integration test
```

- `test/client/cordis.integration.test.mjs` reads Cordis from DSH's `app.asar` and requires `ELECTRON_RUN_AS_NODE=1` with DSH's bundled Node executable (automatically skipped in standard CI environments where `DSH_INSTALL_DIR` is unset).
- After installing into a dev profile, run `npm run test:smoke` (host-side verification) or `npm run test:browser` (full Chromium E2E flow; set `DSH_TEST_CHROME` if needed). `node test/dev-smoke.mjs --default-root` verifies the default `session-workspaces` fallback.

## Known Limitations

- The **Use no workspace** menu item is cloned from DSH's native *Add Workspace* menu row with its icon replaced by `dsw-icon-close-outline-regular`. This relies on DSH's internal DOM structure, `data-icon` naming, `conversation.input.focus()`, and wrapping `uiWorkspace.startSession` / `openWorkspace`. These are internal DSH implementation details rather than public extension APIs and should be re-verified when upgrading DSH.
- To customize the icon, update `NO_WORKSPACE_ICON` in `src/client/options.ts` and rebuild (`node test/icon-gallery.mjs icon.png` renders all built-in DSH icons for reference).

## License

This project is licensed under the [Apache License 2.0](LICENSE) (`Apache-2.0`).
