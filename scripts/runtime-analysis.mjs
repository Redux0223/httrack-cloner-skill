import { Parser } from "acorn";
import jsx from "acorn-jsx";
import * as walk from "acorn-walk";
import { createHash } from "node:crypto";

const JavaScriptParser = Parser.extend(jsx());
const jsxWalkBase = {
  ...walk.base,
  JSXElement(node, state, callback) {
    callback(node.openingElement, state);
    for (const child of node.children) callback(child, state);
    if (node.closingElement) callback(node.closingElement, state);
  },
  JSXFragment(node, state, callback) {
    callback(node.openingFragment, state);
    for (const child of node.children) callback(child, state);
    callback(node.closingFragment, state);
  },
  JSXOpeningElement(node, state, callback) {
    callback(node.name, state);
    for (const attribute of node.attributes) callback(attribute, state);
  },
  JSXClosingElement(node, state, callback) {
    callback(node.name, state);
  },
  JSXAttribute(node, state, callback) {
    callback(node.name, state);
    if (node.value) callback(node.value, state);
  },
  JSXSpreadAttribute(node, state, callback) {
    callback(node.argument, state);
  },
  JSXExpressionContainer(node, state, callback) {
    callback(node.expression, state);
  },
  JSXSpreadChild(node, state, callback) {
    callback(node.expression, state);
  },
  JSXMemberExpression(node, state, callback) {
    callback(node.object, state);
    callback(node.property, state);
  },
  JSXNamespacedName(node, state, callback) {
    callback(node.namespace, state);
    callback(node.name, state);
  },
  JSXIdentifier() {},
  JSXText() {},
  JSXEmptyExpression() {},
  JSXOpeningFragment() {},
  JSXClosingFragment() {},
  TemplateLiteral(node, state, callback) {
    for (const quasi of node.quasis) callback(quasi, state);
    for (const expression of node.expressions) callback(expression, state);
  },
  TemplateElement() {},
};

function simpleWalk(program, visitors) {
  walk.simple(program, visitors, jsxWalkBase);
}

function ancestorWalk(program, visitors) {
  walk.ancestor(program, visitors, jsxWalkBase);
}

