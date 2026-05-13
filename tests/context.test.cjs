const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { buildPromptContext, collectEditorContext } = require("../dist/context.js");

test("buildPromptContext includes active file metadata without file text", () => {
  const context = buildPromptContext([
    {
      fileName: "/tmp/example.ts",
      path: "example.ts",
      languageId: "typescript",
      isActive: true,
      cursorLine: 2,
      cursorCharacter: 8,
      selection: {
        startLine: 2,
        startCharacter: 3,
        endLine: 2,
        endCharacter: 8,
      },
    },
  ], { maxToolFileChars: 1000 });

  assert.match(context, /File: example\.ts/);
  assert.match(context, /Absolute path: \/tmp\/example\.ts/);
  assert.match(context, /State: active/);
  assert.match(context, /Cursor: line 2, column 8/);
  assert.match(context, /Selection: line 2, columns 3-8/);
  assert.match(context, /Content: omitted/);
  assert.doesNotMatch(context, /const value = 1/);
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
      asRelativePath: (uri) => uri.fsPath?.replace("/tmp/", "") ?? uri.toString().replace("file:///tmp/", ""),
    },
  }, () => {
    const documents = collectEditorContext();

    assert.deepEqual(documents.map((document) => document.fileName), [
      "/tmp/active.ts",
      "/tmp/visible.py",
      "/tmp/open.go",
    ]);
    assert.deepEqual(documents.map((document) => document.path), [
      "active.ts",
      "visible.py",
      "open.go",
    ]);
    assert.equal(documents[0].isActive, true);
    assert.equal(documents[0].cursorLine, 3);
    assert.equal(documents[0].cursorCharacter, 5);
    assert.deepEqual(documents[0].selection, {
      startLine: 1,
      startCharacter: 2,
      endLine: 1,
      endCharacter: 10,
    });
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
      fsPath: fileName,
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
      start: { line: 0, character: 1 },
      end: { line: 0, character: 9 },
    },
  };
}
