import { parse as parseJavaScript } from "acorn";

const ATTRIBUTE_SINKS = new Set(["data", "href", "poster", "src", "srcset"]);
const FIRST_ARGUMENT_SINKS = new Set([
  "addModule",
  "fetch",
  "get",
  "importScripts",
  "load",
  "loadAsync",
  "preload",
  "register",
  "sendBeacon",
  "setDecoderPath",
  "setPath",
  "setResourcePath",
  "setTranscoderPath",
  "setWasmPath",
  "setWorkerPath",
]);
const ASSET_CONSTRUCTORS = new Set(["Audio", "SharedWorker", "Worker"]);
const PATH_WRAPPERS = new Set(["AssetLoader.getPath", "Assets.getPath", "decodeURI", "decodeURIComponent", "String"]);
const assetLikePattern = /(?:^|[/.])[A-Za-z0-9_@.%+() -]+\.[a-z0-9]{2,8}(?:[?#].*)?$/i;
const cssUrlPattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
const htmlAssetPattern = /(?:src|href|poster|data)\s*=\s*["']([^"']+)["']/gi;
const htmlSrcsetPattern = /srcset\s*=\s*["']([^"']+)["']/gi;

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.values = new Map();
  }

  get(key) {
    if (this.values.has(key)) return this.values.get(key);
    return this.parent?.get(key);
  }

  set(key, value) {
    if (key && value !== undefined) this.values.set(key, value);
  }
}

function propertyName(node, env) {
  if (!node) return null;
  if (!node.computed && node.property?.type === "Identifier") return node.property.name;
  const value = evaluate(node.property, env);
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function memberKey(node, env) {
  if (!node || node.type !== "MemberExpression") return null;
  const property = propertyName(node, env);
  if (!property) return null;
  if (node.object?.type === "Identifier") return `${node.object.name}.${property}`;
  const parent = memberKey(node.object, env);
  return parent ? `${parent}.${property}` : null;
}

function calleeName(node, env) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return memberKey(node, env) || propertyName(node, env);
  return null;
}