const NETWORK_CALLS = new Set(["fetch", "sendBeacon"]);
const NETWORK_CONSTRUCTORS = new Set(["WebSocket", "EventSource", "Worker", "SharedWorker"]);
const LOAD_ATTRIBUTES = new Set(["src", "poster", "action"]);
const NAVIGATION_ATTRIBUTES = new Set(["href"]);
const INERT_URL_PREFIXES = [
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/2000/xmlns/",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  "https://react.dev/errors/",
  "https://reactjs.org/docs/error-decoder.html",
];
const CREDENTIAL_PATTERNS = [
  { kind: "jwt", regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "openai-key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { kind: "stripe-secret", regex: /sk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "google-api-key", regex: /AIza[A-Za-z0-9_-]{20,}/g },
];
const PROTOCOL_RELATIVE_HOST = "(?:localhost|(?:\\d{1,3}\\.){3}\\d{1,3}|\\[[0-9a-f:]+\\]|[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)";
const REMOTE_URL_SOURCE = `(?:https?:\\/\\/[^\\s"'\\x60\\\\)<>]+|\\/\\/${PROTOCOL_RELATIVE_HOST}(?::\\d+)?(?:[/?#][^\\s"'\\x60\\\\)<>]*)?)`;

function remoteUrlRegex(flags = "gi") {
  return new RegExp(REMOTE_URL_SOURCE, flags);
}

export function isLoopbackUrl(value) {
  if (typeof value !== "string" || !/^(?:https?:)?\/\//i.test(value)) return false;
  try {
    const url = new URL(value.startsWith("//") ? `http:${value}` : value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "::1"
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function parseProgram(source) {
  const options = {
    ecmaVersion: "latest",
    locations: true,
    ranges: true,
    allowHashBang: true,
  };
  try {
    return JavaScriptParser.parse(source, { ...options, sourceType: "module" });
  } catch (moduleError) {
    try {
      return JavaScriptParser.parse(source, { ...options, sourceType: "script" });
    } catch (scriptError) {
      scriptError.cause = moduleError;
      throw scriptError;
    }
  }
}

function propertyName(member) {
  if (!member || member.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal") return String(member.property.value);
  return null;
}

function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  return propertyName(callee);
}

function unknownValue(origins = []) {
  return { value: "*", complete: false, origins };
}

function mergeValues(parts) {
  return {
    value: parts.map((part) => part.value).join(""),
    complete: parts.every((part) => part.complete),
    origins: parts.flatMap((part) => part.origins),
  };
}

function evaluate(node, constants, seen = new Set()) {
  if (!node) return unknownValue();
  if (node.type === "Literal" && typeof node.value === "string") {
    return { value: node.value, complete: true, origins: [node] };
  }
  if (node.type === "TemplateLiteral") {
    const parts = [];
    for (let index = 0; index < node.quasis.length; index += 1) {
      const quasi = node.quasis[index];
      parts.push({ value: quasi.value.cooked ?? quasi.value.raw, complete: true, origins: [] });
      if (index < node.expressions.length) parts.push(evaluate(node.expressions[index], constants, seen));
    }
    const merged = mergeValues(parts);
    if (node.expressions.length === 0) merged.origins.push(node);
    return merged;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return mergeValues([evaluate(node.left, constants, seen), evaluate(node.right, constants, seen)]);
  }
  if (node.type === "Identifier") {
    if (seen.has(node.name) || !constants.has(node.name)) return unknownValue();
    const nextSeen = new Set(seen);
    nextSeen.add(node.name);
    return evaluate(constants.get(node.name), constants, nextSeen);
  }
  if (node.type === "ConditionalExpression") {
    const consequent = evaluate(node.consequent, constants, seen);
    const alternate = evaluate(node.alternate, constants, seen);
    if (consequent.value === alternate.value) return mergeValues([consequent]);
    return unknownValue([...consequent.origins, ...alternate.origins]);
  }
  if (node.type === "CallExpression" && calleeName(node.callee) === "encodeURIComponent") {
    return unknownValue(node.arguments.flatMap((argument) => evaluate(argument, constants, seen).origins));
  }
  return unknownValue();
}

function collectStatementConstants(statements, before, constants) {
  for (const statement of statements) {
    if (statement.start >= before) break;
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === "Identifier" && declaration.init) constants.set(declaration.id.name, declaration.init);
      }
      continue;
    }
    if (
      statement.type === "ExpressionStatement"
      && statement.expression.type === "AssignmentExpression"
      && statement.expression.left.type === "Identifier"
    ) {
      constants.set(statement.expression.left.name, statement.expression.right);
    }
  }
}

function scopedConstants(program, ancestors, before) {
  const constants = new Map();
  collectStatementConstants(program.body, before, constants);
  for (const ancestor of ancestors) {
    if (ancestor.type === "BlockStatement") collectStatementConstants(ancestor.body, before, constants);
    if (ancestor.type === "ForStatement" && ancestor.init?.type === "VariableDeclaration") {
      for (const declaration of ancestor.init.declarations) {
        if (declaration.id.type === "Identifier" && declaration.init) constants.set(declaration.id.name, declaration.init);
      }
    }
  }
  return constants;
}

function looksRemote(value) {
  return new RegExp(`^${REMOTE_URL_SOURCE}`, "i").test(value || "") && !isLoopbackUrl(value);
}

function normalizedFinding(kind, node, evaluated) {
  return {
    kind,
    url: evaluated.value,
    complete: evaluated.complete,
    line: node.loc?.start.line || 1,
    column: (node.loc?.start.column || 0) + 1,
    origins: evaluated.origins,
  };
}

function collectLiteralUrls(program) {
  const literals = [];
  simpleWalk(program, {
    Literal(node) {
      if (typeof node.value !== "string") return;
      for (const match of node.value.matchAll(remoteUrlRegex())) {
        literals.push({
          url: match[0],
          line: node.loc?.start.line || 1,
          column: (node.loc?.start.column || 0) + 1,
          node,
        });
      }
    },
    TemplateLiteral(node) {
      if (node.expressions.length > 0) return;
      const value = node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? "";
      for (const match of value.matchAll(remoteUrlRegex())) {
        literals.push({
          url: match[0],
          line: node.loc?.start.line || 1,
          column: (node.loc?.start.column || 0) + 1,
          node,
        });
      }
    },
  });
  return literals;
}

function expressionName(node) {
  if (!node) return "unknown";
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression") {
    return `${expressionName(node.object)}.${propertyName(node) || "unknown"}`;
  }
  if (node.type === "CallExpression") return `${expressionName(node.callee)}()`;
  return node.type;
}

function behaviorLocation(node) {
  return {
    line: node.loc?.start.line || 1,
    column: (node.loc?.start.column || 0) + 1,
  };
}

export function analyzeBehavior(source) {
  const program = parseProgram(source);
  const report = {
    events: [],
    animationFrames: [],
    timers: [],
    observers: [],
    storage: [],
    history: [],
    forms: [],
    media: [],
    canvas: [],
    workers: [],
    domSelectors: [],
    cleanupRequirements: [],
  };

  simpleWalk(program, {
    CallExpression(node) {
      const name = calleeName(node.callee);
      const target = node.callee.type === "MemberExpression" ? expressionName(node.callee.object) : "globalThis";
      const location = behaviorLocation(node);
      if (name === "addEventListener") {
        const event = evaluate(node.arguments[0], new Map()).value;
        report.events.push({ target, event, ...location });
        report.cleanupRequirements.push({ operation: "removeEventListener", target, event, ...location });
      }
      if (name === "requestAnimationFrame") {
        report.animationFrames.push({ target, ...location });
        report.cleanupRequirements.push({ operation: "cancelAnimationFrame", target, ...location });
      }
      if (name === "setTimeout" || name === "setInterval") {
        report.timers.push({ kind: name, target, ...location });
        report.cleanupRequirements.push({ operation: name === "setInterval" ? "clearInterval" : "clearTimeout", target, ...location });
      }
      if (["setItem", "getItem", "removeItem", "clear"].includes(name) && /Storage$|localStorage|sessionStorage/.test(target)) {
        report.storage.push({ operation: name, target, ...location });
      }
      if (["pushState", "replaceState", "back", "forward", "go"].includes(name) && /history$/.test(target)) {
        report.history.push({ operation: name, target, ...location });
      }
      if (["submit", "requestSubmit", "reset"].includes(name)) {
        report.forms.push({ operation: name, target, ...location });
      }
      if (["play", "pause", "load"].includes(name)) {
        report.media.push({ operation: name, target, ...location });
      }
      if (name === "getContext") {
        report.canvas.push({ context: evaluate(node.arguments[0], new Map()).value, target, ...location });
      }
      if (["querySelector", "querySelectorAll"].includes(name)) {
        report.domSelectors.push({ selector: evaluate(node.arguments[0], new Map()).value, operation: name, ...location });
      }
      if (name === "getElementById") {
        const value = evaluate(node.arguments[0], new Map()).value;
        report.domSelectors.push({ selector: value === "*" ? "*" : `#${value}`, operation: name, ...location });
      }
    },
    NewExpression(node) {
      const name = calleeName(node.callee);
      const location = behaviorLocation(node);
      if (["ResizeObserver", "MutationObserver", "IntersectionObserver"].includes(name)) {
        report.observers.push({ kind: name, ...location });
        report.cleanupRequirements.push({ operation: "disconnect", target: name, ...location });
      }
      if (["Worker", "SharedWorker"].includes(name)) {
        report.workers.push({ kind: name, url: evaluate(node.arguments[0], new Map()).value, ...location });
        report.cleanupRequirements.push({ operation: "terminate", target: name, ...location });
      }
    },
  });

  const events = new Set(report.events.map((entry) => String(entry.event || "").toLowerCase()));
  const hasAnyEvent = (...names) => names.some((name) => events.has(name));
  const hasDown = hasAnyEvent("pointerdown", "mousedown", "touchstart");
  const hasUp = hasAnyEvent("pointerup", "mouseup", "touchend", "pointercancel", "touchcancel");
  const hasMove = hasAnyEvent("pointermove", "mousemove", "touchmove");
  const interactionFamilies = new Set();
  if (hasAnyEvent("wheel", "scroll", "touchmove")) interactionFamilies.add("scroll");
  if (hasAnyEvent("click", "dblclick")) interactionFamilies.add("click");
  if (hasDown && hasMove) interactionFamilies.add("pointer-drag");
  if (hasDown && hasUp && (report.timers.length > 0 || report.animationFrames.length > 0)) interactionFamilies.add("press-and-hold");
  if (report.forms.length > 0 || hasAnyEvent("submit", "input", "change")) interactionFamilies.add("forms");
  if (report.history.length > 0 || hasAnyEvent("popstate", "hashchange")) interactionFamilies.add("navigation");
  if ([...events].some((event) => event.startsWith("touch"))) interactionFamilies.add("touch");
  if ([...events].some((event) => event.startsWith("key"))) interactionFamilies.add("keyboard");
  if (report.media.length > 0) interactionFamilies.add("media");
  report.interactionFamilies = [...interactionFamilies].sort();

  return report;
}

export function analyzeJavaScript(source) {
  const program = parseProgram(source);
  const automatic = [];
  const navigation = [];

  function record(collection, kind, node, valueNode, constants) {
    const evaluated = evaluate(valueNode, constants);
    if (looksRemote(evaluated.value)) collection.push(normalizedFinding(kind, node, evaluated));
  }

  ancestorWalk(program, {
    CallExpression(node, _state, ancestors) {
      const constants = scopedConstants(program, ancestors, node.start);
      const name = calleeName(node.callee);
      if (NETWORK_CALLS.has(name)) record(automatic, name, node, node.arguments[0], constants);
      let recordedXhr = false;
      if (name === "open" && node.arguments.length >= 2) {
        const method = evaluate(node.arguments[0], constants).value.toUpperCase();
        if (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
          record(automatic, "xhr", node, node.arguments[1], constants);
          recordedXhr = true;
        }
      }
      if (name === "setAttribute" && node.arguments.length >= 2) {
        const attribute = evaluate(node.arguments[0], constants).value.toLowerCase();
        if (LOAD_ATTRIBUTES.has(attribute)) record(automatic, `setAttribute:${attribute}`, node, node.arguments[1], constants);
        if (NAVIGATION_ATTRIBUTES.has(attribute)) record(navigation, `setAttribute:${attribute}`, node, node.arguments[1], constants);
      }
      if (name === "open" && propertyName(node.callee) === "open" && !recordedXhr && node.arguments.length >= 1) {
        record(navigation, "window.open", node, node.arguments[0], constants);
      }
    },
    NewExpression(node, _state, ancestors) {
      const constants = scopedConstants(program, ancestors, node.start);
      const name = calleeName(node.callee);
      if (NETWORK_CONSTRUCTORS.has(name)) record(automatic, name, node, node.arguments[0], constants);
    },
    ImportExpression(node, _state, ancestors) {
      record(automatic, "dynamic-import", node, node.source, scopedConstants(program, ancestors, node.start));
    },
    AssignmentExpression(node, _state, ancestors) {
      const constants = scopedConstants(program, ancestors, node.start);
      const name = propertyName(node.left);
      if (LOAD_ATTRIBUTES.has(name)) record(automatic, `property:${name}`, node, node.right, constants);
      if (NAVIGATION_ATTRIBUTES.has(name)) record(navigation, `property:${name}`, node, node.right, constants);
    },
  });

  const usedOriginNodes = new Set(
    [...automatic, ...navigation].flatMap((finding) => finding.origins),
  );
  const literalUrls = collectLiteralUrls(program);
  const isInertUrl = (url) => isLoopbackUrl(url) || INERT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
  const inert = literalUrls.filter((entry) => isInertUrl(entry.url));
  const unknown = literalUrls.filter(
    (entry) => !usedOriginNodes.has(entry.node) && !isInertUrl(entry.url),
  );

  return { program, automatic, navigation, inert, unknown };
}

export function findCredentials(source) {
  const findings = [];
  for (const { kind, regex } of CREDENTIAL_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      findings.push({
        kind,
        line: source.slice(0, match.index).split("\n").length,
        column: match.index - source.lastIndexOf("\n", match.index - 1),
        fingerprint: createHash("sha256").update(match[0]).digest("hex").slice(0, 12),
      });
    }
  }
  return findings;
}

