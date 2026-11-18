"use strict";

// Read complete control sequences so escaped braces, percent signs, and
// doubled backslashes cannot turn into groups, comments, or commands.
function scanMath(text) {
  const tokens = /\\(?:[A-Za-z]+|[\s\S])|[{}%]/g;
  const openingBraces = [];
  const groups = new Map();
  const decorations = [];
  let match;
  while ((match = tokens.exec(text)) !== null) {
    const token = match[0];
    if (token === "{") {
      openingBraces.push(match.index);
    } else if (token === "}" && openingBraces.length) {
      groups.set(openingBraces.pop(), match.index);
    } else if (token === "%") {
      const newline = text.indexOf("\n", tokens.lastIndex);
      if (newline === -1) break;
      tokens.lastIndex = newline + 1;
    } else if (token === "\\boxed" || token === "\\tag") {
      decorations.push({ token, from: match.index, after: tokens.lastIndex });
    }
  }
  return { groups, decorations };
}

function isEscaped(text, position) {
  let slashes = 0;
  while (position > 0 && text[--position] === "\\") slashes++;
  return slashes % 2 === 1;
}

function inlineBounds(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1]) && !isEscaped(text, end - 1)) end--;
  return { start, end };
}

function cleanMath(body, inline) {
  const unchanged = { text: body, boxedCount: 0, tagCount: 0 };
  if (!body.includes("\\boxed") && !body.includes("\\tag")) return unchanged;

  const { groups, decorations } = scanMath(body);
  const boxedGroups = new Set();
  let boxedCount = 0;
  let tagCount = 0;
  let text = "";
  let copiedThrough = 0;
  const argument = /\s*(?:\*\s*)?/y;
  for (const { token, from, after } of decorations) {
    if (from < copiedThrough) continue; // Inside a removed tag argument.
    const isTag = token === "\\tag";
    argument.lastIndex = after;
    const prefix = argument.exec(body)[0];
    if (!isTag && prefix.includes("*")) continue;
    const open = argument.lastIndex;
    const close = groups.get(open);
    if (close === undefined) continue;

    let cutFrom = from;
    if (isTag && /^[ \t]*(?:\r?\n|$)/.test(body.slice(close + 1))) {
      while (cutFrom > copiedThrough && /[ \t]/.test(body[cutFrom - 1]) &&
          !isEscaped(body, cutFrom - 1)) cutFrom--;
    }
    text += body.slice(copiedThrough, cutFrom);
    if (isTag) {
      // Keep a TeX control word separate from text after the deleted tag.
      const word = /\\[A-Za-z]+$/.exec(text);
      if (word && !isEscaped(text, word.index)) text += " ";
      copiedThrough = close + 1;
      tagCount++;
    } else {
      // Keep embedded groups for scripts, macro arguments, and declarations.
      boxedGroups.add(text.length);
      copiedThrough = open;
      boxedCount++;
    }
  }
  if (!boxedCount && !tagCount) return unchanged;
  text += body.slice(copiedThrough);

  // A box around the entire formula needs no group outside its contents.
  const first = text.search(/\S/);
  const last = text.trimEnd().length - 1;
  if (boxedGroups.has(first) && scanMath(text).groups.get(first) === last) {
    const inner = text.slice(first + 1, last);
    const end = inlineBounds(inner, 0, inner.length).end;
    // An escaped trailing space cannot sit next to an inline dollar sign.
    if (!inline || end === 0 || !/\s/.test(inner[end - 1])) {
      text = text.slice(0, first) + inner + text.slice(last + 1);
    }
  }
  if (inline) {
    const { start, end } = inlineBounds(text, 0, text.length);
    text = text.slice(start, end);
    if (text && /\s/.test(text[text.length - 1])) text = "{" + text + "}";
  }
  // A tag-only formula should not turn into adjacent dollar delimiters.
  if (!text.trim()) text = inline ? "{}" : "{}" + text;
  return { text, boxedCount, tagCount };
}

module.exports = { cleanMath, inlineBounds, isEscaped };
