import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { modify, parse, applyEdits } from "jsonc-parser";

export const UPSTREAM_PACKAGE = "adobe-premiere-pro-mcp";
export const UPSTREAM_VERSION = "1.2.8";
export const FFMPEG_PACKAGE = "ffmpeg-static";
export const FFMPEG_VERSION = "5.3.0";
export const SERVER_NAME = "premiere-pro";
export const MANAGED_MARKER = "Managed by adobe-premiere-mcp-setup";

const CLIENT_DEFINITIONS = [
  { id: "cursor", label: "Cursor", kind: "json", root: "mcpServers", always: true },
  { id: "codex", label: "OpenAI Codex", kind: "toml", always: true },
  { id: "claude-desktop", label: "Claude Desktop", kind: "json", root: "mcpServers" },
  { id: "claude-code", label: "Claude Code", kind: "json", root: "mcpServers" },
  { id: "vscode", label: "VS Code Copilot", kind: "json", root: "servers", vscode: true },
];

export function resolvePaths(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const temp = env.TEMP || env.TMP || os.tmpdir();
  const installRoot = env.PREMIERE_MCP_SETUP_ROOT || path.join(localAppData, "PremiereMCP");
  return {
    home,
    appData,
    localAppData,
    installRoot,
    packageRoot: path.join(installRoot, "node_modules", UPSTREAM_PACKAGE),
    serverPath: path.join(installRoot, "node_modules", UPSTREAM_PACKAGE, "dist", "index.js"),
    ffmpegDir: path.join(installRoot, "node_modules", FFMPEG_PACKAGE),
    ffmpegPath: path.join(installRoot, "node_modules", FFMPEG_PACKAGE, "ffmpeg.exe"),
    bridgeDir: path.join(temp, "premiere-mcp-bridge"),
    cepDir: path.join(appData, "Adobe", "CEP", "extensions", "MCPBridgeCEP"),
    panelConfig: path.join(home, ".premiere-mcp-bridge", "config.json"),
    manifestPath: path.join(installRoot, "install-manifest.json"),
    genericConfig: path.join(installRoot, "premiere-pro.mcp.json"),
    backupDir: path.join(installRoot, "backups"),
    clients: {
      cursor: path.join(home, ".cursor", "mcp.json"),
      codex: path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
      "claude-desktop": path.join(appData, "Claude", "claude_desktop_config.json"),
      "claude-code": path.join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"),
      vscode: path.join(appData, "Code", "User", "mcp.json"),
    },
  };
}

export function serverDefinition(paths, { telemetry = false } = {}) {
  const env = {
    PREMIERE_TEMP_DIR: paths.bridgeDir,
    PREMIERE_MCP_TELEMETRY: telemetry ? "1" : "0",
    PATH: paths.ffmpegDir,
  };
  return {
    command: process.execPath,
    args: [paths.serverPath],
    env,
  };
}

function vscodeDefinition(definition) {
  return { type: "stdio", ...definition };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ensureParent(file) {
  mkdirSync(path.dirname(file), { recursive: true });
}

function atomicWrite(file, content) {
  ensureParent(file);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, file);
}

function readText(file, fallback = "") {
  return existsSync(file) ? readFileSync(file, "utf8") : fallback;
}

function backupFile(file, paths) {
  if (!existsSync(file)) return null;
  mkdirSync(paths.backupDir, { recursive: true });
  const safeName = file.replace(/[:\\/]+/g, "_");
  const destination = path.join(paths.backupDir, `${Date.now()}-${safeName}.bak`);
  copyFileSync(file, destination);
  return destination;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout?.trim() || "";
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(probe, [command], { stdio: "ignore", windowsHide: true }).status === 0;
}

function clientDetected(client, paths) {
  if (client.always || existsSync(paths.clients[client.id])) return true;
  if (client.id === "claude-desktop") {
    return existsSync(path.join(paths.appData, "Claude"));
  }
  if (client.id === "claude-code") return commandExists("claude");
  if (client.id === "vscode") return commandExists("code") || existsSync(path.join(paths.appData, "Code"));
  return false;
}

function semanticJsonEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => semanticJsonEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key, index) => key === rightKeys[index] && semanticJsonEqual(left[key], right[key]),
    );
}

export function mergeJsonClient(file, rootKey, definition, paths, { force = false } = {}) {
  const fileContent = readText(file, "{}");
  const original = fileContent.trim() ? fileContent : "{}";
  const errors = [];
  const document = parse(original, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`Cannot safely update malformed JSON/JSONC: ${file}`);
  }
  const existing = document[rootKey]?.[SERVER_NAME];
  if (existing && semanticJsonEqual(existing, definition)) {
    return { status: "unchanged", file, backup: null };
  }
  if (existing && !force) {
    return { status: "conflict", file, backup: null };
  }
  const backup = backupFile(file, paths);
  const edits = modify(original, [rootKey, SERVER_NAME], definition, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  const updated = applyEdits(original, edits);
  const validationErrors = [];
  parse(updated, validationErrors, { allowTrailingComma: true, disallowComments: false });
  if (validationErrors.length) throw new Error(`Generated invalid JSON for ${file}`);
  atomicWrite(file, updated.endsWith("\n") ? updated : `${updated}\n`);
  return { status: existing ? "replaced" : "added", file, backup };
}

function tomlEscape(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexBlock(definition) {
  return [
    `# ${MANAGED_MARKER}`,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlEscape(definition.command)}`,
    `args = [${definition.args.map(tomlEscape).join(", ")}]`,
    "",
    `[mcp_servers.${SERVER_NAME}.env]`,
    ...Object.entries(definition.env).map(([key, value]) => `${key} = ${tomlEscape(value)}`),
    "",
  ].join("\n");
}

function findCodexRange(content) {
  const lines = content.split(/\r?\n/);
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  let from = start;
  if (start > 0 && lines[start - 1].trim() === `# ${MANAGED_MARKER}`) from = start - 1;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index]) && lines[index].trim() !== `[mcp_servers.${SERVER_NAME}.env]`) {
      end = index;
      break;
    }
  }
  return { lines, from, end, managed: from !== start };
}

export function mergeCodexConfig(file, definition, paths, { force = false } = {}) {
  const original = readText(file);
  const range = findCodexRange(original);
  const block = codexBlock(definition).trimEnd();
  if (range && range.managed) {
    const current = range.lines.slice(range.from, range.end).join("\n").trim();
    if (current === block) return { status: "unchanged", file, backup: null };
  }
  if (range && !range.managed && !force) return { status: "conflict", file, backup: null };
  const backup = backupFile(file, paths);
  let updated;
  if (range) {
    range.lines.splice(range.from, range.end - range.from, ...block.split("\n"));
    updated = range.lines.join("\n");
  } else {
    updated = `${original.trimEnd()}${original.trim() ? "\n\n" : ""}${block}\n`;
  }
  atomicWrite(file, updated.endsWith("\n") ? updated : `${updated}\n`);
  return { status: range ? "replaced" : "added", file, backup };
}

export function configureClients(paths, options = {}) {
  const definition = serverDefinition(paths, options);
  const results = [];
  for (const client of CLIENT_DEFINITIONS) {
    if (!clientDetected(client, paths) && !options.allClients) {
      results.push({ client: client.label, status: "not-detected", file: paths.clients[client.id] });
      continue;
    }
    const file = paths.clients[client.id];
    const clientOptions = {
      ...options,
      force: options.force || options.ownedClients?.has(client.label),
    };
    const result = client.kind === "toml"
      ? mergeCodexConfig(file, definition, paths, clientOptions)
      : mergeJsonClient(
        file,
        client.root,
        client.vscode ? vscodeDefinition(definition) : definition,
        paths,
        clientOptions,
      );
    results.push({ client: client.label, ...result });
  }
  const generic = {
    mcpServers: {
      [SERVER_NAME]: definition,
    },
  };
  atomicWrite(paths.genericConfig, `${JSON.stringify(generic, null, 2)}\n`);
  return results;
}

