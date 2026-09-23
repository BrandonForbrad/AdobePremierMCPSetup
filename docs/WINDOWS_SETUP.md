# Windows setup and Premiere editing guide

This guide is for a first-time user. Installation is automated; Adobe requires
one manual panel-opening step inside Premiere.

## 1. Before installing

1. Install [Node.js 20 LTS or newer](https://nodejs.org/).
2. Open PowerShell and confirm:

   ```powershell
   node --version
   npm --version
   ```

3. Install Adobe Premiere Pro 2020 or newer through Creative Cloud.
4. Save any open work, then fully quit Premiere and your AI applications.

Administrator PowerShell is normally not required. The server, panel, registry
setting, and configuration are installed for the current Windows user.

## 2. Run the one command

In PowerShell:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup
```

Wait for `Premiere MCP setup is installed.` The summary lists each client as:

- `added`: a new MCP entry was created.
- `unchanged`: the correct entry already existed.
- `replaced`: `--force` backed up and replaced an old entry.
- `conflict`: a different entry was preserved. Nothing was overwritten.
- `not-detected`: that optional application was not found.

Setup also installs a private, pinned FFmpeg binary. The MCP server receives
its directory through `PATH`, enabling `detect_silence` without requiring
Chocolatey, WinGet, administrator access, or a system-wide PATH change.

OpenAI Codex and Cursor configuration is always prepared. To prepare all
supported clients, including ones you will install later, rerun:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup --all-clients
```

## 3. Activate the panel in Premiere once

1. Start Premiere Pro.
2. Open an existing project or create a blank project.
3. In the top menu, choose **Window > Extensions > MCP Bridge (CEP)**.
4. In the MCP Bridge panel, confirm the directory is:

   ```text
   %TEMP%\premiere-mcp-bridge
   ```

   The panel normally displays the expanded path, such as
   `C:\Users\YourName\AppData\Local\Temp\premiere-mcp-bridge`.

5. Choose **Save Configuration** if you changed the field.
6. Choose **Start Bridge** if the bridge is not already running.
7. Leave this panel open. It can be docked with other Premiere panels.

The included UXP panel is experimental and is not used by this setup. Use the
CEP panel named exactly **MCP Bridge (CEP)**.

## 4. Restart and verify your AI client

Fully quit and reopen the client after setup.

### OpenAI Codex

Codex CLI and the Codex app share `%USERPROFILE%\.codex\config.toml`. Start a
Codex session and ask:

```text
Run verify_premiere_connection. Make no changes.
```

### Cursor

Open Cursor Settings, search for `MCP`, and confirm `premiere-pro` is enabled.
Then ask the same verification prompt in Agent chat.

### Claude Desktop or Claude Code

Completely quit Claude, including its notification-area process, then reopen
it. Approve the local server if prompted and run the verification prompt.

### VS Code with GitHub Copilot

Restart VS Code. Open the MCP server list, start or trust `premiere-pro` if
prompted, and use Copilot Agent mode for the verification prompt.

A successful result identifies the Premiere version, open project, and active
sequence without changing anything.

## 5. Make a safe first edit

Before asking an AI to edit:

1. In Premiere choose **File > Save As** and create a working copy.
2. Make the intended sequence active.
3. Keep the MCP Bridge panel open.
4. Tell the AI to inspect before changing anything.

Use this first prompt:

```text
Verify the Premiere connection. Inspect the active project, active sequence,
tracks, and clips. Do not make changes. Summarize what you found and propose
the exact edit operations.
```

After reviewing the plan, request one focused edit. Examples:

```text
On the active sequence, razor all linked audio and video tracks at 12.5
seconds. Do not delete anything. Read the timeline back and report the result.
```

```text
Remove the section from 00:00:18:00 through 00:00:22:00 on V1 and its linked
audio, ripple-close the gap, then verify clip timing. Do not affect other
tracks.
```

```text
Import C:\Video\interview.mp4, create a sequence from that clip, and build a
rough cut using the source ranges I provide. Save the project after verifying
the sequence.
```

```text
Find every cut on V1 and add a short Cross Dissolve only where sufficient
handles exist. Skip unsafe cuts and report them.
```

The MCP exposes a small default tool list. A capable agent should call
`search_tools`, optionally `get_tool_schema`, and then `invoke_tool` for
operations such as:

- `razor_timeline_at_time` or `razor_all_tracks` for cuts
- `trim_clip`, `slip_edit`, `slide_edit`, and `roll_edit` for trims
- `remove_from_timeline` or `ripple_delete` for removals
- `add_to_timeline_batch` for assemblies
- `undo` or `multiple_undo` to revert recent operations
- `save_project` or `save_project_as` after verification

Always identify the target sequence, track, clip, and time range. For risky
changes, request one operation and a read-back before continuing.

## 6. Useful editing workflow

For predictable sessions, use this order:

1. `verify_premiere_connection`
2. Inspect project items and sequences.
3. Inspect the active timeline and track structure.
4. State the edit plan without mutations.
5. Make one focused mutation.
6. Read back the affected clips or timeline range.
7. Undo immediately if the result is wrong.
8. Save only after verification.

Premiere's scripting API has real limits. Some UI-only operations, caption
text reads, effect removal, and Media Encoder status may be unavailable or only
partly verifiable. Professional graphics still require real MOGRT assets.

## 7. Diagnose problems

Run:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup doctor
```

### The extension is missing

1. Confirm Premiere 2020 or newer is installed.
2. Fully restart Premiere after installation.
3. Run the installer again.
4. Run `doctor` and check **CEP extension** and **Adobe CEP debug mode**.
5. Confirm this file exists:

   ```text
   %APPDATA%\Adobe\CEP\extensions\MCPBridgeCEP\CSXS\manifest.xml
   ```

Do not switch to the experimental UXP panel.

### Tools appear, but every call times out

1. Open a Premiere project.
2. Open **Window > Extensions > MCP Bridge (CEP)**.
3. Confirm its path exactly matches the installer summary.
4. Start the bridge.
5. Run `doctor`; the heartbeat should be `fresh`.
6. Retry `verify_premiere_connection`.

The MCP server and panel must use the same directory. A random
`premiere-bridge-...` directory indicates an old or incorrect client entry.

### `detect_silence` says FFmpeg is missing

Rerun the one-command installer, restart the AI client, and run `doctor`.
The **FFmpeg** check should show:

```text
%LOCALAPPDATA%\PremiereMCP\node_modules\ffmpeg-static\ffmpeg.exe
```

The installer intentionally does not modify the machine-wide Windows `PATH`.
Its MCP client entries provide the private FFmpeg directory only to this
server.

### The AI client does not show `premiere-pro`

1. Fully quit and restart the client.
2. Check its MCP settings for a disabled or untrusted server.
3. Rerun with `--all-clients`.
4. If setup reports `conflict`, inspect the old entry. Use `--force` only when
   you intend to replace it.
5. Enterprise policies can disable local MCP servers; contact the administrator
   if the client reports that restriction.

### A client configuration file is malformed

The installer stops rather than rewriting malformed JSON/JSONC or an
unrecognized existing entry. Repair the file in the client first, then rerun
setup. Backups created by this installer are stored under:

```text
%LOCALAPPDATA%\PremiereMCP\backups
```

## 8. Other MCP-compatible AI clients

The installer writes a ready-to-copy generic configuration:

```text
%LOCALAPPDATA%\PremiereMCP\premiere-pro.mcp.json
```

For a JSON host using `mcpServers`, the shape is:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\path\\to\\node.exe",
      "args": [
        "C:\\Users\\YourName\\AppData\\Local\\PremiereMCP\\node_modules\\adobe-premiere-pro-mcp\\dist\\index.js"
      ],
      "env": {
        "PREMIERE_TEMP_DIR": "C:\\Users\\YourName\\AppData\\Local\\Temp\\premiere-mcp-bridge",
        "PREMIERE_MCP_TELEMETRY": "0"
      }
    }
  }
}
```

Use the generated file's real absolute paths rather than these placeholders.
The other application must support local stdio MCP servers. Remote HTTP-only
connectors and ordinary web chats cannot launch this local process.

## 9. Remove or restore setup

To remove installer-owned configuration and restore backups:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup uninstall
```

`rollback` performs the same restoration and is useful immediately after a
setup attempt:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup rollback
```

Entries changed by you after installation are left untouched. Previous CEP
files and Adobe debug registry values are restored when they were present
before setup. No Premiere project or media file is removed.
