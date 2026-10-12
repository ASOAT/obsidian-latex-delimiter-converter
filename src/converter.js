"use strict";

const BACKTICK = String.fromCharCode(96);

function isEscaped(text, position) {
  let slashes = 0;
  for (let i = position - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function lineEnd(text, start) {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

function nextLine(text, start) {
  const end = lineEnd(text, start);
  return end < text.length ? end + 1 : end;
}

function stripQuotePrefix(line) {
  return line.replace(/^(?:[ \t]*>[ \t]?)+/, "");
}

function fenceInfo(line) {
  // Also recognize fences inside a block quote or after a list marker.
  const match = stripQuotePrefix(line).match(
    /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(\x60{3,}|~{3,})([^\r\n]*)\r?$/
  );
  if (!match) return null;
  const marker = match[1];
  const suffix = match[2];
  if (marker[0] === BACKTICK && suffix.includes(BACKTICK)) return null;
  return { character: marker[0], length: marker.length, suffix };
}

function skipFence(text, start, fence) {
  let position = nextLine(text, start);
  while (position < text.length) {
    const candidate = fenceInfo(text.slice(position, lineEnd(text, position)));
    const after = nextLine(text, position);
    if (
      candidate &&
      candidate.character === fence.character &&
      candidate.length >= fence.length &&
      candidate.suffix.trim() === ""
    ) return after;
    position = after;
  }
  return text.length;
}

function frontmatterEnd(text) {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!/^---[ \t]*\r?$/.test(text.slice(start, lineEnd(text, start)))) return start;
  let position = nextLine(text, start);
  while (position < text.length) {
    const line = text.slice(position, lineEnd(text, position));
    if (/^(?:---|\.\.\.)[ \t]*\r?$/.test(line)) return nextLine(text, position);
    position = nextLine(text, position);
  }
  return text.length;
}

function codeSpanEnd(text, start) {
  let length = 1;
  while (text[start + length] === BACKTICK) length++;
  let position = start + length;
  while (position < text.length) {
    if (text[position] === "\n") {
      const after = position + 1;
      const line = text.slice(after, lineEnd(text, after));
      if (line.trim() === "" || fenceInfo(line)) return null;
    }
    if (text[position] !== BACKTICK) {
      position++;
      continue;
    }
    let run = 1;
    while (text[position + run] === BACKTICK) run++;
    if (run === length) return position + run;
    position += run;
  }
  return null;
}

function dollarMathEnd(text, start) {
  const display = text[start + 1] === "$";
  const length = display ? 2 : 1;
  if (text[start + length] === "$") return null;
  if (!display && (text[start + 1] === undefined || /\s/.test(text[start + 1]))) return null;
  let position = start + length;
  while (position < text.length) {
    if (text[position] === "\n") {
      const after = position + 1;
      const line = text.slice(after, lineEnd(text, after));
      if ((!display && line.trim() === "") || fenceInfo(line)) return null;
    }
    if (text[position] !== "$" || isEscaped(text, position)) {
      position++;
      continue;
    }
    let run = 1;
    while (text[position + run] === "$") run++;
    if (run === length) {
      if (
        display ||
        (!/\s/.test(text[position - 1]) && !/\d/.test(text[position + 1] || ""))
      ) return position + length;
    }
    position += run;
  }
  return null;
}

function latexMathEnd(text, start, opening, closing) {
  let position = start + 2;
  while (position < text.length - 1) {
    if (text.startsWith("<!--", position)) return null;
    if (text[position] === "$" && !isEscaped(text, position)) return null;
    if (text[position] === "\n") {
      const after = position + 1;
      const line = text.slice(after, lineEnd(text, after));
      if (fenceInfo(line) || (opening === "(" && line.trim() === "")) return null;
    }
    if (text[position] === "\\" && !isEscaped(text, position)) {
      if (text[position + 1] === closing) return position;
      // A later opener should still be able to form its own valid pair.
      if (text[position + 1] === opening) return null;
      // Mixed/nested delimiters are not a supported single formula.
      if ("()[]".includes(text[position + 1])) return null;
    }
    position++;
  }
  return null;
}

/**
 * Convert paired LaTeX math delimiters. Display bodies remain byte-for-byte
 * unchanged; inline bodies have only their inner-edge whitespace removed.
 * Offsets in changes use JavaScript/Obsidian UTF-16 string positions.
 */
function convertLatexDelimiters(input) {
  if (typeof input !== "string") throw new TypeError("Expected a Markdown string");
  const changes = [];
  let inlineCount = 0;
  let displayCount = 0;
  let position = frontmatterEnd(input);

  while (position < input.length) {
    if (position === 0 || input[position - 1] === "\n") {
      const line = input.slice(position, lineEnd(input, position));
      const fence = fenceInfo(line);
      if (fence) {
        position = skipFence(input, position, fence);
        continue;
      }
      // Conservatively preserve indented code, including quoted code.
      if (/^(?: {4}|\t)/.test(stripQuotePrefix(line))) {
        position = nextLine(input, position);
        continue;
      }
    }

    if (input.startsWith("<!--", position)) {
      const end = input.indexOf("-->", position + 4);
      position = end === -1 ? input.length : end + 3;
      continue;
    }

    if (input[position] === "\\" && !isEscaped(input, position)) {
      const opening = input[position + 1];
      if (opening === "(" || opening === "[") {
        const closing = opening === "(" ? ")" : "]";
        const end = latexMathEnd(input, position, opening, closing);
        if (end !== null) {
          let bodyStart = position + 2;
          let bodyEnd = end;
          if (opening === "(") {
            while (bodyStart < bodyEnd && /\s/.test(input[bodyStart])) bodyStart++;
            while (
              bodyEnd > bodyStart &&
              /\s/.test(input[bodyEnd - 1]) &&
              !isEscaped(input, bodyEnd - 1)
            ) bodyEnd--;
          }
          const validInline = opening !== "(" ||
            (bodyStart < bodyEnd &&
              !/\s/.test(input[bodyEnd - 1]) &&
              !/[\r\n]/.test(input.slice(bodyStart, bodyEnd)));
          if (validInline) {
            const replacement = opening === "(" ? "$" : "$$";
            changes.push({ from: position, to: bodyStart, text: replacement });
            changes.push({ from: bodyEnd, to: end + 2, text: replacement });
            if (opening === "(") inlineCount++;
            else displayCount++;
          }
          position = end + 2;
          continue;
        }
      }
    }

    if (input[position] === BACKTICK && !isEscaped(input, position)) {
      const end = codeSpanEnd(input, position);
      if (end !== null) {
        position = end;
        continue;
      }
      while (input[position] === BACKTICK) position++;
      continue;
    }

    if (input[position] === "$" && !isEscaped(input, position)) {
      const end = dollarMathEnd(input, position);
      if (end !== null) {
        position = end;
        continue;
      }
      // Examine a rejected dollar run once.
      while (input[position] === "$") position++;
      continue;
    }
    position++;
  }

  let text = "";
  let copiedThrough = 0;
  for (const change of changes) {
    text += input.slice(copiedThrough, change.from) + change.text;
    copiedThrough = change.to;
  }
  text += input.slice(copiedThrough);
  return { text, changes, inlineCount, displayCount };
}

module.exports = { convertLatexDelimiters };
