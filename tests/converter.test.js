"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { convertLatexDelimiters } = require("../src/converter");
const tick = String.fromCharCode(96);

function check(input, expected, inlineCount, displayCount) {
  const result = convertLatexDelimiters(input);
  assert.equal(result.text, expected);
  assert.equal(result.inlineCount, inlineCount);
  assert.equal(result.displayCount, displayCount);
  assert.equal(result.changes.length, 2 * (inlineCount + displayCount));
  let previousEnd = 0;
  let replay = "";
  for (const change of result.changes) {
    assert.ok(Number.isInteger(change.from));
    assert.ok(Number.isInteger(change.to));
    assert.ok(change.from >= previousEnd);
    assert.ok(change.to - change.from >= 2);
    replay += input.slice(previousEnd, change.from) + change.text;
    previousEnd = change.to;
  }
  replay += input.slice(previousEnd);
  assert.equal(replay, expected);
  return result;
}

test("converts both pairs and preserves internal spaces, Unicode and TeX commands", () => {
  check(
    String.raw`中文 😀 \( x  + \alpha \) and \[\frac{1}{2}\]`,
    String.raw`中文 😀 $x  + \alpha$ and $$\frac{1}{2}$$`,
    1, 1
  );
});

test("only trims inner-edge inline whitespace and skips empty inline math", () => {
  const result = check(
    String.raw`\(   x + y   \) \(\) \(   \)`,
    String.raw`$x + y$ \(\) \(   \)`,
    1, 0
  );
  assert.deepEqual(result.changes, [
    { from: 0, to: 5, text: "$" },
    { from: 10, to: 15, text: "$" }
  ]);
});

test("does not trim TeX's escaped trailing space into a dangling backslash", () => {
  check(String.raw`\(x\ \)`, String.raw`\(x\ \)`, 0, 0);
});

test("converts multiline display math with indented body and CRLF", () => {
  check(
    "\\[\r\n    x + y\r\n\r\n    = z\r\n\\]\r\n",
    "$$\r\n    x + y\r\n\r\n    = z\r\n$$\r\n",
    0, 1
  );
});

test("skips inline formulas with internal line breaks", () => {
  check("\\(x\ny\\)", "\\(x\ny\\)", 0, 0);
});

test("leaves orphan delimiters alone and converts a later valid pair", () => {
  check(
    String.raw`\) \] \(broken \(x\) \[unfinished`,
    String.raw`\) \] \(broken $x$ \[unfinished`,
    1, 0
  );
});

test("leaves crossed and mismatched delimiter sequences alone", () => {
  for (const input of [
    String.raw`\(a \[b\) c\]`,
    String.raw`\[a \(b\] c\)`,
    String.raw`\(a \] b\)`,
    String.raw`\[a \) b\]`
  ]) check(input, input, 0, 0);
});

test("leaves escaped delimiters alone, including the double-backslash case", () => {
  check(
    String.raw`\\(literal\\) \\[literal\\] \(x\\)y\)`,
    String.raw`\\(literal\\) \\[literal\\] $x\\)y$`,
    1, 0
  );
});

test("preserves YAML frontmatter and converts text after it", () => {
  const yaml = "---\nlabel: '\\(sample\\)'\nother: '\\[sample\\]'\n---\n";
  check(yaml + String.raw`\(x\)`, yaml + "$x$", 1, 0);
  const bom = "\ufeff---\r\nlabel: '\\(sample\\)'\r\n...\r\n";
  check(bom + String.raw`\[x\]`, bom + "$$x$$", 0, 1);
  check("---\nlabel: '\\(sample\\)'", "---\nlabel: '\\(sample\\)'", 0, 0);
});

test("preserves fenced code including list, quote and longer fences", () => {
  const fenced = [
    tick.repeat(4) + "md\n\\(code\\)\n" + tick.repeat(3) + "\n\\[code\\]\n" + tick.repeat(4) + "\n",
    "> " + tick.repeat(3) + "\n> \\(code\\)\n> " + tick.repeat(3) + "\n",
    "- ~~~md\n  \\[code\\]\n  ~~~\n"
  ].join("");
  check(fenced + String.raw`\(text\)`, fenced + "$text$", 1, 0);
});

test("preserves unclosed fences and indented code", () => {
  const indent = "    \\(code\\)\n\t\\[code\\]\n>     \\(quoted\\)\n";
  check(indent + String.raw`\(text\)`, indent + "$text$", 1, 0);
  const unclosed = tick.repeat(3) + "\n\\(code\\)";
  check(unclosed, unclosed, 0, 0);
});

test("preserves inline code, including code containing shorter backtick runs", () => {
  const code = tick.repeat(2) + " \\(code\\) " + tick + " \\[code\\] " + tick.repeat(2);
  check(code + String.raw` \(x\)`, code + " $x$", 1, 0);
  const unclosed = tick + String.raw` unmatched \(x\)`;
  check(unclosed, tick + " unmatched $x$", 1, 0);
});

test("backticks inside LaTeX formulas do not become inline code", () => {
  check("\\(a" + tick + "b\\)", "$a" + tick + "b$", 1, 0);
  check("\\[a" + tick + "b\nc\\]", "$$a" + tick + "b\nc$$", 0, 1);
});

test("preserves HTML comments, including fences within comments", () => {
  const comment = "<!--\n" + tick.repeat(3) + "\n\\(comment\\)\n-->\n";
  check(comment + String.raw`\(x\)`, comment + "$x$", 1, 0);
  check(String.raw`<!-- \(comment\)`, String.raw`<!-- \(comment\)`, 0, 0);
});

test("does not pair an orphan opening delimiter with a closer inside a comment", () => {
  check(
    String.raw`\(orphan <!-- \) --> \(x\)`,
    String.raw`\(orphan <!-- \) --> $x$`,
    1, 0
  );
});

test("an HTML comment opener inside inline code does not hide following text", () => {
  const code = tick + "<!-- \\(code\\)" + tick;
  check(code + String.raw` \(x\)`, code + " $x$", 1, 0);
});

test("preserves existing dollar math while handling currency sensibly", () => {
  const math = String.raw`$a+\(b\)$ $$x+\[y\]$$ `;
  check(math + String.raw`\(z\)`, math + "$z$", 1, 0);
  check(
    String.raw`Cost $5 and $10, formula \(x\).`,
    "Cost $5 and $10, formula $x$.",
    1, 0
  );
  check(String.raw`$\$5+\(x\)$`, String.raw`$\$5+\(x\)$`, 0, 0);
  check(String.raw`\(orphan $a\)b$ \(x\)`, String.raw`\(orphan $a\)b$ $x$`, 1, 0);
  check(String.raw`\(cost = \$5\)`, String.raw`$cost = \$5$`, 1, 0);
});

test("does not pair formulas across fenced code or separate inline paragraphs", () => {
  const input = "\\(orphan\n" + tick.repeat(3) + "\n\\)\n" + tick.repeat(3) + "\n\\(x\\)";
  check(input, "\\(orphan\n" + tick.repeat(3) + "\n\\)\n" + tick.repeat(3) + "\n$x$", 1, 0);
  check("\\(orphan\n\ntext\\)", "\\(orphan\n\ntext\\)", 0, 0);
});

test("the converter is idempotent for normal converted formulas", () => {
  const first = convertLatexDelimiters(String.raw`\(x\) and \[y\]`);
  check(first.text, first.text, 0, 0);
});

test("returns no changes for empty input and rejects nonstrings", () => {
  check("", "", 0, 0);
  assert.throws(() => convertLatexDelimiters(null), TypeError);
});
