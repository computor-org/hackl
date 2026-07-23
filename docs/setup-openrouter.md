# OpenRouter setup

OpenRouter is an optional hosted OpenAI-compatible gateway. Prompts and attached
context are sent to the selected remote model.

## VS Code

1. Create a key at <https://openrouter.ai/keys>.
2. Configure an available model:

   ```jsonc
   {
     "hackl.endpoint": "https://openrouter.ai/api/v1",
     "hackl.model": "<openrouter-model-id>"
   }
   ```

3. Run **Hackl: Set API Key**. Hackl stores it in VS Code SecretStorage, never
   in `settings.json`.
4. Run **Hackl: Check Local Server**.

Hackl asks once before sending context to this non-loopback endpoint. Use
**Hackl: Forget Trusted Remote Endpoints** to revoke that approval.

## CLI

Keep the key out of shell history:

```sh
export HACKL_API_KEY="sk-or-..."
hackl \
  --endpoint https://openrouter.ai/api/v1 \
  --model <openrouter-model-id> \
  "explain this project"
```

The CLI also reads `apiKey` from `~/.config/hackl/config.json`, but an
environment variable is easier to keep out of repositories. Avoid `--api-key`
for routine use because shell history may retain it.

## Limits

Hosted usage follows the selected provider's pricing, retention, and rate-limit
policies. Agent turns may make several model requests because each tool result
returns to the model. Reduce `hackl.maxToolCalls` or `--max-tool-calls` when
using a limited plan.

The free-model roster changes. Choose a current model from
<https://openrouter.ai/models?max_price=0>.

OpenRouter quickstart: <https://openrouter.ai/docs/quickstart>
