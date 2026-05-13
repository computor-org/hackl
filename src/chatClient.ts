export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClientOptions {
  endpoint: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export async function sendChat(messages: ChatMessage[], options: ChatClientOptions): Promise<string> {
  const endpoint = options.endpoint.replace(/\/$/, "");
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      temperature: 0.2,
    }),
  });

  const payload = await response.json() as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Chat request failed with HTTP ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat response did not contain assistant content.");
  }
  return content;
}