function evaluate(node, env) {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") return env.get(node.name);
  if (node.type === "AssignmentExpression" && node.operator === "=") return evaluate(node.right, env);
  if (node.type === "ArrayExpression") return node.elements.map((element) => evaluate(element, env));
  if (node.type === "ObjectExpression") {
    const output = {};
    for (const property of node.properties || []) {
      if (property.type !== "Property" || property.kind !== "init") continue;
      const key = property.computed ? evaluate(property.key, env) : property.key.name ?? property.key.value;
      if (key !== undefined) output[String(key)] = evaluate(property.value, env);
    }
    return output;
  }
  if (node.type === "MemberExpression") {
    const key = memberKey(node, env);
    const direct = key ? env.get(key) : undefined;
    if (direct !== undefined) return direct;
    const object = evaluate(node.object, env);
    const property = propertyName(node, env);
    if (object != null && property != null && (Array.isArray(object) || typeof object === "object")) {
      return object[property];
    }
    return undefined;
  }
  if (node.type === "TemplateLiteral") {
    let output = "";
    for (let index = 0; index < node.quasis.length; index += 1) {
      output += node.quasis[index].value.cooked ?? node.quasis[index].value.raw;
      if (index < node.expressions.length) {
        const value = evaluate(node.expressions[index], env);
        if (["string", "number", "boolean"].includes(typeof value)) output += String(value);
        else return undefined;
      }
    }
    return output;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = evaluate(node.left, env);
    const right = evaluate(node.right, env);
    if (left === undefined || right === undefined) return undefined;
    return typeof left === "string" || typeof right === "string" ? `${left}${right}` : Number(left) + Number(right);
  }
  if (node.type === "LogicalExpression") {
    const left = evaluate(node.left, env);
    if (node.operator === "&&") return left ? evaluate(node.right, env) : left;
    if (node.operator === "||") return left || evaluate(node.right, env);
    if (node.operator === "??") return left ?? evaluate(node.right, env);
  }
  if (node.type === "ConditionalExpression") {
    const test = evaluate(node.test, env);
    if (typeof test === "boolean") return evaluate(test ? node.consequent : node.alternate, env);
  }
  if (node.type === "UnaryExpression") {
    const value = evaluate(node.argument, env);
    if (node.operator === "!") return !value;
    if (node.operator === "+" && value !== undefined) return Number(value);
    if (node.operator === "-" && value !== undefined) return -Number(value);
    if (node.operator === "void") return undefined;
  }
  if (node.type === "CallExpression") {
    const name = calleeName(node.callee, env);
    if (name === "isDataURI") {
      const value = evaluate(node.arguments[0], env);
      if (typeof value === "string") return value.startsWith("data:");
    }
    if (name === "isFileURI") {
      const value = evaluate(node.arguments[0], env);
      if (typeof value === "string") return value.startsWith("file:");
    }
    if (name === "locateFile") {
      const value = evaluate(node.arguments[0], env);
      if (typeof value === "string") return value.includes("/") ? value : `./${value}`;
    }
    if (name && PATH_WRAPPERS.has(name)) return evaluate(node.arguments[0], env);
    if (name?.endsWith(".concat")) {
      const base = evaluate(node.callee.object, env);
      const parts = node.arguments.map((argument) => evaluate(argument, env));
      if (typeof base === "string" && parts.every((part) => ["string", "number"].includes(typeof part))) {
        return `${base}${parts.join("")}`;
      }
    }
    if (name?.endsWith(".join")) {
      const base = evaluate(node.callee.object, env);
      const separator = evaluate(node.arguments[0], env) ?? ",";
      if (Array.isArray(base) && base.every((part) => ["string", "number"].includes(typeof part))) {
        return base.join(String(separator));
      }
    }
  }
  if (node.type === "NewExpression" && calleeName(node.callee, env) === "URL") {
    return evaluate(node.arguments[0], env);
  }
  return undefined;
}

function parseProgram(source) {
  for (const sourceType of ["script", "module"]) {
    try {
      return {
        program: parseJavaScript(source, {
          ecmaVersion: "latest",
          sourceType,
          allowAwaitOutsideFunction: true,
          allowReturnOutsideFunction: true,
        }),
        error: null,
      };
    } catch (error) {
      if (sourceType === "module") return { program: null, error: String(error?.message || error) };
    }
  }
  return { program: null, error: "Unable to parse JavaScript" };
}

function isAssetManifestTarget(key) {
  return Boolean(key && (key === "ASSETS" || key.endsWith(".ASSETS") || key.startsWith("ASSETS.") || key.includes(".ASSETS.")));
}

function staticPropertyName(node, env) {
  if (node?.type !== "MemberExpression") return null;
  return propertyName(node, env);
}

