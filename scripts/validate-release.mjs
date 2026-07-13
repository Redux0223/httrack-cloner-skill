#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "SKILL.md",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "agents/openai.yaml",
  "scripts/run-url.mjs",
  "scripts/package-lock.json",
];
const failures = [];

for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing:${path}`);
}

const skill = readFileSync(join(root, "SKILL.md"), "utf8");
if (!/^---\nname: httrack-cloner-skill\n/m.test(skill)) failures.push("invalid-skill-name");
if (!/^description: Use when /m.test(skill)) failures.push("invalid-skill-description");

function walk(directory) {
  const staleName = ["httrack", "react", "cloner"].join("-");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(?:md|mjs|json|yaml|yml)$/i.test(entry.name)) {
      const text = readFileSync(path, "utf8");
      if (text.includes(staleName)) failures.push(`stale-name:${path.slice(root.length + 1)}`);
    }
  }
}
walk(root);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Release validation passed.");
