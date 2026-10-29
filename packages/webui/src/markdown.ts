import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateBlock, type StateInline } from "markdown-it";
import katex from "katex";

// Same setup as the VS Code chat (packages/vscode/media/chat/main.js):
// html: false is the XSS contract for every innerHTML sink in main.ts, and
// $...$ / $$...$$ are handed to KaTeX with the same options. Keep the two in step.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

installMath(md);

export function renderMarkdown(text: string): string {
  return md.render(text ?? "");
}

function installMath(markdown: MarkdownItInstance): void {
  markdown.inline.ruler.before("escape", "math_inline", mathInline);
  markdown.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  markdown.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
  markdown.renderer.rules.math_block = (tokens, idx) => renderMath(tokens[idx].content, true);
}

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24) return false;
  const start = state.pos + 1;
  const end = state.src.indexOf("$", start);
  if (end < 0 || end === start) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = state.src.slice(start, end);
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let position = state.bMarks[startLine] + state.tShift[startLine];
  let maximum = state.eMarks[startLine];
  if (state.src.slice(position, position + 2) !== "$$") return false;
  const firstLine = state.src.slice(position + 2, maximum);
  if (firstLine.trim().endsWith("$$")) {
    return pushMathBlock(state, startLine, startLine + 1, firstLine.trim().slice(0, -2), silent);
  }
  const lines = [firstLine];
  for (let nextLine = startLine + 1; nextLine < endLine; nextLine++) {
    position = state.bMarks[nextLine] + state.tShift[nextLine];
    maximum = state.eMarks[nextLine];
    const line = state.src.slice(position, maximum);
    if (line.trim() === "$$") {
      return pushMathBlock(state, startLine, nextLine + 1, lines.join("\n"), silent);
    }
    lines.push(line);
  }
  return false;
}

function pushMathBlock(
  state: StateBlock,
  startLine: number,
  nextLine: number,
  content: string,
  silent: boolean,
): boolean {
  if (!silent) {
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, nextLine];
  }
  state.line = nextLine;
  return true;
}

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false,
  });
}
