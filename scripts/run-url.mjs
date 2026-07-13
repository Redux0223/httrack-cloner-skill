#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, parseArgs, readText, safeJson, writeText } from "./lib.mjs";
import { runAutonomousClone } from "./orchestrate.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));

function timestamp(value) {
  return value.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function hostSlug(url) {
  return new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "") || "site";
}

function invocationIntegrity(invocation) {
  const immutable = {
    schemaVersion: invocation.schemaVersion,
    invocationId: invocation.invocationId,
    createdAt: invocation.createdAt,
    fresh: invocation.fresh,
    authorized: invocation.authorized,
    url: invocation.url,
    work: invocation.work,
    output: invocation.output,
    mirror: invocation.mirror,
    options: invocation.options,
  };
  return createHash("sha256").update(JSON.stringify(immutable)).digest("hex");
}

export function defaultRunsRoot(env = process.env) {
  return resolve(env.HTTRACK_REACT_CLONER_RUNS_ROOT || process.cwd(), env.HTTRACK_REACT_CLONER_RUNS_ROOT ? "." : "clone-runs");
}

export function allocateFreshRun({ url, runsRoot = defaultRunsRoot(), now = new Date(), nonce = randomUUID().slice(0, 6), options = {} }) {
  const sourceUrl = new URL(String(url)).href;
  const root = resolve(runsRoot);
  ensureDir(root);
  const slug = hostSlug(sourceUrl);
  let work = join(root, `${slug}-${timestamp(now)}-${nonce}`);
  let suffix = 1;
  while (existsSync(work)) work = join(root, `${slug}-${timestamp(now)}-${nonce}-${suffix++}`);
  ensureDir(join(work, ".cloner"));
  const invocation = {
    schemaVersion: 2,
    invocationId: randomUUID(),
    createdAt: now.toISOString(),
    fresh: true,
    authorized: true,
    url: sourceUrl,
    work,
    output: join(work, "react"),
    mirror: join(work, "mirror"),
    options: {
      url: sourceUrl,
      work,
      output: join(work, "react"),
      depth: Number(options.depth || 3),
      basePath: options.basePath || "/",
      sourcePreview: options.sourcePreview || sourceUrl,
      ...(options.allowHost ? { allowHost: options.allowHost } : {}),
      ...(options.hints ? { hints: resolve(String(options.hints)) } : {}),
      ...(options.offlineRules ? { offlineRules: resolve(String(options.offlineRules)) } : {}),
      ...(options.port ? { port: Number(options.port) } : {}),
      ...(options.noOpen ? { noOpen: true } : {}),
    },
  };
  invocation.integrity = invocationIntegrity(invocation);
  writeText(join(work, ".cloner/invocation.json"), safeJson(invocation));
  return invocation;
}

export function loadRunInvocation(work) {
  const root = resolve(String(work));
  const path = join(root, ".cloner/invocation.json");
  if (!existsSync(path)) throw new Error(`stale-run-reuse-forbidden: missing ${path}; allocate a new URL-only run`);
  const invocation = JSON.parse(readText(path));
  const pathsMatch = resolve(String(invocation.work)) === root
    && resolve(String(invocation.output)) === join(root, "react")
    && resolve(String(invocation.mirror)) === join(root, "mirror")
    && resolve(String(invocation.options?.work)) === root
    && resolve(String(invocation.options?.output)) === join(root, "react");
  const sourceMatches = invocation.url === invocation.options?.url
    && invocation.options?.sourcePreview === invocation.url;
  const integrityMatches = invocation.integrity === invocationIntegrity(invocation);
  if (invocation.schemaVersion !== 2 || invocation.fresh !== true || invocation.authorized !== true || !pathsMatch || !sourceMatches || !integrityMatches) {
    throw new Error(`stale-run-reuse-forbidden: invalid invocation provenance in ${path}`);
  }
  return invocation;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let invocation;
  if (args.resume) {
    invocation = loadRunInvocation(String(args.resume));
  } else {
    if (!args.url || !args.authorized) {
      console.error("Usage: run-url.mjs --url URL --authorized [--runs-root DIR] [--prepare-only] | --resume RUN_DIR");
      process.exitCode = 2;
      return;
    }
    invocation = allocateFreshRun({
      url: String(args.url),
      runsRoot: args["runs-root"] ? resolve(String(args["runs-root"])) : defaultRunsRoot(),
      options: {
        depth: args.depth,
        basePath: args["base-path"],
        sourcePreview: args["source-preview"],
        allowHost: args["allow-host"],
        hints: args.hints,
        offlineRules: args["offline-rules"],
        port: args.port,
        noOpen: args["no-open"],
      },
    });
  }

  console.log(`Fresh run: ${invocation.work}`);
  console.log(`Project: ${invocation.output}`);
  if (args["prepare-only"]) return;

  const state = await runAutonomousClone(invocation.options);
  const updated = { ...invocation, updatedAt: new Date().toISOString(), lastStatus: state.status };
  writeText(join(invocation.work, ".cloner/invocation.json"), safeJson(updated));
  console.log(`Orchestrator status: ${state.status}`);
  if (state.status === "REPAIR_LOOP") {
    const actionsFile = join(invocation.work, ".cloner/next-actions.json");
    const actions = JSON.parse(readText(actionsFile));
    console.error("NON-TERMINAL REPAIR_LOOP: FINAL RESPONSE IS FORBIDDEN. Do not summarize, hand off, inspect sibling runs, or describe future work.");
    for (const action of actions.requiredActions || []) {
      console.error(`ACTION ${action.actionCode}:`);
      for (const procedure of action.procedure || []) console.error(`- ${procedure}`);
      console.error(`EXIT: ${action.exitCondition}`);
    }
    console.error("Implement the first unsatisfied action now. If project test tools are absent, run npm ci --prefix \"$RUN/react\". Then append repair-history.json and resume this exact run.");
    console.log(`Required repairs: ${actionsFile}`);
    console.log(`Resume: node "${fileURLToPath(import.meta.url)}" --resume "${invocation.work}"`);
  }
  if (state.status !== "DELIVERED") process.exitCode = 3;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
