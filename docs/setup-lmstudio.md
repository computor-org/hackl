# Set up Hackl with LM Studio

LM Studio is the easiest path: it handles model discovery, download, GPU
offload, server start/stop, and logs through a desktop GUI. Hackl just talks
to the OpenAI-compatible HTTP endpoint it exposes.

## 1. Install LM Studio

Install for Windows, macOS, or Linux from <https://lmstudio.ai/>. Open it once.

## 2. Download a Q4 GGUF model

In LM Studio, search for one of these:

| Machine                                            | Search                       |
| -------------------------------------------------- | ---------------------------- |
| Small RAM / no useful GPU                          | `Qwen3.5-4B-GGUF`            |
| Normal laptop or desktop                           | `Qwen3.5-9B-GGUF`            |
| Lots of RAM / strong GPU / Apple unified memory    | `Qwen3.6-35B-A3B-GGUF`       |

Load the model and try a quick chat in LM Studio's own UI to confirm it works.

## 3. Start the local server

In LM Studio, open the **Developer** (or **Local Server**) tab and start the
server. The default base URL is:

```
http://127.0.0.1:1234/v1
```

Keep it bound to `127.0.0.1`. Optional: enable "run on login" in LM Studio
settings if you want it always up.

## 4. Point Hackl at it

Either click the **Set endpoint to :1234/v1** button in the Hackl setup view,
or edit your settings:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:1234/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

## Notes

- LM Studio's OpenAI compatibility docs:
  <https://lmstudio.ai/docs/developer/openai-compat>
- For autocomplete you want a small model (~3–7B). Editor chat is comfortable
  at 16k–32k context. Agentic coding wants 64k+ if your RAM/VRAM allows it.
