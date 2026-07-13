function codeMask(source) {
  const output = [...source];
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        output[index] = output[index + 1] = " ";
        index += 1;
        state = "line-comment";
      } else if (char === "/" && next === "*") {
        output[index] = output[index + 1] = " ";
        index += 1;
        state = "block-comment";
      } else if (char === "'" || char === '"' || char === "`") {
        output[index] = " ";
        state = char;
      }
      continue;
    }
    if (char !== "\n" && char !== "\r") output[index] = " ";
    if (state === "line-comment" && (char === "\n" || char === "\r")) state = "code";
    else if (state === "block-comment" && char === "*" && next === "/") {
      output[index + 1] = " ";
      index += 1;
      state = "code";
    } else if (["'", '"', "`"].includes(state)) {
      if (char === "\\") {
        if (source[index + 1] !== "\n" && source[index + 1] !== "\r") output[index + 1] = " ";
        index += 1;
      } else if (char === state) {
        state = "code";
      }
    }
  }
  return output.join("");
}

function tagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === ">") return index;
  }
  return source.length;
}

export function findJsxOpeningElements(source) {
  const mask = codeMask(source);
  const elements = [];
  for (const match of mask.matchAll(/<([a-z][a-z0-9-]*)\b/g)) {
    const end = tagEnd(source, match.index);
    elements.push({
      tag: match[1],
      attributes: source.slice(match.index + match[0].length, end),
      index: match.index,
    });
  }
  return elements;
}
