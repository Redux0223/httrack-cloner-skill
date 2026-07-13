import { parse as parseJavaScript } from "acorn";
import { parse as parseHtml } from "parse5";

function memberKey(node) {
  if (!node || node.type !== "MemberExpression" || node.computed) return null;
  const property = node.property?.name;
  if (!property) return null;
  if (node.object?.type === "Identifier") return `${node.object.name}.${property}`;
  const parent = memberKey(node.object);
  return parent ? `${parent}.${property}` : null;
}

function evaluate(node, values) {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") return values.get(node.name);
  if (node.type === "MemberExpression") return values.get(memberKey(node));
  if (node.type === "TemplateLiteral") {
    let output = "";
    for (let index = 0; index < node.quasis.length; index += 1) {
      output += node.quasis[index].value.cooked ?? node.quasis[index].value.raw;
      if (index < node.expressions.length) {
        const value = evaluate(node.expressions[index], values);
        if (value === undefined) return undefined;
        output += String(value);
      }
    }
    return output;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = evaluate(node.left, values);
    const right = evaluate(node.right, values);
    if (left === undefined || right === undefined) return undefined;
    return typeof left === "string" || typeof right === "string" ? `${left}${right}` : Number(left) + Number(right);
  }
  if (node.type === "LogicalExpression") {
    const left = evaluate(node.left, values);
    if (node.operator === "&&") return left ? evaluate(node.right, values) : left;
    if (node.operator === "||") return left || evaluate(node.right, values);
    if (node.operator === "??") return left ?? evaluate(node.right, values);
  }
  if (node.type === "ConditionalExpression") {
    const test = evaluate(node.test, values);
    if (typeof test === "boolean") return evaluate(test ? node.consequent : node.alternate, values);
  }
  return undefined;
}

function executableScripts(html) {
  const document = parseHtml(html);
  const scripts = [];
  const visit = (node) => {
    if (node.tagName === "script") {
      const type = (node.attrs || []).find((attribute) => attribute.name === "type")?.value || "";
      if (!type || /^(?:text|application)\/javascript$/i.test(type) || type === "module") {
        scripts.push((node.childNodes || []).filter((child) => child.nodeName === "#text").map((child) => child.value).join(""));
      }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(document);
  return scripts;
}

function parseProgram(source) {
  for (const sourceType of ["script", "module"]) {
    try {
      return parseJavaScript(source, { ecmaVersion: "latest", sourceType, allowReturnOutsideFunction: true });
    } catch {}
  }
  return null;
}

export function discoverConstructedAssetReferences(text, { html = false } = {}) {
  const references = new Set();
  const record = (value) => {
    if (typeof value === "string" && /(?:^|[/.])[A-Za-z0-9_@.%+() -]+\.[a-z0-9]{2,8}(?:[?#].*)?$/i.test(value)) {
      references.add(value);
    }
  };

  const processSource = (source) => {
    const program = parseProgram(source);
    if (!program) return;
    const values = new Map();

    const processExpression = (node) => {
      if (!node) return;
      if (node.type === "AssignmentExpression" && node.operator === "=") {
        const value = evaluate(node.right, values);
        const key = node.left.type === "Identifier" ? node.left.name : memberKey(node.left);
        if (key && value !== undefined) values.set(key, value);
        record(value);
        processExpression(node.right);
        return;
      }
      if (node.type === "CallExpression") {
        if (["FunctionExpression", "ArrowFunctionExpression"].includes(node.callee?.type)) {
          const body = node.callee.body;
          if (body?.type === "BlockStatement") processStatements(body.body);
          else processExpression(body);
        }
        for (const argument of node.arguments || []) processExpression(argument);
        return;
      }
      if (node.type === "SequenceExpression") {
        for (const expression of node.expressions) processExpression(expression);
      }
    };

    const processStatements = (statements) => {
      for (const statement of statements || []) {
        if (statement.type === "VariableDeclaration") {
          for (const declaration of statement.declarations) {
            const value = evaluate(declaration.init, values);
            if (declaration.id.type === "Identifier" && value !== undefined) values.set(declaration.id.name, value);
            record(value);
            processExpression(declaration.init);
          }
        } else if (statement.type === "ExpressionStatement") {
          processExpression(statement.expression);
        } else if (statement.type === "BlockStatement") {
          processStatements(statement.body);
        } else if (statement.type === "TryStatement") {
          processStatements(statement.block?.body);
          processStatements(statement.finalizer?.body);
        } else if (statement.type === "IfStatement") {
          const test = evaluate(statement.test, values);
          if (test === true) processStatements(statement.consequent?.type === "BlockStatement" ? statement.consequent.body : [statement.consequent]);
          else if (test === false && statement.alternate) processStatements(statement.alternate.type === "BlockStatement" ? statement.alternate.body : [statement.alternate]);
        }
      }
    };

    processStatements(program.body);
  };

  for (const source of html ? executableScripts(text) : [text]) processSource(source);
  return [...references];
}
