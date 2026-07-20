# Set up Hackl with OpenRouter

Hackl is local-first: by default it talks to a keyless local server. OpenRouter
is the opposite, a hosted gateway that needs an API key. Use it when you want a
larger model than your machine runs, or no local server at all. Everything stays
optional; the local path is unchanged.

OpenRouter is OpenAI-compatible, so Hackl reaches it through the same backend.
The only addition is a Bearer token on each request.

## 1. Get a key

Create one at <https://openrouter.ai/keys>. Free models work with a free key,
under rate limits (see below).

## 2. Pick a model

Hackl drives tools through plain text (`HACKL_TOOL {json}`), not native function
calling, so an instruct model that follows the format beats a reasoning model
that emits long thinking blocks.

| Use | Model id |
| --- | -------- |
| Coding, default | `qwen/qwen3-coder:free` |
| All-round | `z-ai/glm-4.6:free` |
| General fallback | `meta-llama/llama-3.3-70b-instruct:free` |

The `:free` roster rotates; check <https://openrouter.ai/models?max_price=0> for
the current list.

## 3. Point Hackl at it

### CLI

Keep the key out of shell history with the environment variable:

```sh
export HACKL_API_KEY="sk-or-..."
hackl --endpoint https://openrouter.ai/api/v1 --model qwen/qwen3-coder:free "explain this repo"
```

Or pin the same values in `~/.config/hackl/config.json` (user-global, outside any
repo):

```jsonc
{
  "endpoint": "https://openrouter.ai/api/v1",
  "apiKey": "sk-or-...",
  "model": "qwen/qwen3-coder:free"
}
```

`--api-key` exists for one-offs but lands in shell history; prefer the env var or
the user-global config file.

A repo-local `./.hackl/config.json` is also read, but do not put `apiKey` there:
it lives inside your project's working tree and can be committed by accident.
Hackl's `.gitignore` covers `.hackl/`, but other repos may not. Keep the key in
`HACKL_API_KEY` or `~/.config/hackl/config.json`.

### VS Code

1. Set the endpoint and model:

   ```jsonc
   // settings.json
   {
     "hackl.endpoint": "https://openrouter.ai/api/v1",
     "hackl.model": "qwen/qwen3-coder:free"
   }
   ```

2. Run `Hackl: Set API Key` from the command palette and paste the key. It goes
   into VS Code SecretStorage, never into settings.json. Clear it later with
   `Hackl: Clear API Key`.

## Rate limits and modes

Free models cap requests (around 20 per minute and 200 per day). Hackl makes one
request per tool call, and the per-turn budget defaults to 128, so a couple of
deep Agent or Yolo turns can drain the daily quota. Use Ask and Edit modes to
conserve it, or lower `hackl.maxToolCalls` / `--max-tool-calls`.

## Sources

- OpenRouter API quickstart: <https://openrouter.ai/docs/quickstart>
- Free models: <https://openrouter.ai/models?max_price=0>
- Rate limits: <https://openrouter.ai/docs/api-reference/limits>
