const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { buildPromptContext, collectEditorContext } = require("../dist/context.js");

test("buildPromptContext includes active file, cursor, selection, and open file text", () => {
  const context = buildPromptContext([
    {
      fileName: "/tmp/example.ts",
      languageId: "typescript",
      text: "const value = 1;\nconsole.log(value);\n",
      isActive: true,
      cursorLine: 2,
      cursorCharacter: 8,
      selection: "value",
    },
  ], { maxOpenFileChars: 1000 });

  assert.match(context, /File: \/tmp\/example\.ts/);
  assert.match(context, /State: active/);
  assert.match(context, /Cursor: line 2, column 8/);
  assert.match(context, /Selected code:/);
  assert.match(context, /const value = 1;/);
});

test("buildPromptContext truncates long file content", () => {
  const context = buildPromptContext([
    {
      fileName: "/tmp/large.py",
      languageId: "python",
      text: `${"a".repeat(200)}${"b".repeat(200)}`,
      isActive: false,
    },
  ], { maxOpenFileChars: 120 });

  assert.match(context, /characters omitted/);
  assert.ok(context.length < 500);
});

test("collectEditorContext includes active, visible, and open file documents once", () => {
  const activeDocument = documentStub({
    fileName: "/tmp/active.ts",
    languageId: "typescript",
    text: `${"a".repeat(80)}${"z".repeat(80)}`,
    uri: "file:///tmp/active.ts",
    selectionText: "selected",
  });
  const visibleDocument = documentStub({
    fileName: "/tmp/visible.py",
    languageId: "python",
    text: "print('visible')\n",
    uri: "file:///tmp/visible.py",
  });
  const openDocument = documentStub({
    fileName: "/tmp/open.go",
    languageId: "go",
    text: "package main\n",
    uri: "file:///tmp/open.go",
  });
  const untitledDocument = documentStub({
    fileName: "/tmp/untitled.js",
    languageId: "javascript",
    text: "ignored",
    uri: "untitled:ignored",
    isUntitled: true,
  });
  const remoteDocument = documentStub({
    fileName: "/tmp/remote.rs",
    languageId: "rust",
    text: "ignored",
    uri: "vscode-remote://remote.rs",
    scheme: "vscode-remote",
  });
  const activeEditor = editorStub(activeDocument, false);
  const visibleEditor = editorStub(visibleDocument, true);

  withVscodeStub({
    window: {
      activeTextEditor: activeEditor,
      visibleTextEditors: [activeEditor, visibleEditor],
    },
    workspace: {
      textDocuments: [activeDocument, visibleDocument, openDocument, untitledDocument, remoteDocument],
    },
  }, () => {
    const documents = collectEditorContext(40);

    assert.deepEqual(documents.map((document) => document.fileName), [
      "/tmp/active.ts",
      "/tmp/visible.py",
      "/tmp/open.go",
    ]);
    assert.equal(documents[0].isActive, true);
    assert.equal(documents[0].cursorLine, 3);
    assert.equal(documents[0].cursorCharacter, 5);
    assert.equal(documents[0].selection, "selected");
    assert.match(documents[0].text, /characters omitted/);
    assert.equal(documents[1].isActive, false);
    assert.equal(documents[2].languageId, "go");
  });
});

function withVscodeStub(vscode, callback) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return vscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    callback();
  } finally {
    Module._load = originalLoad;
  }
}

function documentStub({ fileName, languageId, text, uri, selectionText = "", isUntitled = false, scheme = "file" }) {
  return {
    fileName,
    languageId,
    isUntitled,
    uri: {
      scheme,
      toString: () => uri,
    },
    getText: (selection) => selection ? selectionText : text,
  };
}

function editorStub(document, isSelectionEmpty) {
  return {
    document,
    selection: {
      isEmpty: isSelectionEmpty,
      active: { line: 2, character: 4 },
    },
  };
}
