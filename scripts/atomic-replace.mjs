#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { ensureDir, parseArgs } from "./lib.mjs";

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function targetAllowed(run, target) {
  const react = resolve(run, "react");
  if (within(resolve(react, "src"), target)) return true;
  return ["vite.config.ts", "vitest.config.ts", "tsconfig.json"].some((file) => target === resolve(react, file));
}

export function atomicReplace({ run, target, input }) {
  const runRoot = resolve(run);
  const destination = resolve(target);
  const source = resolve(input);
  if (!targetAllowed(runRoot, destination)) throw new Error(`target-not-allowed: ${destination}`);
  if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) {
    throw new Error(`input-invalid: ${source}`);
  }
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`target-symlink-forbidden: ${destination}`);
  const bytes = readFileSync(source);
  if (bytes.length === 0) throw new Error(`input-empty: ${source}`);
  ensureDir(dirname(destination));
  const temporary = `${destination}.atomic-${process.pid}`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, destination);
  return { target: destination, bytes: bytes.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run || !args.target || !args.input) {
    console.error("Usage: atomic-replace.mjs --run RUN --target TARGET --input INPUT");
    process.exit(2);
  }
  try {
    const result = atomicReplace({ run: String(args.run), target: String(args.target), input: String(args.input) });
    console.log(`Atomically replaced ${result.target} (${result.bytes} bytes).`);
  } catch (error) {
    console.error(error.message);
    process.exit(3);
  }
}