function readRegistryDebugState() {
  if (process.platform !== "win32") return {};
  const state = {};
  for (let version = 9; version <= 15; version += 1) {
    const key = `HKCU\\Software\\Adobe\\CSXS.${version}`;
    const result = spawnSync("reg.exe", ["query", key, "/v", "PlayerDebugMode"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const match = result.status === 0 && result.stdout.match(/PlayerDebugMode\s+REG_\w+\s+(.+)/i);
    state[version] = match ? match[1].trim() : null;
  }
  return state;
}

function restoreRegistryDebugState(state) {
  if (process.platform !== "win32") return;
  for (let version = 9; version <= 15; version += 1) {
    const key = `HKCU\\Software\\Adobe\\CSXS.${version}`;
    if (state?.[version] == null) {
      spawnSync("reg.exe", ["delete", key, "/v", "PlayerDebugMode", "/f"], { stdio: "ignore" });
    } else {
      spawnSync(
        "reg.exe",
        ["add", key, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", state[version], "/f"],
        { stdio: "ignore" },
      );
    }
  }
}

function writePanelConfig(paths, telemetry) {
  const existing = existsSync(paths.panelConfig)
    ? JSON.parse(readFileSync(paths.panelConfig, "utf8"))
    : {};
  const next = { ...existing, tempDirectory: paths.bridgeDir, telemetry };
  const backup = backupFile(paths.panelConfig, paths);
  atomicWrite(paths.panelConfig, `${JSON.stringify(next, null, 2)}\n`);
  const bridgeConfig = path.join(paths.bridgeDir, "config.json");
  const bridgeBackup = backupFile(bridgeConfig, paths);
  atomicWrite(
    bridgeConfig,
    `${JSON.stringify({ tempDirectory: paths.bridgeDir }, null, 2)}\n`,
  );
  return { backup, bridgeBackup };
}

function preflightConfiguration(paths, options) {
  for (const client of CLIENT_DEFINITIONS.filter((item) => item.kind === "json")) {
    if ((!clientDetected(client, paths) && !options.allClients) || !existsSync(paths.clients[client.id])) {
      continue;
    }
    const content = readFileSync(paths.clients[client.id], "utf8");
    if (!content.trim()) continue;
    const errors = [];
    const data = parse(content, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    if (errors.length || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`Cannot safely update malformed JSON/JSONC: ${paths.clients[client.id]}`);
    }
  }
  if (existsSync(paths.panelConfig)) {
    try {
      const panel = JSON.parse(readFileSync(paths.panelConfig, "utf8"));
      if (!panel || typeof panel !== "object" || Array.isArray(panel)) throw new Error("not an object");
    } catch {
      throw new Error(`Cannot safely update malformed panel config: ${paths.panelConfig}`);
    }
  }
}

function installUpstream(paths) {
  mkdirSync(paths.installRoot, { recursive: true });
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = npmCliCandidates.find(existsSync);
  if (!npmCli) {
    throw new Error("Could not locate npm. Run this installer through the documented npx command.");
  }
  run(process.execPath, [
    npmCli,
    "install",
    "--prefix",
    paths.installRoot,
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--save=false",
    `${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}`,
    `${FFMPEG_PACKAGE}@${FFMPEG_VERSION}`,
  ]);
  if (!existsSync(paths.serverPath)) {
    throw new Error(`Upstream server was not installed at ${paths.serverPath}`);
  }
  if (!existsSync(paths.ffmpegPath)) {
    throw new Error(`FFmpeg was not installed at ${paths.ffmpegPath}`);
  }
}

function installCep(paths) {
  const script = path.join(paths.packageRoot, "scripts", "install-windows.ps1");
  if (process.platform !== "win32") throw new Error("CEP installation is supported only on Windows.");
  if (!existsSync(script)) throw new Error(`Upstream CEP installer not found: ${script}`);
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-SkipBuild",
    "-SkipCopilotConfig",
    "-SkipClaudeDesktopConfig",
    "-TempDir",
    paths.bridgeDir,
  ]);
}

function premiereInstallations(paths) {
  const roots = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Adobe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Adobe"),
  ].filter(Boolean);
  return roots.filter(existsSync).flatMap((root) => {
    try {
      return statSync(root).isDirectory()
        ? Array.from(new Set(
          readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /Adobe Premiere Pro/i.test(entry.name))
            .map((entry) => entry.name),
        )).map((name) => path.join(root, name))
        : [];
    } catch {
      return [];
    }
  });
}

