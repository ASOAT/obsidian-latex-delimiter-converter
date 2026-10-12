/* LaTeX Delimiter Converter v1.0.0 | MIT License | Built from src/ */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/converter.js
var require_converter = __commonJS({
  "src/converter.js"(exports2, module2) {
    "use strict";
    var BACKTICK = String.fromCharCode(96);
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
        if (candidate && candidate.character === fence.character && candidate.length >= fence.length && candidate.suffix.trim() === "") return after;
        position = after;
      }
      return text.length;
    }
    function frontmatterEnd(text) {
      const start = text.charCodeAt(0) === 65279 ? 1 : 0;
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
      if (!display && (text[start + 1] === void 0 || /\s/.test(text[start + 1]))) return null;
      let position = start + length;
      while (position < text.length) {
        if (text[position] === "\n") {
          const after = position + 1;
          const line = text.slice(after, lineEnd(text, after));
          if (!display && line.trim() === "" || fenceInfo(line)) return null;
        }
        if (text[position] !== "$" || isEscaped(text, position)) {
          position++;
          continue;
        }
        let run = 1;
        while (text[position + run] === "$") run++;
        if (run === length) {
          if (display || !/\s/.test(text[position - 1]) && !/\d/.test(text[position + 1] || "")) return position + length;
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
          if (fenceInfo(line) || opening === "(" && line.trim() === "") return null;
        }
        if (text[position] === "\\" && !isEscaped(text, position)) {
          if (text[position + 1] === closing) return position;
          if (text[position + 1] === opening) return null;
          if ("()[]".includes(text[position + 1])) return null;
        }
        position++;
      }
      return null;
    }
    function convertLatexDelimiters2(input) {
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
                while (bodyEnd > bodyStart && /\s/.test(input[bodyEnd - 1]) && !isEscaped(input, bodyEnd - 1)) bodyEnd--;
              }
              const validInline = opening !== "(" || bodyStart < bodyEnd && !/\s/.test(input[bodyEnd - 1]) && !/[\r\n]/.test(input.slice(bodyStart, bodyEnd));
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
    module2.exports = { convertLatexDelimiters: convertLatexDelimiters2 };
  }
});

// src/main.js
var { Plugin, MarkdownView, Notice } = require("obsidian");
var { convertLatexDelimiters } = require_converter();
module.exports = class LatexDelimiterConverter extends Plugin {
  onload() {
    this.converting = false;
    this.addRibbonIcon("sigma", "\u8F6C\u6362\u5F53\u524D\u7B14\u8BB0\u7684\u516C\u5F0F\u5206\u9694\u7B26", () => {
      void this.convertActiveNote();
    });
    this.addCommand({
      id: "convert-current-note",
      name: "\u8F6C\u6362\u5F53\u524D\u7B14\u8BB0\u7684\u516C\u5F0F\u5206\u9694\u7B26",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (!checking) void this.convertActiveNote();
        return true;
      }
    });
  }
  async convertActiveNote() {
    if (this.converting) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7 Markdown \u7B14\u8BB0\u3002");
      return;
    }
    this.converting = true;
    const file = view.file;
    try {
      if (view.getMode() !== "source") {
        await view.setState({ ...view.getState(), mode: "source" }, { history: false });
      }
      if (view.file !== file || this.app.workspace.getActiveViewOfType(MarkdownView) !== view) {
        new Notice("\u5F53\u524D\u7B14\u8BB0\u5DF2\u5207\u6362\uFF0C\u8BF7\u5728\u76EE\u6807\u7B14\u8BB0\u4E2D\u91CD\u65B0\u70B9\u51FB\u8F6C\u6362\u3002");
        return;
      }
      const editor = view.editor;
      const result = convertLatexDelimiters(editor.getValue());
      if (result.changes.length === 0) {
        new Notice("\u6CA1\u6709\u627E\u5230\u9700\u8981\u8F6C\u6362\u7684\u6210\u5BF9\u516C\u5F0F\u5206\u9694\u7B26\u3002");
        return;
      }
      editor.transaction({
        changes: result.changes.map((change) => ({
          from: editor.offsetToPos(change.from),
          to: editor.offsetToPos(change.to),
          text: change.text
        }))
      }, "latex-delimiter-converter");
      new Notice(`\u5DF2\u8F6C\u6362 ${result.inlineCount} \u4E2A\u884C\u5185\u516C\u5F0F\u3001${result.displayCount} \u4E2A\u5757\u516C\u5F0F\u3002\u53EF\u64A4\u9500\u6062\u590D\u3002`);
    } catch (error) {
      console.error("LaTeX Delimiter Converter: conversion failed", error);
      new Notice("\u516C\u5F0F\u8F6C\u6362\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u7B14\u8BB0\u662F\u5426\u53EF\u4EE5\u7F16\u8F91\u3002");
    } finally {
      this.converting = false;
    }
  }
};
