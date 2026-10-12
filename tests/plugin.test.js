const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pluginSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeEditor(initialText) {
  let value = initialText;
  const history = [];
  const editor = {
    transactions: [],
    reads: 0,
    setValueCalls: 0,
    getValue() {
      this.reads += 1;
      return value;
    },
    offsetToPos(offset) {
      const lines = value.slice(0, offset).split("\n");
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    transaction(transaction, origin) {
      const before = value;
      const offset = (position) => {
        const lines = before.split("\n");
        return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
      };
      const changes = Array.from(transaction.changes, (change) => ({
        from: offset(change.from), to: offset(change.to), text: change.text,
      })).sort((a, b) => b.from - a.from);
      for (const change of changes) {
        value = value.slice(0, change.from) + change.text + value.slice(change.to);
      }
      history.push(before);
      this.transactions.push({ transaction, origin });
    },
    setValue() {
      this.setValueCalls += 1;
      throw new Error("Replacing the complete editor value would lose the intended undo behavior.");
    },
    undo() {
      if (history.length) value = history.pop();
    },
    text() { return value; },
  };
  return editor;
}

function loadPlugin(options = {}) {
  const notices = [];
  const errors = [];
  const vaultCalls = [];
  const editor = options.editor || makeEditor(options.text ?? String.raw`\(x\)`);
  const state = { file: "current.md", mode: options.mode || "source", extra: "preserve-this" };
  const view = {
    file: { path: "current.md" },
    editor,
    stateCalls: [],
    getMode() { return state.mode; },
    getState() { return { ...state }; },
    async setState(nextState, navigation) {
      this.stateCalls.push({ nextState, navigation });
      if (options.setState) await options.setState(nextState, navigation);
      Object.assign(state, nextState);
    },
  };
  const context = { active: options.noActiveView ? null : view };
  class MarkdownView {}
  class Plugin {
    constructor(app) {
      this.app = app;
      this.ribbonIcons = [];
      this.commands = [];
    }
    addRibbonIcon(icon, title, callback) { this.ribbonIcons.push({ icon, title, callback }); }
    addCommand(command) { this.commands.push(command); }
  }
  class Notice {
    constructor(message) { notices.push(message); }
  }
  const app = {
    workspace: {
      getActiveViewOfType(type) {
        assert.equal(type, MarkdownView);
        return context.active;
      },
    },
    vault: Object.fromEntries(["modify", "process", "create", "delete", "rename"].map((name) => [name, () => {
      vaultCalls.push(name);
      throw new Error(`Unexpected vault mutation: ${name}`);
    }])),
  };
  const sandbox = {
    module: { exports: {} },
    console: { error: (...args) => errors.push(args) },
    require(moduleName) {
      if (moduleName === "obsidian") return { Plugin, MarkdownView, Notice };
      if (moduleName === "./converter") {
        return options.converter ? { convertLatexDelimiters: options.converter } : require("../src/converter");
      }
      throw new Error(`Unexpected dependency: ${moduleName}`);
    },
  };
  vm.runInNewContext(pluginSource, sandbox, { filename: "src/main.js" });
  const plugin = new sandbox.module.exports(app);
  plugin.onload();
  return { plugin, editor, view, context, notices, errors, vaultCalls };
}

test("registers a ribbon action and a command available only for a Markdown note", () => {
  const { plugin, context, view } = loadPlugin();
  assert.equal(plugin.ribbonIcons.length, 1);
  assert.equal(plugin.ribbonIcons[0].icon, "sigma");
  assert.match(plugin.ribbonIcons[0].title, /当前笔记/);
  assert.equal(plugin.commands.length, 1);
  const command = plugin.commands[0];
  assert.equal(command.id, "convert-current-note");
  let conversions = 0;
  plugin.convertActiveNote = async () => { conversions += 1; };
  assert.equal(command.checkCallback(true), true);
  assert.equal(conversions, 0);
  assert.equal(command.checkCallback(false), true);
  plugin.ribbonIcons[0].callback();
  assert.equal(conversions, 2);
  context.active = null;
  assert.equal(command.checkCallback(true), false);
  context.active = view;
  view.file = null;
  assert.equal(command.checkCallback(false), false);
  assert.equal(conversions, 2);
});

test("converts the current note in one transaction and one undo restores it", async () => {
  const original = String.raw`正文 \(a+b\)` + "\r\n\r\n" + String.raw`\[` + "\r\nc\r\n" + String.raw`\]`;
  const expected = "正文 $a+b$\r\n\r\n$$\r\nc\r\n$$";
  const { plugin, editor, view, notices, vaultCalls } = loadPlugin({ text: original });
  const otherNote = makeEditor(String.raw`\(leave-me\)`);
  await plugin.convertActiveNote();
  assert.equal(editor.text(), expected);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.setValueCalls, 0);
  assert.equal(view.stateCalls.length, 0);
  assert.deepEqual(vaultCalls, []);
  assert.equal(otherNote.text(), String.raw`\(leave-me\)`);
  assert.equal(otherNote.transactions.length, 0);
  assert.match(notices[0], /1 个行内公式.*1 个块公式/);
  editor.undo();
  assert.equal(editor.text(), original);
  assert.equal(plugin.converting, false);
});

test("a second click is idempotent and creates no additional undo entry", async () => {
  const { plugin, editor, notices } = loadPlugin();
  await plugin.convertActiveNote();
  await plugin.convertActiveNote();
  assert.equal(editor.text(), "$x$");
  assert.equal(editor.transactions.length, 1);
  assert.match(notices[1], /没有找到/);
  assert.equal(plugin.converting, false);
});

