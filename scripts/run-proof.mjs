#!/usr/bin/env node
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { ensureDir, parseArgs, readText, safeJson, writeText } from "./lib.mjs";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function checkpointSignature(snapshot) {
  if (!snapshot) return null;
  const target = snapshot.target;
  return JSON.stringify({
    route: snapshot.route,
    title: snapshot.title,
    bodyClass: snapshot.bodyClass,
    visibleText: normalizeText(snapshot.visibleText),
    scroll: snapshot.scroll,
    target: target ? {
      selector: target.selector,
      ...(target.selector === "body" ? {} : { text: normalizeText(target.text) }),
      className: target.className,
      hidden: target.hidden,
      ariaHidden: target.ariaHidden,
      display: target.display,
      visibility: target.visibility,
      opacity: target.opacity,
      rect: target.rect,
    } : null,
  });
}

function compareCheckpoint(source, local, checkpoint, maxDelta) {
  if (!source || !local) {
    return [{ code: "checkpoint-missing", checkpoint, sourcePresent: !!source, localPresent: !!local }];
  }
  const findings = [];
  const compareValue = (code, sourceValue, localValue) => {
    if (sourceValue !== localValue) findings.push({ code, checkpoint, source: sourceValue, local: localValue });
  };
  compareValue("checkpoint-route-mismatch", source.route, local.route);
  compareValue("checkpoint-title-mismatch", source.title, local.title);
  compareValue("checkpoint-body-class-mismatch", source.bodyClass, local.bodyClass);
  compareValue("checkpoint-visible-text-mismatch", normalizeText(source.visibleText), normalizeText(local.visibleText));
  compareValue("checkpoint-scroll-x-mismatch", source.scroll?.x ?? null, local.scroll?.x ?? null);
  compareValue("checkpoint-scroll-y-mismatch", source.scroll?.y ?? null, local.scroll?.y ?? null);
  compareValue("checkpoint-scroll-depth-mismatch", source.scroll?.maxY ?? null, local.scroll?.maxY ?? null);
  compareValue("checkpoint-scroll-lock-mismatch", source.scroll?.overflow ?? null, local.scroll?.overflow ?? null);

  if (!source.target || !local.target) {
    if (!!source.target !== !!local.target) findings.push({ code: "checkpoint-target-missing", checkpoint, sourcePresent: !!source.target, localPresent: !!local.target });
    return findings;
  }

  compareValue("checkpoint-target-selector-mismatch", source.target.selector, local.target.selector);
  if (source.target.selector !== "body" || local.target.selector !== "body") {
    compareValue("checkpoint-target-text-mismatch", normalizeText(source.target.text), normalizeText(local.target.text));
  }
  if (source.target.selector !== "body" || local.target.selector !== "body") {
    compareValue("checkpoint-target-class-mismatch", source.target.className, local.target.className);
  }
  compareValue("checkpoint-target-hidden-mismatch", source.target.hidden, local.target.hidden);
  compareValue("checkpoint-target-aria-hidden-mismatch", source.target.ariaHidden, local.target.ariaHidden);
  compareValue("checkpoint-target-display-mismatch", source.target.display, local.target.display);
  compareValue("checkpoint-target-visibility-mismatch", source.target.visibility, local.target.visibility);
  compareValue("checkpoint-target-opacity-mismatch", source.target.opacity, local.target.opacity);

  if (!source.target.rect || !local.target.rect) {
    if (!!source.target.rect !== !!local.target.rect) findings.push({ code: "checkpoint-target-rect-missing", checkpoint });
    return findings;
  }
  for (const property of ["x", "y", "width", "height"]) {
    const delta = Math.abs(source.target.rect[property] - local.target.rect[property]);
    if (delta > maxDelta) findings.push({ code: "checkpoint-target-geometry-mismatch", checkpoint, property, delta });
  }
  return findings;
}

function proofSeed(baseSeed, key) {
  let value = Number(baseSeed) >>> 0;
  for (const character of String(key)) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return value;
}

