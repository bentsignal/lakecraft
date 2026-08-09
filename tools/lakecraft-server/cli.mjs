#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionInfo, inspectEnvironment, validateTemplatePlan } from "./provider.mjs";

const toolRoot = dirname(fileURLToPath(import.meta.url));

function usage() {
  return `Usage:
  node tools/lakecraft-server/cli.mjs connection [server-url] [--json]
  node tools/lakecraft-server/cli.mjs check [server-url] [--json]
  node tools/lakecraft-server/cli.mjs doctor [--json]
  node tools/lakecraft-server/cli.mjs secrets [--json]
  node tools/lakecraft-server/cli.mjs template-check [plan-path]`;
}

function parseArguments(args) {
  const json = args.includes("--json");
  const positional = args.filter((value) => value !== "--json");
  if (positional.some((value) => value.startsWith("-"))) throw new Error(usage());
  return { json, positional };
}

function printConnection(info, json) {
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`${info.serverName}\nDirect Connect: ${info.directConnectUrl}\nHealth: ${info.healthUrl}`);
}

async function checkHealth(info) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    response = await fetch(info.healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || (body?.ok !== true && body?.status !== "online")) {
    throw new Error(
      `Health check failed with HTTP ${response.status}; expected JSON {"ok":true} or {"status":"online"}.`,
    );
  }
  return body;
}

async function main(args) {
  const command = args.shift();
  const { json, positional } = parseArguments(args);
  if (command === "connection") {
    if (positional.length > 1) throw new Error(usage());
    printConnection(connectionInfo({ explicitUrl: positional[0] }), json);
    return;
  }
  if (command === "check") {
    if (positional.length > 1) throw new Error(usage());
    const info = connectionInfo({ explicitUrl: positional[0] });
    const status = await checkHealth(info);
    const checked = typeof status.name === "string" && status.name.trim()
      ? { ...info, serverName: status.name.trim() }
      : info;
    printConnection(json ? { ...checked, status } : checked, json);
    if (!json) console.log("Status: healthy");
    return;
  }
  if (command === "doctor") {
    if (positional.length) throw new Error(usage());
    const report = inspectEnvironment();
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Provider: ${report.provider}\nAuth: ${report.authMode}\nData: ${report.dataDir}`);
      for (const warning of report.warnings) console.log(`Warning: ${warning}`);
      for (const error of report.errors) console.error(`Error: ${error}`);
    }
    if (report.errors.length) process.exitCode = 1;
    return;
  }
  if (command === "secrets") {
    if (positional.length) throw new Error(usage());
    const values = {
      LOCAL_DEMO_TOKEN: randomBytes(32).toString("base64url"),
      SERVER_ID: randomBytes(12).toString("hex"),
    };
    if (json) console.log(JSON.stringify(values, null, 2));
    else console.log(`LOCAL_DEMO_TOKEN=${values.LOCAL_DEMO_TOKEN}\nSERVER_ID=${values.SERVER_ID}`);
    return;
  }
  if (command === "template-check") {
    if (json || positional.length > 1) throw new Error(usage());
    const path = resolve(positional[0] ?? resolve(toolRoot, "railway-template-plan.json"));
    const plan = JSON.parse(await readFile(path, "utf8"));
    const problems = validateTemplatePlan(plan);
    if (problems.length) throw new Error(`Invalid Railway template plan:\n- ${problems.join("\n- ")}`);
    console.log(`Railway template plan is valid: ${path}`);
    return;
  }
  throw new Error(usage());
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