test("no matches do not mutate the editor or create an undo entry", async () => {
  const original = "Plain text, existing $x$ math and an unmatched \\( opener.";
  const { plugin, editor, notices, vaultCalls } = loadPlugin({ text: original });
  await plugin.convertActiveNote();
  assert.equal(editor.text(), original);
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.setValueCalls, 0);
  assert.deepEqual(vaultCalls, []);
  assert.match(notices[0], /没有找到/);
  assert.equal(plugin.converting, false);
});

test("missing Markdown view or file gives a notice without accessing an editor", async (t) => {
  for (const noFile of [false, true]) {
    await t.test(noFile ? "view without file" : "no view", async () => {
      const { plugin, view, editor, notices } = loadPlugin({ noActiveView: !noFile });
      if (noFile) view.file = null;
      await plugin.convertActiveNote();
      assert.equal(editor.reads, 0);
      assert.equal(editor.transactions.length, 0);
      assert.match(notices[0], /请先打开/);
      assert.equal(plugin.converting, false);
    });
  }
});

test("reading mode awaits source mode and preserves the rest of the view state", async () => {
  const transition = deferred();
  const { plugin, view, editor } = loadPlugin({ mode: "preview", setState: () => transition.promise });
  const running = plugin.convertActiveNote();
  assert.equal(view.stateCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(view.stateCalls[0])), {
    nextState: { file: "current.md", mode: "source", extra: "preserve-this" },
    navigation: { history: false },
  });
  assert.equal(editor.reads, 0);
  assert.equal(editor.transactions.length, 0);
  transition.resolve();
  await running;
  assert.equal(view.getMode(), "source");
  assert.equal(editor.text(), "$x$");
  assert.equal(editor.transactions.length, 1);
});

test("a file change during source-mode transition prevents any editor mutation", async () => {
  const transition = deferred();
  const { plugin, view, editor, notices } = loadPlugin({ mode: "preview", setState: () => transition.promise });
  const running = plugin.convertActiveNote();
  view.file = { path: "different.md" };
  transition.resolve();
  await running;
  assert.equal(editor.reads, 0);
  assert.equal(editor.transactions.length, 0);
  assert.match(notices[0], /当前笔记已切换/);
  assert.equal(plugin.converting, false);
});

test("an active-view change during source-mode transition prevents any editor mutation", async () => {
  const transition = deferred();
  const { plugin, context, editor, notices } = loadPlugin({ mode: "preview", setState: () => transition.promise });
  const running = plugin.convertActiveNote();
  const replacementEditor = makeEditor(String.raw`\(other\)`);
  context.active = { file: { path: "other.md" }, editor: replacementEditor };
  transition.resolve();
  await running;
  assert.equal(editor.reads, 0);
  assert.equal(editor.transactions.length, 0);
  assert.equal(replacementEditor.text(), String.raw`\(other\)`);
  assert.equal(replacementEditor.transactions.length, 0);
  assert.match(notices[0], /当前笔记已切换/);
  assert.equal(plugin.converting, false);
});

test("repeated clicks while awaiting source mode perform one conversion", async () => {
  const transition = deferred();
  const { plugin, view, editor, notices } = loadPlugin({ mode: "preview", setState: () => transition.promise });
  const first = plugin.convertActiveNote();
  await plugin.convertActiveNote();
  assert.equal(view.stateCalls.length, 1);
  assert.equal(editor.transactions.length, 0);
  transition.resolve();
  await first;
  assert.equal(editor.transactions.length, 1);
  assert.equal(notices.length, 1);
  assert.equal(plugin.converting, false);
});

test("source-mode transition errors are reported and release the conversion lock", async () => {
  let attempts = 0;
  const { plugin, editor, notices, errors } = loadPlugin({
    mode: "preview",
    setState: async () => {
      if (attempts++ === 0) throw new Error("Cannot switch mode");
    },
  });
  await plugin.convertActiveNote();
  assert.equal(plugin.converting, false);
  assert.equal(editor.transactions.length, 0);
  assert.equal(errors.length, 1);
  assert.match(notices[0], /转换失败/);
  await plugin.convertActiveNote();
  assert.equal(editor.text(), "$x$");
  assert.equal(editor.transactions.length, 1);
  assert.equal(plugin.converting, false);
});

test("converter errors are reported and a later click can succeed", async () => {
  let attempts = 0;
  const { plugin, editor, notices, errors } = loadPlugin({
    converter: (value) => {
      if (attempts++ === 0) throw new Error("Converter failure");
      return require("../src/converter").convertLatexDelimiters(value);
    },
  });
  await plugin.convertActiveNote();
  assert.equal(plugin.converting, false);
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.text(), String.raw`\(x\)`);
  assert.equal(errors.length, 1);
  assert.match(notices[0], /转换失败/);
  await plugin.convertActiveNote();
  assert.equal(editor.text(), "$x$");
  assert.equal(editor.transactions.length, 1);
});

test("editor transaction errors release the lock without using a vault-write fallback", async () => {
  const editor = makeEditor(String.raw`\(x\)`);
  const normalTransaction = editor.transaction;
  editor.transaction = () => { throw new Error("Read-only editor"); };
  const { plugin, notices, errors, vaultCalls } = loadPlugin({ editor });
  await plugin.convertActiveNote();
  assert.equal(plugin.converting, false);
  assert.equal(editor.text(), String.raw`\(x\)`);
  assert.equal(editor.transactions.length, 0);
  assert.equal(editor.setValueCalls, 0);
  assert.deepEqual(vaultCalls, []);
  assert.equal(errors.length, 1);
  assert.match(notices[0], /转换失败/);
  editor.transaction = normalTransaction;
  await plugin.convertActiveNote();
  assert.equal(editor.text(), "$x$");
  assert.equal(editor.transactions.length, 1);
});
