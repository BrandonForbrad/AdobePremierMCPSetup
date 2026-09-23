#!/usr/bin/env node

import {
  doctor,
  FFMPEG_PACKAGE,
  FFMPEG_VERSION,
  formatInstallSummary,
  install,
  resolvePaths,
  rollback,
  uninstall,
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
} from "../src/setup.js";

function usage() {
  console.log(`
Adobe Premiere MCP Setup

Usage:
  premiere-mcp-setup [install] [options]
  premiere-mcp-setup doctor
  premiere-mcp-setup rollback [--keep-files]
  premiere-mcp-setup uninstall [--keep-files]

Options:
  --all-clients       Configure every supported client, detected or not
  --force             Replace an existing, different "premiere-pro" entry
  --telemetry         Enable upstream anonymous usage telemetry (off by default)
  --dry-run           Show target paths and current health without changing files
  --keep-files        Keep the installed server during uninstall
  --no-registry-restore
                      Do not restore prior Adobe CEP debug registry values
  -h, --help          Show this help

Installs ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION} and ${FFMPEG_PACKAGE}@${FFMPEG_VERSION}.
`.trim());
}

function printDoctor(report) {
  console.log("\nPremiere MCP doctor\n");
  for (const check of report.checks) {
    const status = check.ok ? "OK" : check.warning ? "SKIP" : "FAIL";
    console.log(`[${status}] ${check.name}: ${check.detail}`);
  }
  console.log("");
  if (!report.healthy) {
    console.log("Setup is incomplete. Rerun the installer, then run doctor again.");
  } else if (!report.live) {
    console.log("Installation is healthy, but the Premiere bridge is not live.");
    console.log("Open Premiere > Window > Extensions > MCP Bridge (CEP).");
  } else {
    console.log("Installation and the Premiere bridge are ready.");
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    return;
  }
  const command = argv.find((value) => !value.startsWith("-")) || "install";
  const options = {
    allClients: argv.includes("--all-clients"),
    force: argv.includes("--force"),
    telemetry: argv.includes("--telemetry"),
    keepFiles: argv.includes("--keep-files"),
    restoreRegistry: !argv.includes("--no-registry-restore"),
  };

  if (argv.includes("--dry-run")) {
    const paths = resolvePaths();
    console.log("Dry run: no files will be changed.");
    console.log(`Install root: ${paths.installRoot}`);
    console.log(`MCP server: ${paths.serverPath}`);
    console.log(`CEP extension: ${paths.cepDir}`);
    console.log(`Bridge directory: ${paths.bridgeDir}`);
    printDoctor(doctor());
    return;
  }

  if (command === "install") {
    const result = install(options);
    console.log(formatInstallSummary(result));
    return;
  }
  if (command === "doctor") {
    const report = doctor(options);
    printDoctor(report);
    process.exitCode = report.healthy && report.live ? 0 : 1;
    return;
  }
  if (command === "uninstall") {
    const result = uninstall(options);
    console.log("Premiere MCP setup removed.");
    for (const item of result.results) console.log(`  ${item.client}: ${item.status}`);
    return;
  }
  if (command === "rollback") {
    const result = rollback(options);
    console.log("Premiere MCP setup rolled back to the pre-install state.");
    for (const item of result.results) console.log(`  ${item.client}: ${item.status}`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`\nSetup failed: ${error.message}`);
  console.error("No Premiere project or timeline was modified.");
  process.exitCode = 1;
}
