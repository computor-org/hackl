const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function loadSetupPanel(fakeVscode) {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return fakeVscode;
    return original.call(this, request, parent, isMain);
  };
  try {
    for (const mod of ["../dist/setup/setupView.js", "../dist/setup/setupViewHtml.js"]) {
      delete require.cache[require.resolve(mod)];
    }
    return require("../dist/setup/setupView.js");
  } finally {
    Module._load = original;
  }
}

function makeFakeVscode() {
  const calls = { create: [], reveal: [] };
  const panel = {
    webview: {
      html: "",
      asWebviewUri: (uri) => uri,
      cspSource: "vscode-resource:",
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: () => Promise.resolve(true),
    },
    reveal: (column) => calls.reveal.push(column),
    onDidDispose: () => ({ dispose() {} }),
  };
  const fake = {
    ViewColumn: { One: 1, Active: -1 },
    Uri: { joinPath: (...parts) => parts.join("/") },
    window: {
      createWebviewPanel: (viewType, title, column) => {
        calls.create.push({ viewType, title, column });
        return panel;
      },
      showInformationMessage: () => Promise.resolve(undefined),
    },
    workspace: {
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
    commands: { executeCommand: () => Promise.resolve(undefined) },
    env: { openExternal: () => Promise.resolve(true) },
  };
  return { fake, calls };
}

test("SetupPanel opens and reveals in the editor column", () => {
  const { fake, calls } = makeFakeVscode();
  const { SetupPanel } = loadSetupPanel(fake);
  const context = { extensionUri: "extension:" };
  SetupPanel.show(context, async () => [], async () => undefined);
  SetupPanel.show(context, async () => [], async () => undefined);

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].column, fake.ViewColumn.One);
  assert.deepEqual(calls.reveal, [fake.ViewColumn.One]);
});