function redactCredentials(source) {
  const findings = findCredentials(source);
  let redacted = source;
  for (const { kind, regex } of CREDENTIAL_PATTERNS) {
    regex.lastIndex = 0;
    redacted = redacted.replace(regex, `__REDACTED_${kind.toUpperCase().replace(/-/g, "_")}__`);
  }
  return { source: redacted, findings };
}

function neutralizeRemoteUrls(source) {
  const removed = [];
  const program = parseProgram(source);
  const edits = [];
  const replaceUrls = (value) => String(value).replace(remoteUrlRegex(), (url) => {
    if (isLoopbackUrl(url) || INERT_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
    removed.push(url);
    return "#";
  });
  simpleWalk(program, {
    Literal(node) {
      if (typeof node.value !== "string") return;
      const replacement = replaceUrls(node.value);
      if (replacement !== node.value) edits.push({ start: node.start, end: node.end, replacement: JSON.stringify(replacement) });
    },
    TemplateElement(node) {
      const original = source.slice(node.start, node.end);
      const replacement = replaceUrls(original);
      if (replacement !== original) edits.push({ start: node.start, end: node.end, replacement });
    },
  });
  let sanitized = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    sanitized = sanitized.slice(0, edit.start) + edit.replacement + sanitized.slice(edit.end);
  }
  return { source: sanitized, removed };
}

