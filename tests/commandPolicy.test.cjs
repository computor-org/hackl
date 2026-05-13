const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyCommand } = require("../dist/commandPolicy.js");

const options = {
  workspaceRoot: process.platform === "win32" ? "C:\\repo" : "/repo",
  packageScripts: new Set(["test", "compile"]),
};

test("command policy auto-allows read-only git and declared npm scripts", () => {
  assert.equal(classifyCommand({ name: "run_command", cmd: "git", args: ["status"] }, options).decision, "allow");
  assert.equal(classifyCommand({ name: "run_command", cmd: "npm", args: ["test"] }, options).decision, "allow");
  assert.equal(classifyCommand({ name: "run_command", cmd: "npm", args: ["run", "compile"] }, options).decision, "allow");
});

test("command policy asks for unknown safe commands", () => {
  assert.equal(classifyCommand({ name: "run_command", cmd: "node", args: ["scripts/check.js"] }, options).decision, "ask");
});

test("command policy denies destructive commands and shell syntax", () => {
  assert.equal(classifyCommand({ name: "run_command", cmd: "sudo", args: ["npm", "test"] }, options).decision, "deny");
  assert.equal(classifyCommand({ name: "run_command", cmd: "npm", args: ["test", "&&", "rm", "-rf", "/"] }, options).decision, "deny");
  assert.equal(classifyCommand({ name: "run_command", cmd: "npm", args: ["install"] }, options).decision, "deny");
  assert.equal(classifyCommand({ name: "run_command", cmd: "git", args: ["clean", "-fd"] }, options).decision, "deny");
  assert.equal(classifyCommand({ name: "run_command", cmd: "git", args: ["reset", "--hard"] }, options).decision, "deny");
});

test("command policy denies outside workspace paths", () => {
  const outside = process.platform === "win32" ? "C:\\Windows" : "/tmp";
  assert.equal(classifyCommand({ name: "run_command", cmd: "node", args: [outside] }, options).decision, "deny");
  assert.equal(classifyCommand({ name: "run_command", cmd: "node", args: ["../outside.js"] }, options).decision, "deny");
});
