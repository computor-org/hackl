const assert = require("node:assert/strict");
const test = require("node:test");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runHacklPrompt } = require("../dist/session.js");
const { createNodeWorkspaceHost } = require("../dist/nodeWorkspaceHost.js");
const { createWorkspaceToolRunner } = require("../dist/toolRunner.js");

// A read-only mode has to find out which files exist before it can read one;
// guessing names is what made ask mode answer wrongly (issue #32).
async function withProject(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hackl-listing-"));
  await fsp.writeFile(path.join(root, "README.md"), "# icalc\n");
  await fsp.writeFile(path.join(root, "icalc.py"), "def add(a, b):\n    return a + b\n");
  await fsp.writeFile(path.join(root, "test_icalc.py"), "def test_add():\n    assert add(1, 2) == 3\n");
  await fsp.mkdir(path.join(root, "src"));
  await fsp.writeFile(path.join(root, "src", "main.py"), "print('hi')\n");
  await fsp.mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
  await fsp.writeFile(path.join(root, "node_modules", "dep", "index.js"), "vendored\n");
  try {
    return await callback(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("read_file on a directory lists its entries one per line", async () => {
  await withProject(async (root) => {
    const host = createNodeWorkspaceHost(root);
    const listing = await host.readFile({ name: "read_file", path: "." }, 12000);

    assert.equal(listing.ok, true);
    assert.deepEqual(listing.content.split("\n"), ["README.md", "icalc.py", "src/", "test_icalc.py"]);
  });
});

test("read_file lists a nested directory and the ignored trees by their own names", async () => {
  await withProject(async (root) => {
    const host = createNodeWorkspaceHost(root);
    const nested = await host.readFile({ name: "read_file", path: "src" }, 12000);
    const ignored = await host.readFile({ name: "read_file", path: "node_modules" }, 12000);

    assert.deepEqual(nested.content.split("\n"), ["main.py"]);
    assert.deepEqual(ignored.content.split("\n"), ["dep/"]);
  });
});

test("a directory listing is capped and says how much it left out", async () => {
  await withProject(async (root) => {
    const host = createNodeWorkspaceHost(root);
    const listing = await host.readFile({ name: "read_file", path: "." }, 20);

    assert.deepEqual(listing.content.split("\n"), ["README.md", "icalc.py", "[2 more not listed]"]);
  });
});

test("read_file on a directory still refuses paths outside the workspace", async () => {
  await withProject(async (root) => {
    const host = createNodeWorkspaceHost(root);
    const outside = await host.readFile({ name: "read_file", path: "../" }, 12000);

    assert.equal(outside.ok, false);
    assert.match(outside.content, /outside the current workspace/);
  });
});

for (const mode of ["ask", "edit", "work", "agent", "yolo"]) {
  test(`${mode} mode can search the workspace to discover file names`, async () => {
    await withProject(async (root) => {
      let completions = 0;
      const answer = await runHacklPrompt(
        {
          backend: {
            async complete(messages) {
              completions += 1;
              if (completions === 1) {
                return { content: 'HACKL_TOOL {"name":"search_files","query":"icalc","glob":"**/*","max_results":20}' };
              }
              assert.match(messages.at(-1).content, /test_icalc\.py/);
              return { content: "icalc.py and test_icalc.py" };
            },
          },
          workspace: createNodeWorkspaceHost(root),
          config: { maxToolFileChars: 12000, maxContextTokens: 8192 },
        },
        { prompt: "Which calculation files are in this project?", contextText: "", mode, maxToolCalls: 2 },
        () => {},
      );

      assert.equal(answer.content, "icalc.py and test_icalc.py");
      assert.equal(completions, 2);
    });
  });
}

test("search_files refusal names the modes that allow it", async () => {
  await withProject(async (root) => {
    const runTool = createWorkspaceToolRunner({
      maxFileChars: 1000,
      allowSearch: false,
      workspace: createNodeWorkspaceHost(root),
    });

    assert.deepEqual(
      await runTool({ name: "search_files", query: "icalc" }),
      {
        ok: false,
        content: "search_files is not allowed in this mode; Hackl enables it in Ask, Edit, Work, Agent, and Yolo mode.",
      },
    );
  });
});
