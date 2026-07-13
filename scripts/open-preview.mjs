#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function assertLocalPreview(urlValue) {
  const url = new URL(urlValue);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!["http:", "https:"].includes(url.protocol) || !loopback) {
    throw new Error(`Refusing to open a non-loopback preview URL: ${urlValue}`);
  }
  return url.href;
}

export function previewOpenCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "linux") return { command: "xdg-open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  throw new Error(`Unsupported platform for browser preview: ${platform}`);
}

export function openPreview(urlValue, options = {}) {
  if (options.disabled) return { passed: true, skipped: true, reason: "disabled" };
  const url = assertLocalPreview(urlValue);
  const { command, args } = previewOpenCommand(options.platform || process.platform, url);
  const spawn = options.spawn || spawnSync;
  const result = spawn(command, args, { encoding: "utf8" });
  return {
    passed: result.status === 0,
    skipped: false,
    command,
    args,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: open-preview.mjs URL [--no-open]");
    process.exit(2);
  }
  const result = openPreview(url, { disabled: process.argv.includes("--no-open") });
  if (!result.passed) {
    console.error(result.stderr || `Failed to open ${url}`);
    process.exit(3);
  }
}
