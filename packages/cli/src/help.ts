// Help text lives in its own module so tests can check it against argparse
// without loading index.js, whose transitive require of hackl-webui-assets is
// satisfied only by the esbuild bundle, not by tsc.
export const HELP = `hackl - local-first AI coding agent

Usage:
  hackl [options] [prompt]        one-shot prompt (or pipe stdin)
  hackl [options]                 interactive REPL (in a terminal)
  hackl review [options] [note]   review staged/commit changes

Local engine (managed llama.cpp, loopback-only):
  hackl serve [model]             foreground engine + Hackl and llama.cpp WebUIs
  hackl models                    list recommended and installed models
  hackl models install <model>    download a managed model and its projector
  hackl models remove <model>     remove a managed model (--yes for scripts)
  serve options: --open, --no-open, --host, --port, --token, --allow-yolo
                 --allow-remote binds llama.cpp to 0.0.0.0 (DANGER)

Options:
  --mode ask|edit|work|agent|yolo  tool permissions (default: agent)
  --yolo                       DANGER: no command policy, no approval prompts.
                               Runs any shell command. You are responsible for
                               whatever happens. Same as --mode yolo.
  --model <id>                 model id (default: endpoint's model)
  --endpoint <url>             OpenAI-compatible base URL (default: auto-detect)
  --api-key <key>              Bearer token for the endpoint (e.g. OpenRouter).
                               Prefer HACKL_API_KEY to keep it out of shell history.
  --max-tool-calls <n>         tool-call budget per turn (default: 128)
  --cwd <dir>                  workspace root (default: current directory)
  --staged                     include staged git changes as context
  --commit <sha>               include a commit's diff as context
  --mcp <name>                 only connect the named MCP server (repeatable)
  --codex                      use the Codex backend
  --thinking                   show model reasoning
  --json                       emit NDJSON events (for scripting)
  -y, --yes                    auto-approve gated actions (non-interactive)
  --no-color                   disable ANSI colors
  -h, --help                   show this help
  -v, --version                show version

Context: mention files in the prompt with @path or @path:start-end.
Config:  ~/.config/hackl/config.json, ./.hackl/config.json, HACKL_* env, flags.
`;

