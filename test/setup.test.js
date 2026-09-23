import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  doctor,
  install,
  mergeCodexConfig,
  mergeJsonClient,
  resolvePaths,
  serverDefinition,
  uninstall,
} from "../src/setup.js";

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "premiere-mcp-setup-test-"));
  return {
    root,
    env: {
      USERPROFILE: path.join(root, "home"),
      APPDATA: path.join(root, "appdata"),
      LOCALAPPDATA: path.join(root, "local"),
      TEMP: path.join(root, "temp"),
      PREMIERE_MCP_SETUP_ROOT: path.join(root, "install"),
    },
  };
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

test("JSONC merge preserves unrelated settings and is idempotent", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const file = paths.clients.cursor;
  write(file, '{\n  // keep this comment\n  "theme": "dark"\n}\n');
  const definition = serverDefinition(paths);

  const first = mergeJsonClient(file, "mcpServers", definition, paths);
  const afterFirst = readFileSync(file, "utf8");
  const second = mergeJsonClient(file, "mcpServers", definition, paths);

  assert.equal(first.status, "added");
  assert.equal(second.status, "unchanged");
  assert.equal(readFileSync(file, "utf8"), afterFirst);
  assert.match(afterFirst, /keep this comment/);
  assert.match(afterFirst, /"theme": "dark"/);
});

test("JSON merge refuses a different existing entry unless forced", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const file = paths.clients.cursor;
  write(
    file,
    JSON.stringify({ mcpServers: { "premiere-pro": { command: "custom" } } }),
  );

  const conflict = mergeJsonClient(file, "mcpServers", serverDefinition(paths), paths);
  assert.equal(conflict.status, "conflict");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).mcpServers["premiere-pro"].command, "custom");

  const replaced = mergeJsonClient(
    file,
    "mcpServers",
    serverDefinition(paths),
    paths,
    { force: true },
  );
  assert.equal(replaced.status, "replaced");
  assert.ok(replaced.backup);
});

test("malformed client JSON is never overwritten", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const file = paths.clients.cursor;
  write(file, "{not-json");
  assert.throws(
    () => mergeJsonClient(file, "mcpServers", serverDefinition(paths), paths),
    /malformed JSON/,
  );
  assert.equal(readFileSync(file, "utf8"), "{not-json");
});

test("empty client JSON is initialized as an object", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const file = paths.clients.vscode;
  write(file, "");

  const result = mergeJsonClient(
    file,
    "servers",
    { type: "stdio", ...serverDefinition(paths) },
    paths,
  );

  assert.equal(result.status, "added");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).servers["premiere-pro"].type, "stdio");
});

test("install preflight rejects malformed config before creating install files", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  write(paths.clients.cursor, "{not-json");
  assert.throws(
    () => install({ env, allowNonWindows: true, skipUpstream: true }),
    /malformed JSON/,
  );
  assert.equal(existsSync(paths.installRoot), false);
});

test("Codex TOML merge marks owned blocks and protects custom blocks", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const file = paths.clients.codex;
  const definition = serverDefinition(paths);

  const added = mergeCodexConfig(file, definition, paths);
  assert.equal(added.status, "added");
  assert.match(readFileSync(file, "utf8"), /Managed by adobe-premiere-mcp-setup/);
  assert.equal(mergeCodexConfig(file, definition, paths).status, "unchanged");

  write(file, '[mcp_servers.premiere-pro]\ncommand = "custom"\n');
  assert.equal(mergeCodexConfig(file, definition, paths).status, "conflict");
  assert.equal(mergeCodexConfig(file, definition, paths, { force: true }).status, "replaced");
});

test("install is idempotent and uninstall removes only owned entries", () => {
  const { env } = sandbox();
  const options = {
    env,
    allowNonWindows: true,
    skipUpstream: true,
    allClients: true,
  };
  const first = install(options);
  const second = install(options);

  assert.equal(first.clients.find((item) => item.client === "Cursor").status, "added");
  assert.equal(second.clients.find((item) => item.client === "Cursor").status, "added");
  assert.ok(existsSync(first.paths.manifestPath));

  const removed = uninstall(options);
  assert.equal(removed.results.find((item) => item.client === "Cursor").status, "removed");
  const cursor = JSON.parse(readFileSync(first.paths.clients.cursor, "utf8"));
  assert.equal(cursor.mcpServers?.["premiere-pro"], undefined);
  assert.doesNotMatch(readFileSync(first.paths.clients.codex, "utf8"), /mcp_servers\.premiere-pro/);
  assert.equal(existsSync(first.paths.installRoot), false);
});

test("forced replacement is restored during uninstall", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  write(
    paths.clients.cursor,
    JSON.stringify({ mcpServers: { "premiere-pro": { command: "custom" } }, keep: true }, null, 2),
  );
  const options = {
    env,
    allowNonWindows: true,
    skipUpstream: true,
    force: true,
  };
  install(options);
  uninstall(options);

  const restored = JSON.parse(readFileSync(paths.clients.cursor, "utf8"));
  assert.equal(restored.mcpServers["premiere-pro"].command, "custom");
  assert.equal(restored.keep, true);
});

test("uninstall leaves a user-modified managed entry in place", () => {
  const { env } = sandbox();
  const options = { env, allowNonWindows: true, skipUpstream: true };
  const result = install(options);
  const cursor = JSON.parse(readFileSync(result.paths.clients.cursor, "utf8"));
  cursor.mcpServers["premiere-pro"].command = "user-changed";
  write(result.paths.clients.cursor, JSON.stringify(cursor, null, 2));

  const removed = uninstall({ ...options, keepFiles: true });
  assert.equal(removed.results.find((item) => item.client === "Cursor").status, "modified");
  assert.equal(
    JSON.parse(readFileSync(result.paths.clients.cursor, "utf8")).mcpServers["premiere-pro"].command,
    "user-changed",
  );
});

test("doctor is read-only and reports an incomplete sandbox", () => {
  const { env } = sandbox();
  const paths = resolvePaths(env);
  const report = doctor({ env, allowNonWindows: true });
  assert.equal(report.healthy, false);
  assert.equal(report.live, false);
  assert.equal(existsSync(paths.installRoot), false);
});
