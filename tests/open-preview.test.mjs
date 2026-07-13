import assert from "node:assert/strict";
import test from "node:test";
import {
  openPreview,
  previewOpenCommand,
} from "../scripts/open-preview.mjs";

const url = "http://127.0.0.1:4176/";

test("selects the native browser opener for macOS, Linux, and Windows", () => {
  assert.deepEqual(previewOpenCommand("darwin", url), { command: "open", args: [url] });
  assert.deepEqual(previewOpenCommand("linux", url), { command: "xdg-open", args: [url] });
  assert.deepEqual(previewOpenCommand("win32", url), { command: "cmd", args: ["/c", "start", "", url] });
  assert.throws(() => previewOpenCommand("aix", url), /Unsupported platform/);
});

test("opens the preview by default and supports an explicit headless skip", () => {
  const calls = [];
  const opened = openPreview(url, {
    platform: "darwin",
    spawn(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(opened.passed, true);
  assert.equal(opened.skipped, false);
  assert.deepEqual(calls, [{ command: "open", args: [url] }]);

  const skipped = openPreview(url, { disabled: true });
  assert.deepEqual(skipped, { passed: true, skipped: true, reason: "disabled" });
});
