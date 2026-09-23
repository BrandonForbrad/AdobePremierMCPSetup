# One-command Adobe Premiere Pro MCP setup

Install the local Adobe Premiere Pro MCP bridge on Windows and register it with
OpenAI Codex, Cursor, Claude, and VS Code Copilot.

## Install

Prerequisites:

- Windows 10 or 11
- Node.js 20 or newer
- Adobe Premiere Pro 2020 or newer

Open PowerShell and run:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup
```

From a local clone, the equivalent command is:

```powershell
npx .
```

The installer pins `adobe-premiere-pro-mcp@1.2.8` and
`ffmpeg-static@5.3.0`, installs them under your Windows user profile, installs
the CEP panel, enables Adobe CEP debug mode, and safely adds the `premiere-pro`
server to supported AI clients. The private FFmpeg path is supplied to the MCP
server so silence detection works without a system-wide FFmpeg installation.
Re-running the same command is safe.

It configures OpenAI Codex and Cursor by default. Claude Desktop, Claude Code,
and VS Code Copilot are configured when detected. To prepare every supported
client whether detected or not:

```powershell
npx --yes github:BrandonForbrad/AdobePremierMCPSetup --all-clients
```

Telemetry is off by default. Pass `--telemetry` to opt in to the upstream
project's anonymous usage telemetry.

## Finish once in Premiere

Adobe does not allow this final UI activation to be done headlessly:

1. Fully close and restart Premiere Pro.
2. Open a project.
3. Open **Window > Extensions > MCP Bridge (CEP)**.
4. Confirm the displayed bridge folder ends in `premiere-mcp-bridge`.
5. Click **Start Bridge** if the panel shows that button.
6. Restart Codex, Cursor, Claude, or VS Code.
7. Ask the AI: `Run verify_premiere_connection. Make no changes.`

Then follow the [complete Windows and editing guide](docs/WINDOWS_SETUP.md).

## Maintenance

```powershell
# Check the installation and live Premiere connection
npx --yes github:BrandonForbrad/AdobePremierMCPSetup doctor

# Preview paths and checks without changing anything
npx --yes github:BrandonForbrad/AdobePremierMCPSetup --dry-run

# Remove installer-owned entries and restore prior configuration
npx --yes github:BrandonForbrad/AdobePremierMCPSetup uninstall
```

If an existing `premiere-pro` entry differs, the installer reports a conflict
and leaves it untouched. Review it first, then pass `--force` only if you want
the old entry backed up and replaced. `rollback` and `uninstall` restore backed
up entries and never remove a client entry that you changed after installation.

## Compatibility

This works with AI applications that support local **stdio MCP servers** on
Windows. It is tested for:

- OpenAI Codex CLI/app
- Cursor
- Claude Desktop
- Claude Code
- VS Code with GitHub Copilot

Other MCP hosts can use the generated file at:

```text
%LOCALAPPDATA%\PremiereMCP\premiere-pro.mcp.json
```

“Any AI” cannot literally be supported: web-only chats, mobile apps,
cloud-only agents, and clients without local MCP support cannot control a local
Premiere process.

## Safety

The installer does not open or edit a Premiere project. During editing, start
with inspection, save a project copy, request focused changes, and verify the
timeline after each mutation. Premiere scripting cannot automate every UI
feature, and the CEP panel must remain open while tools are running.