function concreteUrl(urlValue) {
  const wildcard = urlValue.indexOf("*");
  return wildcard >= 0 ? urlValue.slice(0, wildcard) : urlValue;
}

function urlSuffix(concrete, url) {
  if (concrete.startsWith("//")) return concrete.slice(url.host.length + 2);
  return concrete.slice(url.origin.length);
}

function offlinePath(urlValue, sourceUrl) {
  const concrete = concreteUrl(urlValue);
  const url = new URL(concrete, sourceUrl);
  return `/__offline__/${url.host}${urlSuffix(concrete, url)}`;
}

function localPath(urlValue, sourceUrl) {
  const concrete = concreteUrl(urlValue);
  const url = new URL(concrete, sourceUrl);
  return urlSuffix(concrete, url);
}

export function sanitizeJavaScript(source, { sourceUrl }) {
  const sourceOrigin = new URL(sourceUrl).origin;
  const before = analyzeJavaScript(source);
  const editsByNode = new Map();
  const localizedRemoteRequests = [];
  const stubbedRemoteRequests = [];
  const removedOutboundNavigations = before.navigation.map(({ origins, ...finding }) => finding);

  for (const finding of before.automatic) {
    const remoteOrigins = finding.origins.filter((node) => {
      const evaluated = evaluate(node, new Map());
      return looksRemote(evaluated.value);
    });
    if (remoteOrigins.length === 0) {
      continue;
    }
    for (const originNode of remoteOrigins) {
      const originValue = evaluate(originNode, new Map()).value;
      const originUrl = new URL(concreteUrl(originValue), sourceUrl);
      const replacement = originUrl.origin === sourceOrigin ? localPath(originValue, sourceUrl) : offlinePath(originValue, sourceUrl);
      editsByNode.set(originNode, {
        start: originNode.start,
        end: originNode.end,
        replacement: JSON.stringify(replacement),
      });
    }
    const record = { kind: finding.kind, url: finding.url, line: finding.line, column: finding.column };
    const requestUrl = new URL(concreteUrl(finding.url), sourceUrl);
    if (requestUrl.origin === sourceOrigin) localizedRemoteRequests.push(record);
    else stubbedRemoteRequests.push(record);
  }

  let sanitized = source;
  const edits = [...editsByNode.values()].sort((left, right) => right.start - left.start);
  for (const edit of edits) {
    sanitized = sanitized.slice(0, edit.start) + edit.replacement + sanitized.slice(edit.end);
  }

  const remoteLiteralResult = neutralizeRemoteUrls(sanitized);
  sanitized = remoteLiteralResult.source;
  const credentialResult = redactCredentials(sanitized);
  sanitized = credentialResult.source;
  const after = analyzeJavaScript(sanitized);
  return {
    source: sanitized,
    changed: sanitized !== source,
    automaticBefore: before.automatic.map(({ origins, ...finding }) => finding),
    automaticAfter: after.automatic.map(({ origins, ...finding }) => finding),
    navigation: after.navigation.map(({ origins, ...finding }) => finding),
    unknown: after.unknown.map(({ node, ...finding }) => finding),
    localizedRemoteRequests,
    stubbedRemoteRequests,
    unresolvedRemoteRequests: [],
    redactedCredentials: credentialResult.findings,
    removedOutboundNavigations,
    removedRemoteLiterals: remoteLiteralResult.removed,
  };
}