export function install(options = {}) {
  if (process.platform !== "win32" && !options.allowNonWindows) {
    throw new Error("This installer supports Windows only.");
  }
  if (Number(process.versions.node.split(".")[0]) < 20) {
    throw new Error("Node.js 20 or newer is required.");
  }
  const paths = resolvePaths(options.env);
  let previousManifest = null;
  if (existsSync(paths.manifestPath)) {
    try {
      previousManifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    } catch {
      throw new Error("Existing install manifest is damaged; repair or remove it before reinstalling.");
    }
  }
  preflightConfiguration(paths, options);
  const registryBefore = previousManifest?.registryBefore || readRegistryDebugState();
  mkdirSync(paths.backupDir, { recursive: true });
  const cepExistedBefore = previousManifest?.cepExistedBefore ?? existsSync(paths.cepDir);
  const cepBackup = cepExistedBefore
    ? previousManifest?.cepBackup || path.join(paths.backupDir, `cep-${Date.now()}`)
    : null;
  if (cepBackup && !existsSync(cepBackup)) cpSync(paths.cepDir, cepBackup, { recursive: true });
  if (!options.skipUpstream) {
    installUpstream(paths);
    if (!options.skipCep) installCep(paths);
  }
  mkdirSync(paths.bridgeDir, { recursive: true });
  const latestPanel = writePanelConfig(paths, Boolean(options.telemetry));
  const panel = previousManifest?.panel || latestPanel;
  const ownedClients = new Set(
    previousManifest?.clients
      ?.filter((item) => ["added", "replaced"].includes(item.status))
      .map((item) => item.client) || [],
  );
  const latestClients = configureClients(paths, { ...options, ownedClients });
  const clients = latestClients.map((client) => {
    const previous = previousManifest?.clients?.find((item) => item.client === client.client);
    return client.status === "unchanged" && previous && ["added", "replaced"].includes(previous.status)
      ? { ...client, status: previous.status, backup: previous.backup }
      : client;
  });
  const manifest = {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    upstream: `${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}`,
    ffmpeg: `${FFMPEG_PACKAGE}@${FFMPEG_VERSION}`,
    paths,
    telemetry: Boolean(options.telemetry),
    clients,
    registryBefore,
    cepExistedBefore,
    cepBackup,
    panel,
    definitionHash: sha256(JSON.stringify(serverDefinition(paths, options))),
  };
  atomicWrite(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { paths, clients, manifest };
}

function inspectJsonClient(file, root, expected) {
  if (!existsSync(file)) return "missing";
  const errors = [];
  const data = parse(readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) return "invalid";
  const actual = data?.[root]?.[SERVER_NAME];
  if (!actual) return "missing";
  return semanticJsonEqual(actual, expected) ? "ok" : "different";
}

function heartbeatStatus(paths) {
  const file = path.join(paths.bridgeDir, "bridge-heartbeat.json");
  if (!existsSync(file)) return { state: "missing", ageSeconds: null };
  const ageSeconds = Math.round((Date.now() - statSync(file).mtimeMs) / 1000);
  return { state: ageSeconds <= 15 ? "fresh" : "stale", ageSeconds };
}

export function doctor(options = {}) {
  const paths = resolvePaths(options.env);
  const definition = serverDefinition(paths, options);
  let installedVersion = null;
  try {
    installedVersion = JSON.parse(
      readFileSync(path.join(paths.packageRoot, "package.json"), "utf8"),
    ).version;
  } catch {
    // Reported by the checks below.
  }
  let panelDirectory = null;
  try {
    panelDirectory = JSON.parse(readFileSync(paths.panelConfig, "utf8")).tempDirectory;
  } catch {
    // Reported by the checks below.
  }
  const checks = [
    { name: "Windows", ok: process.platform === "win32" || options.allowNonWindows, detail: process.platform },
    {
      name: "Node.js 20+",
      ok: Number(process.versions.node.split(".")[0]) >= 20,
      detail: process.version,
    },
    { name: "MCP server", ok: existsSync(paths.serverPath), detail: paths.serverPath },
    { name: "FFmpeg", ok: existsSync(paths.ffmpegPath), detail: paths.ffmpegPath },
    {
      name: "Pinned server version",
      ok: installedVersion === UPSTREAM_VERSION,
      detail: installedVersion || "not installed",
    },
    {
      name: "CEP extension",
      ok: existsSync(path.join(paths.cepDir, "CSXS", "manifest.xml")),
      detail: paths.cepDir,
    },
    { name: "Bridge directory", ok: existsSync(paths.bridgeDir), detail: paths.bridgeDir },
    {
      name: "Panel bridge configuration",
      ok: panelDirectory === paths.bridgeDir,
      detail: panelDirectory || "missing or invalid panel config",
    },
    {
      name: "Install manifest",
      ok: existsSync(paths.manifestPath),
      detail: paths.manifestPath,
    },
    {
      name: "Premiere Pro",
      ok: premiereInstallations(paths).length > 0,
      detail: premiereInstallations(paths).join(", ") || "not found in standard Adobe folders",
      warning: true,
    },
  ];
  const registry = readRegistryDebugState();
  checks.push({
    name: "Adobe CEP debug mode",
    ok: Object.values(registry).some((value) => value === "1"),
    detail: "PlayerDebugMode in CSXS.9-CSXS.15",
  });
  for (const client of CLIENT_DEFINITIONS) {
    const file = paths.clients[client.id];
    let state = "not-detected";
    if (clientDetected(client, paths)) {
      state = client.kind === "toml"
        ? (findCodexRange(readText(file))?.managed ? "ok" : "missing-or-different")
        : inspectJsonClient(
          file,
          client.root,
          client.vscode ? vscodeDefinition(definition) : definition,
        );
    }
    checks.push({
      name: client.label,
      ok: state === "ok" || state === "not-detected",
      detail: `${state}: ${file}`,
      warning: state === "not-detected",
    });
  }
  const heartbeat = heartbeatStatus(paths);
  checks.push({
    name: "Premiere bridge heartbeat",
    ok: heartbeat.state === "fresh",
    detail: heartbeat.ageSeconds == null
      ? "Open Window > Extensions > MCP Bridge (CEP) in Premiere."
      : `${heartbeat.state}; ${heartbeat.ageSeconds}s old`,
    live: true,
  });
  checks.push({
    name: "Read-only Premiere verification",
    ok: heartbeat.state === "fresh",
    detail: heartbeat.state === "fresh"
      ? "In your AI client, call verify_premiere_connection before making edits."
      : "Available after the CEP panel heartbeat becomes live.",
    live: true,
  });
  return {
    paths,
    checks,
    healthy: checks.filter((check) => !check.warning && !check.live).every((check) => check.ok),
    live: heartbeat.state === "fresh",
  };
}

function removeJsonEntry(file, root, expected, paths) {
  if (!existsSync(file)) return "missing";
  const original = readFileSync(file, "utf8");
  const errors = [];
  const data = parse(original, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) return "invalid";
  if (!semanticJsonEqual(data?.[root]?.[SERVER_NAME], expected)) return "modified";
  backupFile(file, paths);
  const updated = applyEdits(
    original,
    modify(original, [root, SERVER_NAME], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    }),
  );
  atomicWrite(file, updated);
  return "removed";
}