function routeUrl(baseUrl, route) {
  return new URL(route.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

async function executeActions(page, actions = [], environment = {}) {
  const checkpoints = {};
  const findings = [];

  const captureCheckpoint = async (action) => page.evaluate(({ selector }) => {
    const target = selector ? document.querySelector(selector) : document.body;
    const rect = target?.getBoundingClientRect();
    const style = target ? getComputedStyle(target) : null;
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    return {
      route: `${location.pathname}${location.search}${location.hash}`,
      title: document.title,
      bodyClass: document.body.className,
      visibleText: document.body.innerText.replace(/\s+/g, " ").trim(),
      scroll: {
        x: scrollX,
        y: scrollY,
        maxY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        overflow: `${htmlStyle.overflow}/${htmlStyle.overflowY}|${bodyStyle.overflow}/${bodyStyle.overflowY}`,
      },
      target: target ? {
        selector: selector || "body",
        text: target.textContent?.replace(/\s+/g, " ").trim() || "",
        className: target.getAttribute("class") || "",
        hidden: target.hasAttribute("hidden"),
        ariaHidden: target.getAttribute("aria-hidden"),
        display: style?.display || "",
        visibility: style?.visibility || "",
        opacity: style?.opacity || "",
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      } : null,
    };
  }, { selector: action.selector || "body" });

  for (const action of actions) {
    if (action.type === "goto") continue;
    if (action.optional && action.selector && await page.locator(action.selector).count() === 0) continue;
    if (action.type === "wait-for-network-idle") {
      try {
        await page.waitForLoadState("networkidle", { timeout: action.timeoutMs || 5000 });
      } catch (error) {
        if (error?.name !== "TimeoutError") throw error;
        await page.waitForTimeout(action.settleMs || 250);
      }
      continue;
    }
    if (action.type === "wait-for-time") {
      await page.waitForTimeout(action.ms);
      continue;
    }
    if (action.type === "wait-for-selector") {
      await page.locator(action.selector).waitFor({ state: action.state || "visible", timeout: action.timeoutMs || 30000 });
      continue;
    }
    if (action.type === "click") {
      const target = page.locator(action.selector).first();
      const isCanvas = await target.evaluate((element) => element.tagName === "CANVAS");
      if (isCanvas) {
        const box = await target.boundingBox();
        if (!box) throw new Error(`Canvas click target is not visible: ${action.selector}`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await target.click({ timeout: action.timeoutMs || 30000 });
      }
      continue;
    }
    if (action.type === "tap") {
      const target = page.locator(action.selector).first();
      const isCanvas = await target.evaluate((element) => element.tagName === "CANVAS");
      if (isCanvas) {
        const box = await target.boundingBox();
        if (!box) throw new Error(`Canvas tap target is not visible: ${action.selector}`);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        if (environment.hasTouch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
      } else if (environment.hasTouch) await target.tap({ timeout: action.timeoutMs || 30000 });
      else await target.click({ timeout: action.timeoutMs || 30000 });
      continue;
    }
    if (action.type === "media-play") {
      await page.locator(action.selector).first().evaluate(async (media) => {
        media.muted = true;
        await media.play();
      });
      continue;
    }
    if (action.type === "fill") {
      await page.locator(action.selector).first().fill(action.value);
      continue;
    }
    if (action.type === "press") {
      await page.locator(action.selector).first().press(action.key);
      continue;
    }
    if (action.type === "wheel") {
      const repeat = action.repeat || 1;
      for (let index = 0; index < repeat; index += 1) {
        await page.mouse.wheel(action.deltaX || 0, action.deltaY || 0);
        if (action.intervalMs) await page.waitForTimeout(action.intervalMs);
      }
      continue;
    }
    if (action.type === "pointer-circle") {
      const target = page.locator(action.selector || "canvas").first();
      const box = await target.boundingBox();
      if (!box) throw new Error(`Pointer-circle target is not visible: ${action.selector || "canvas"}`);
      const centerX = box.x + box.width * (action.centerXRatio ?? 0.5);
      const centerY = box.y + box.height * (action.centerYRatio ?? 0.5);
      const radius = action.radiusPx ?? Math.min(box.width, box.height) * (action.radiusRatio ?? 0.2);
      const steps = action.steps || 120;
      const revolutions = action.revolutions || 1;
      await page.mouse.move(centerX + radius, centerY);
      await page.mouse.down();
      for (let index = 1; index <= steps; index += 1) {
        const angle = index / steps * Math.PI * 2 * revolutions;
        await page.mouse.move(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      }
      await page.mouse.up();
      continue;
    }
    if (action.type === "pointer-hold") {
      const target = page.locator(action.selector).first();
      const box = await target.boundingBox();
      if (!box) throw new Error(`Pointer-hold target is not visible: ${action.selector}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(action.durationMs);
      await page.mouse.up();
      continue;
    }
    if (action.type === "checkpoint") {
      const snapshot = await captureCheckpoint(action);
      checkpoints[action.id] = snapshot;
      if (action.requireChangeFrom) {
        const previous = checkpoints[action.requireChangeFrom];
        if (!previous) throw new Error(`Checkpoint ${action.id} references missing checkpoint ${action.requireChangeFrom}`);
        if (checkpointSignature(previous) === checkpointSignature(snapshot)) {
          findings.push({ code: "state-progression-missing", checkpoint: action.id, requireChangeFrom: action.requireChangeFrom });
        }
      }
      continue;
    }
    throw new Error(`Unsupported proof action: ${action.type}`);
  }
  return { checkpoints, findings };
}

function sampledScreenshotPath(outputFile, index) {
  return outputFile.replace(/\.png$/i, `.frame-${String(index).padStart(2, "0")}.png`);
}

async function capture(browser, baseUrl, scenario, environment, outputFile, randomSeed, frameSamples, frameIntervalMs) {
  const context = await browser.newContext({
    viewport: environment.viewport,
    deviceScaleFactor: environment.deviceScaleFactor,
    locale: environment.locale,
    timezoneId: environment.timezoneId,
    colorScheme: environment.colorScheme,
    reducedMotion: environment.reducedMotion,
    hasTouch: environment.hasTouch,
    isMobile: environment.isMobile,
  });
  await context.addInitScript(() => {
    const patchRenderer = (Context) => {
      if (!Context?.prototype?.getParameter) return;
      const nativeGetParameter = Context.prototype.getParameter;
      Context.prototype.getParameter = function getParameter(parameter) {
        if (parameter === 37445) return "NVIDIA Corporation";
        if (parameter === 37446) return "NVIDIA GeForce GTX 1060/PCIe/SSE2";
        return nativeGetParameter.call(this, parameter);
      };
    };
    patchRenderer(globalThis.WebGLRenderingContext);
    patchRenderer(globalThis.WebGL2RenderingContext);
  });
  await context.addInitScript(({ seed }) => {
    let state = seed >>> 0;
    Math.random = () => {
      state = state + 0x6d2b79f5 | 0;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    window.__HTTRACK_REACT_CLONER_PROOF_SEED__ = seed;
  }, { seed: randomSeed });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() }));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const targetUrl = routeUrl(baseUrl, scenario.route);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const actionTrace = await executeActions(page, scenario.actions, environment);
  await page.evaluate(() => document.fonts?.ready.then(() => true));
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const snapshot = await page.evaluate(() => {
    function intersects(left, right) {
      return left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom;
    }

    function visibleRect(rect, element) {
      let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0 || current.hasAttribute("hidden")) return false;
        if (/hidden|clip|auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
          const box = current.getBoundingClientRect();
          clip = {
            left: Math.max(clip.left, box.left),
            top: Math.max(clip.top, box.top),
            right: Math.min(clip.right, box.right),
            bottom: Math.min(clip.bottom, box.bottom),
          };
        }
        current = current.parentElement;
      }
      return clip.right > clip.left && clip.bottom > clip.top && intersects(rect, clip);
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && visibleRect(rect, element);
    }

    function visibleText() {
      const values = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue?.replace(/\s+/g, " ").trim();
        const parent = node.parentElement;
        if (!value || !parent) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        if (rects.some((rect) => rect.width > 0 && rect.height > 0 && visibleRect(rect, parent))) values.push(value);
      }
      return values.join(" ").replace(/\s+/g, " ").trim();
    }

    const visibleCount = (selector) => [...document.querySelectorAll(selector)].filter(isVisible).length;
    const selectors = "header,nav,main,footer,h1,h2,canvas,[role]";
    const elements = [...document.querySelectorAll(selectors)].filter(isVisible);
    const signatureCounts = new Map();
    const geometry = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const signature = `${element.tagName.toLowerCase()}:${element.getAttribute("role") || ""}`;
      const occurrence = signatureCounts.get(signature) || 0;
      signatureCounts.set(signature, occurrence + 1);
      return {
        key: `${signature}:${occurrence}`,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: {
          display: style.display,
          position: style.position,
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
        },
      };
    });
    return {
      href: location.href,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      title: document.title,
      visibleText: visibleText(),
      landmarks: {
        header: visibleCount("header"),
        nav: visibleCount("nav"),
        main: visibleCount("main"),
        footer: visibleCount("footer"),
        headings: visibleCount("h1,h2,h3,h4,h5,h6"),
        forms: visibleCount("form"),
        buttons: visibleCount("button"),
        links: visibleCount("a"),
        canvases: visibleCount("canvas"),
      },
      geometry,
      canvasBoxes: [...document.querySelectorAll("canvas")].filter(isVisible).map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    };
  });
  const screenshotFrames = [];
  if (frameSamples <= 1) {
    await page.screenshot({ path: outputFile, fullPage: false });
    screenshotFrames.push(outputFile);
  } else {
    for (let index = 0; index < frameSamples; index += 1) {
      const frameFile = sampledScreenshotPath(outputFile, index);
      await page.screenshot({ path: frameFile, fullPage: false });
      screenshotFrames.push(frameFile);
      if (index + 1 < frameSamples) await page.waitForTimeout(frameIntervalMs);
    }
  }
  await context.close();
  return { ...snapshot, requests, consoleErrors, pageErrors, screenshot: outputFile, screenshotFrames, actionTrace };
}

function compareGeometry(source, local, maxDelta) {
  const localByKey = new Map(local.map((entry) => [entry.key, entry]));
  const findings = [];
  for (const sourceEntry of source) {
    const localEntry = localByKey.get(sourceEntry.key);
    if (!localEntry) {
      findings.push({ code: "geometry-element-missing", key: sourceEntry.key });
      continue;
    }
    for (const property of ["x", "y", "width", "height"]) {
      const delta = Math.abs(sourceEntry.rect[property] - localEntry.rect[property]);
      if (delta > maxDelta) findings.push({ code: "geometry-mismatch", key: sourceEntry.key, property, delta });
    }
    if (JSON.stringify(sourceEntry.style) !== JSON.stringify(localEntry.style)) {
      findings.push({ code: "computed-style-mismatch", key: sourceEntry.key });
    }
  }
  return findings;
}

function compareScreenshots(sourceFile, localFile, outputFile) {
  const source = PNG.sync.read(readFileSync(sourceFile));
  const local = PNG.sync.read(readFileSync(localFile));
  if (source.width !== local.width || source.height !== local.height) {
    return { mismatchRatio: 1, dimensionsMatch: false };
  }
  const diff = new PNG({ width: source.width, height: source.height });
  const mismatched = pixelmatch(source.data, local.data, diff.data, source.width, source.height, { threshold: 0.1 });
  writeFileSync(outputFile, PNG.sync.write(diff));
  return { mismatchRatio: mismatched / (source.width * source.height), dimensionsMatch: true };
}

export function compareScreenshotSequences(sourceFiles, localFiles, sourceOutput, localOutput, diffOutput) {
  const sourceFrames = sourceFiles.map((file) => ({ file, png: PNG.sync.read(readFileSync(file)) }));
  const localFrames = localFiles.map((file) => ({ file, png: PNG.sync.read(readFileSync(file)) }));
  let best = null;

  for (let sourceIndex = 0; sourceIndex < sourceFrames.length; sourceIndex += 1) {
    for (let localIndex = 0; localIndex < localFrames.length; localIndex += 1) {
      const source = sourceFrames[sourceIndex].png;
      const local = localFrames[localIndex].png;
      const dimensionsMatch = source.width === local.width && source.height === local.height;
      const mismatchRatio = dimensionsMatch
        ? pixelmatch(source.data, local.data, null, source.width, source.height, { threshold: 0.1 }) / (source.width * source.height)
        : 1;
      if (!best || mismatchRatio < best.mismatchRatio) {
        best = { sourceIndex, localIndex, mismatchRatio, dimensionsMatch };
      }
    }
  }

  const matchedSource = sourceFrames[best.sourceIndex].file;
  const matchedLocal = localFrames[best.localIndex].file;
  const bestSourceOutput = sourceOutput.replace(/\.png$/i, "-best-frame.png");
  const bestLocalOutput = localOutput.replace(/\.png$/i, "-best-frame.png");
  copyFileSync(matchedSource, bestSourceOutput);
  copyFileSync(matchedLocal, bestLocalOutput);

  const dimensionsMatch = [...sourceFrames, ...localFrames].every(({ png }) => (
    png.width === sourceFrames[0].png.width && png.height === sourceFrames[0].png.height
  ));
  let temporalMeanMismatchRatio = 1;
  let sourceMean = null;
  let localMean = null;
  if (dimensionsMatch) {
    const temporalMean = (frames) => {
      const output = new PNG({ width: frames[0].png.width, height: frames[0].png.height });
      for (let index = 0; index < output.data.length; index += 1) {
        let sum = 0;
        for (const frame of frames) sum += frame.png.data[index];
        output.data[index] = Math.round(sum / frames.length);
      }
      return output;
    };
    sourceMean = temporalMean(sourceFrames);
    localMean = temporalMean(localFrames);
    temporalMeanMismatchRatio = pixelmatch(
      sourceMean.data,
      localMean.data,
      null,
      sourceMean.width,
      sourceMean.height,
      { threshold: 0.1 },
    ) / (sourceMean.width * sourceMean.height);
  }

  const useTemporalMean = dimensionsMatch && temporalMeanMismatchRatio <= best.mismatchRatio;
  if (useTemporalMean) {
    writeFileSync(sourceOutput, PNG.sync.write(sourceMean));
    writeFileSync(localOutput, PNG.sync.write(localMean));
    compareScreenshots(sourceOutput, localOutput, diffOutput);
  } else {
    copyFileSync(matchedSource, sourceOutput);
    copyFileSync(matchedLocal, localOutput);
    compareScreenshots(sourceOutput, localOutput, diffOutput);
  }
  return {
    mismatchRatio: useTemporalMean ? temporalMeanMismatchRatio : best.mismatchRatio,
    temporalMeanMismatchRatio,
    bestFrameMismatchRatio: best.mismatchRatio,
    dimensionsMatch,
    comparisonMode: sourceFiles.length === 1 && localFiles.length === 1
      ? "single-frame"
      : useTemporalMean ? "temporal-mean" : "phase-aligned-frame",
    sampleCount: Math.max(sourceFiles.length, localFiles.length),
    matchedSourceFrame: best.sourceIndex,
    matchedLocalFrame: best.localIndex,
    bestSourceScreenshot: bestSourceOutput,
    bestLocalScreenshot: bestLocalOutput,
  };
}

function canvasVariation(file, boxes) {
  if (boxes.length === 0) return [];
  const png = PNG.sync.read(readFileSync(file));
  return boxes.map((box) => {
    const startX = Math.max(0, Math.floor(box.x));
    const startY = Math.max(0, Math.floor(box.y));
    const endX = Math.min(png.width, Math.ceil(box.x + box.width));
    const endY = Math.min(png.height, Math.ceil(box.y + box.height));
    let total = 0;
    let different = 0;
    let baseline = null;
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = (y * png.width + x) * 4;
        const color = `${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}`;
        if (baseline === null) baseline = color;
        else if (color !== baseline) different += 1;
        total += 1;
      }
    }
    return total === 0 ? 0 : different / total;
  });
}

export async function runProof({ contract, outputDir }) {
  ensureDir(outputDir);
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  const scenarios = [];
  const determinism = {
    randomSeed: 1597463007,
    captureMode: "parallel",
    animationFrameIntervalMs: 60,
    ...(contract.determinism || {}),
  };
  try {
    const environments = contract.environments || [{ id: "default", ...contract.environment }];
    for (const environment of environments) {
      for (const scenario of contract.scenarios) {
      const artifactId = environments.length === 1 ? scenario.id : `${scenario.id}-${environment.id}`;
      const sourceFile = join(outputDir, `${artifactId}-source.png`);
      const localFile = join(outputDir, `${artifactId}-local.png`);
      const diffFile = join(outputDir, `${artifactId}-diff.png`);
      const randomSeed = proofSeed(determinism.randomSeed, artifactId);
      const frameSamples = Math.max(1, Number(scenario.animationFrameSamples ?? determinism.animationFrameSamples ?? 1) || 1);
      const frameIntervalMs = Math.max(0, Number(determinism.animationFrameIntervalMs) || 0);
      const sourceCapture = () => capture(browser, contract.sourceUrl, scenario, environment, sourceFile, randomSeed, frameSamples, frameIntervalMs);
      const localCapture = () => capture(browser, contract.localUrl, scenario, environment, localFile, randomSeed, frameSamples, frameIntervalMs);
      const [source, local] = determinism.captureMode === "parallel"
        ? await Promise.all([sourceCapture(), localCapture()])
        : [await sourceCapture(), await localCapture()];
      const findings = [];
      findings.push(...source.actionTrace.findings.map((finding) => ({ ...finding, code: `source-${finding.code}` })));
      findings.push(...local.actionTrace.findings);
      const checkpointIds = new Set([
        ...Object.keys(source.actionTrace.checkpoints),
        ...Object.keys(local.actionTrace.checkpoints),
      ]);
      for (const checkpoint of checkpointIds) {
        const sourceCheckpoint = source.actionTrace.checkpoints[checkpoint];
        const localCheckpoint = local.actionTrace.checkpoints[checkpoint];
        findings.push(...compareCheckpoint(sourceCheckpoint, localCheckpoint, checkpoint, contract.thresholds.geometryMaxDeltaPx));
      }
      if (source.title !== local.title) findings.push({ code: "title-mismatch", source: source.title, local: local.title });
      if (normalizeText(source.visibleText) !== normalizeText(local.visibleText)) {
        findings.push({ code: "visible-text-mismatch", source: source.visibleText, local: local.visibleText });
      }
      if (JSON.stringify(source.landmarks) !== JSON.stringify(local.landmarks)) {
        findings.push({ code: "landmark-mismatch", source: source.landmarks, local: local.landmarks });
      }
      findings.push(...compareGeometry(source.geometry, local.geometry, contract.thresholds.geometryMaxDeltaPx));
      const localOrigin = new URL(contract.localUrl).origin;
      const automaticExternal = local.requests.filter((request) => {
        const url = new URL(request.url);
        return ["http:", "https:"].includes(url.protocol) && url.origin !== localOrigin;
      });
      if (automaticExternal.length > contract.thresholds.automaticExternalRequests) {
        findings.push({ code: "automatic-external-request", requests: automaticExternal });
      }
      if (local.consoleErrors.length > contract.thresholds.consoleErrors) findings.push({ code: "console-error", errors: local.consoleErrors });
      if (local.pageErrors.length > contract.thresholds.pageErrors) findings.push({ code: "page-error", errors: local.pageErrors });
      const image = compareScreenshotSequences(source.screenshotFrames, local.screenshotFrames, sourceFile, localFile, diffFile);
      if (image.mismatchRatio > contract.thresholds.screenshotMismatchRatio) {
        findings.push({ code: "screenshot-mismatch", mismatchRatio: image.mismatchRatio });
      }
      if (scenario.checkpoints.includes("canvas-nonblank")) {
        const ratios = canvasVariation(localFile, local.canvasBoxes);
        if (ratios.length === 0 || ratios.some((ratio) => ratio < contract.thresholds.canvasMinimumNonTransparentRatio)) {
          findings.push({ code: "canvas-blank", ratios });
        }
      }
      scenarios.push({
        id: artifactId,
        scenarioId: scenario.id,
        environment: environment.id,
        route: scenario.route,
        passed: findings.length === 0,
        findings,
        source,
        local,
        image,
      });
      }
    }
  } finally {
    await browser.close();
  }

  const summary = {
    passed: scenarios.every((scenario) => scenario.passed),
    thresholdFingerprint: contract.thresholdFingerprint,
    scenarios,
  };
  writeText(join(outputDir, "proof-summary.json"), safeJson(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contract || !args.output) {
    console.error("Usage: run-proof.mjs --contract FILE --output DIRECTORY");
    process.exit(2);
  }
  const summary = await runProof({
    contract: JSON.parse(readText(resolve(String(args.contract)))),
    outputDir: resolve(String(args.output)),
  });
  if (!summary.passed) process.exit(3);
}
