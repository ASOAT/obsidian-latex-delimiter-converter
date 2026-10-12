const { Plugin, MarkdownView, Notice } = require("obsidian");
const { convertLatexDelimiters } = require("./converter");

module.exports = class LatexDelimiterConverter extends Plugin {
  onload() {
    this.converting = false;
    this.addRibbonIcon("sigma", "转换当前笔记的公式分隔符", () => {
      void this.convertActiveNote();
    });
    this.addCommand({
      id: "convert-current-note",
      name: "转换当前笔记的公式分隔符",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (!checking) void this.convertActiveNote();
        return true;
      },
    });
  }

  async convertActiveNote() {
    if (this.converting) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("请先打开一篇 Markdown 笔记。");
      return;
    }

    this.converting = true;
    const file = view.file;
    try {
      // Use the editor even from reading mode so changes stay in its undo history.
      if (view.getMode() !== "source") {
        await view.setState({ ...view.getState(), mode: "source" }, { history: false });
      }
      if (view.file !== file ||
          this.app.workspace.getActiveViewOfType(MarkdownView) !== view) {
        new Notice("当前笔记已切换，请在目标笔记中重新点击转换。");
        return;
      }

      const editor = view.editor;
      const result = convertLatexDelimiters(editor.getValue());
      if (result.changes.length === 0) {
        new Notice("没有找到需要转换的成对公式分隔符。");
        return;
      }

      // One transaction, using original-document coordinates. Obsidian maps the
      // cursor and selections and records the complete conversion for Undo.
      editor.transaction({
        changes: result.changes.map((change) => ({
          from: editor.offsetToPos(change.from),
          to: editor.offsetToPos(change.to),
          text: change.text,
        })),
      }, "latex-delimiter-converter");
      new Notice(`已转换 ${result.inlineCount} 个行内公式、${result.displayCount} 个块公式。可撤销恢复。`);
    } catch (error) {
      console.error("LaTeX Delimiter Converter: conversion failed", error);
      new Notice("公式转换失败，请检查当前笔记是否可以编辑。");
    } finally {
      this.converting = false;
    }
  }
};