function removeCodexEntry(file, paths) {
  if (!existsSync(file)) return "missing";
  const original = readFileSync(file, "utf8");
  const range = findCodexRange(original);
  if (!range) return "missing";
  if (!range.managed) return "modified";
  backupFile(file, paths);
  range.lines.splice(range.from, range.end - range.from);
  atomicWrite(file, `${range.lines.join("\n").replace(/^\s+|\s+$/g, "")}\n`);
  return "removed";
}

export function uninstall(options = {}) {
  const paths = resolvePaths(options.env);
  const definition = serverDefinition(paths, options);
  let manifest = null;
  if (existsSync(paths.manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    } catch {
      throw new Error("Install manifest is damaged; refusing to remove client configuration.");
    }
  } else {
    throw new Error("No install manifest found; refusing to remove configuration not proven to be owned.");
  }
  const results = [];
  for (const client of CLIENT_DEFINITIONS) {
    const journal = manifest.clients?.find((item) => item.client === client.label);
    let state = "not-owned";
    if (journal && ["added", "replaced"].includes(journal.status)) {
      state = client.kind === "toml"
        ? removeCodexEntry(paths.clients[client.id], paths)
        : removeJsonEntry(
          paths.clients[client.id],
          client.root,
          client.vscode ? vscodeDefinition(definition) : definition,
          paths,
        );
      if (state === "removed" && journal.backup && existsSync(journal.backup)) {
        copyFileSync(journal.backup, paths.clients[client.id]);
        state = "restored-previous";
      }
    }
    results.push({ client: client.label, status: state });
  }
  if (options.restoreRegistry !== false) restoreRegistryDebugState(manifest?.registryBefore);
  if (manifest.cepBackup && existsSync(manifest.cepBackup)) {
    rmSync(paths.cepDir, { recursive: true, force: true });
    cpSync(manifest.cepBackup, paths.cepDir, { recursive: true });
  } else if (!manifest.cepExistedBefore && existsSync(paths.cepDir)) {
    rmSync(paths.cepDir, { recursive: true, force: true });
  }
  if (manifest.panel?.backup && existsSync(manifest.panel.backup)) {
    copyFileSync(manifest.panel.backup, paths.panelConfig);
  } else if (!manifest.panel?.backup) {
    rmSync(paths.panelConfig, { force: true });
  }
  const bridgeConfig = path.join(paths.bridgeDir, "config.json");
  if (manifest.panel?.bridgeBackup && existsSync(manifest.panel.bridgeBackup)) {
    copyFileSync(manifest.panel.bridgeBackup, bridgeConfig);
  } else {
    rmSync(bridgeConfig, { force: true });
  }
  if (existsSync(paths.installRoot) && !options.keepFiles) {
    const deferred = `${paths.installRoot}.remove-${Date.now()}`;
    try {
      renameSync(paths.installRoot, deferred);
      rmSync(deferred, { recursive: true, force: true });
    } catch {
      rmSync(paths.installRoot, { recursive: true, force: true });
    }
  }
  return { results, paths };
}

export function rollback(options = {}) {
  return uninstall(options);
}

export function formatInstallSummary(result) {
  const lines = [
    "",
    "Premiere MCP setup is installed.",
    `Server: ${result.paths.serverPath}`,
    `FFmpeg: ${result.paths.ffmpegPath}`,
    `Bridge: ${result.paths.bridgeDir}`,
    "",
    "Client configuration:",
    ...result.clients.map((item) => `  ${item.client}: ${item.status}`),
    "",
    "Finish once in Adobe Premiere Pro:",
    "  1. Fully restart Premiere Pro.",
    "  2. Open a project.",
    "  3. Open Window > Extensions > MCP Bridge (CEP).",
    "  4. Confirm the bridge directory above and click Start Bridge if shown.",
    "  5. Restart your AI client and ask it to run verify_premiere_connection without changes.",
    "",
    "Run `premiere-mcp-setup doctor` (or rerun this npx command with `doctor`) to diagnose.",
  ];
  return lines.join("\n");
}