export function discoverRuntimeAssetReferences(source) {
  const { program, error } = parseProgram(source);
  const references = new Set();

  const record = (value) => {
    if (typeof value !== "string") return;
    if (assetLikePattern.test(value)) references.add(value);
  };

  const recordSrcset = (value) => {
    if (typeof value !== "string") return;
    for (const candidate of value.split(",")) record(candidate.trim().split(/\s+/, 1)[0]);
  };

  const recordCss = (value) => {
    if (typeof value !== "string") return;
    cssUrlPattern.lastIndex = 0;
    for (const match of value.matchAll(cssUrlPattern)) record(match[1]);
  };

  const recordHtml = (value) => {
    if (typeof value !== "string") return;
    htmlAssetPattern.lastIndex = 0;
    htmlSrcsetPattern.lastIndex = 0;
    for (const match of value.matchAll(htmlAssetPattern)) record(match[1]);
    for (const match of value.matchAll(htmlSrcsetPattern)) recordSrcset(match[1]);
    recordCss(value);
  };

  const recordDeep = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) recordDeep(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) recordDeep(item);
      return;
    }
    record(value);
  };

  if (!program) {
    const fallbackPatterns = [
      /(?:fetch|importScripts|load|loadAsync)\s*\(\s*["'`]([^"'`]+)/g,
      /new\s+(?:SharedWorker|Worker|Audio)\s*\(\s*["'`]([^"'`]+)/g,
      /(?:src|href|poster|data)\s*=\s*["'`]([^"'`]+)/g,
      /import\s*\(\s*["'`]([^"'`]+)/g,
    ];
    for (const pattern of fallbackPatterns) {
      for (const match of source.matchAll(pattern)) record(match[1]);
    }
    return { references: [...references], parseError: error };
  }

  const processFunction = (node, parentEnv) => {
    const env = new Environment(parentEnv);
    for (const parameter of node.params || []) {
      if (parameter.type === "AssignmentPattern" && parameter.left.type === "Identifier") {
        env.set(parameter.left.name, evaluate(parameter.right, parentEnv));
      }
    }
    if (node.body?.type === "BlockStatement") processStatements(node.body.body, env);
    else processExpression(node.body, env);
  };

  const processExpression = (node, env) => {
    if (!node) return;
    if (["ArrowFunctionExpression", "FunctionExpression"].includes(node.type)) {
      processFunction(node, env);
      return;
    }
    if (node.type === "AssignmentExpression") {
      const value = evaluate(node.right, env);
      const key = node.left.type === "Identifier" ? node.left.name : memberKey(node.left, env);
      if (node.operator === "=") env.set(key, value);
      const property = staticPropertyName(node.left, env);
      if (ATTRIBUTE_SINKS.has(property)) property === "srcset" ? recordSrcset(value) : record(value);
      if (property === "innerHTML" || property === "outerHTML") recordHtml(value);
      if (property === "cssText" || memberKey(node.left, env)?.includes(".style.")) recordCss(value);
      if (isAssetManifestTarget(key)) recordDeep(value);
      processExpression(node.left, env);
      processExpression(node.right, env);
      return;
    }
    if (node.type === "CallExpression") {
      const name = calleeName(node.callee, env);
      const shortName = name?.split(".").at(-1);
      if (shortName && FIRST_ARGUMENT_SINKS.has(shortName)) recordDeep(evaluate(node.arguments[0], env));
      if (shortName === "open") recordDeep(evaluate(node.arguments[1], env));
      if (shortName === "initClass") {
        for (const argument of node.arguments.slice(1)) recordDeep(evaluate(argument, env));
      }
      if (shortName === "setAttribute") {
        const attribute = evaluate(node.arguments[0], env);
        const value = evaluate(node.arguments[1], env);
        if (attribute === "srcset") recordSrcset(value);
        else if (ATTRIBUTE_SINKS.has(attribute)) record(value);
        else if (attribute === "style") recordCss(value);
      }
      if (["insertAdjacentHTML", "write", "writeln"].includes(shortName)) {
        recordHtml(evaluate(node.arguments.at(-1), env));
      }
      if (name && PATH_WRAPPERS.has(name)) recordDeep(evaluate(node.arguments[0], env));
      processExpression(node.callee, env);
      for (const argument of node.arguments || []) processExpression(argument, env);
      return;
    }
    if (node.type === "NewExpression") {
      const name = calleeName(node.callee, env)?.split(".").at(-1);
      if (ASSET_CONSTRUCTORS.has(name)) recordDeep(evaluate(node.arguments[0], env));
      processExpression(node.callee, env);
      for (const argument of node.arguments || []) processExpression(argument, env);
      return;
    }
    if (node.type === "ImportExpression") {
      recordDeep(evaluate(node.source, env));
      processExpression(node.source, env);
      return;
    }
    if (node.type === "ConditionalExpression") {
      processExpression(node.test, env);
      const test = evaluate(node.test, env);
      if (test === true) processExpression(node.consequent, env);
      else if (test === false) processExpression(node.alternate, env);
      else {
        processExpression(node.consequent, new Environment(env));
        processExpression(node.alternate, new Environment(env));
      }
      return;
    }
    if (node.type === "LogicalExpression") {
      processExpression(node.left, env);
      const left = evaluate(node.left, env);
      if (node.operator === "&&" && left === false) return;
      if (node.operator === "||" && left === true) return;
      processExpression(node.right, env);
      return;
    }
    if (node.type === "SequenceExpression") {
      for (const expression of node.expressions || []) processExpression(expression, env);
      return;
    }
    if (node.type === "ObjectExpression") {
      for (const property of node.properties || []) {
        if (property.type === "Property") processExpression(property.value, env);
        else if (property.type === "SpreadElement") processExpression(property.argument, env);
      }
      return;
    }
    if (node.type === "ArrayExpression") {
      for (const element of node.elements || []) processExpression(element, env);
      return;
    }
    if (node.type === "UnaryExpression" || node.type === "AwaitExpression" || node.type === "ChainExpression") {
      processExpression(node.argument ?? node.expression, env);
      return;
    }
    if (node.type === "BinaryExpression") {
      processExpression(node.left, env);
      processExpression(node.right, env);
      return;
    }
    if (node.type === "MemberExpression") {
      processExpression(node.object, env);
      if (node.computed) processExpression(node.property, env);
      return;
    }
    if (node.type === "TaggedTemplateExpression") {
      processExpression(node.tag, env);
      for (const expression of node.quasi.expressions || []) processExpression(expression, env);
    }
  };

  const processStatement = (statement, env) => {
    if (!statement) return;
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations || []) {
        const value = evaluate(declaration.init, env);
        if (declaration.id.type === "Identifier") env.set(declaration.id.name, value);
        processExpression(declaration.init, env);
      }
      return;
    }
    if (statement.type === "ExpressionStatement") return processExpression(statement.expression, env);
    if (statement.type === "FunctionDeclaration") return processFunction(statement, env);
    if (statement.type === "ClassDeclaration") {
      for (const definition of statement.body?.body || []) processExpression(definition.value, env);
      return;
    }
    if (statement.type === "ImportDeclaration" || statement.type === "ExportAllDeclaration" || statement.type === "ExportNamedDeclaration") {
      if (statement.source) recordDeep(statement.source.value);
      if (statement.declaration) processStatement(statement.declaration, env);
      return;
    }
    if (statement.type === "BlockStatement") return processStatements(statement.body, env);
    if (statement.type === "IfStatement") {
      processExpression(statement.test, env);
      const test = evaluate(statement.test, env);
      if (test === true) processStatement(statement.consequent, env);
      else if (test === false) processStatement(statement.alternate, env);
      else {
        processStatement(statement.consequent, new Environment(env));
        processStatement(statement.alternate, new Environment(env));
      }
      return;
    }
    if (statement.type === "TryStatement") {
      processStatement(statement.block, new Environment(env));
      if (statement.handler?.body) processStatement(statement.handler.body, new Environment(env));
      if (statement.finalizer) processStatement(statement.finalizer, new Environment(env));
      return;
    }
    if (["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"].includes(statement.type)) {
      if (statement.init?.type?.endsWith("Declaration")) processStatement(statement.init, env);
      else processExpression(statement.init, env);
      processExpression(statement.test, env);
      processExpression(statement.update, env);
      processExpression(statement.left, env);
      processExpression(statement.right, env);
      processStatement(statement.body, new Environment(env));
      return;
    }
    if (statement.type === "SwitchStatement") {
      processExpression(statement.discriminant, env);
      for (const branch of statement.cases || []) processStatements(branch.consequent, new Environment(env));
      return;
    }
    if (["ReturnStatement", "ThrowStatement"].includes(statement.type)) return processExpression(statement.argument, env);
    if (statement.type === "LabeledStatement" || statement.type === "WithStatement") return processStatement(statement.body, env);
  };

  function processStatements(statements, env) {
    for (const statement of statements || []) processStatement(statement, env);
  }

  processStatements(program.body, new Environment());
  return { references: [...references], parseError: null };
}
