export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClientOptions {
  endpoint: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletion {
  content: string;
  model?: string;
}

export interface ChatBackend {
  complete(messages: ChatMessage[]): Promise<ChatCompletion>;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function createOpenAICompatibleBackend(options: ChatClientOptions): ChatBackend {
  return new OpenAICompatibleBackend(options);
}

export async function sendChat(messages: ChatMessage[], options: ChatClientOptions): Promise<string> {
  const completion = await createOpenAICompatibleBackend(options).complete(messages);
  return completion.content;
}

class OpenAICompatibleBackend implements ChatBackend {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ChatClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(messages: ChatMessage[]): Promise<ChatCompletion> {
    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: false,
        temperature: 0.2,
      }),
    });

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Chat request failed with HTTP ${response.status}`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Chat response did not contain assistant content.");
    }
    return { content, model: payload.model };
  }
}

async function readJson(response: Response): Promise<ChatCompletionResponse> {
  try {
    return await response.json() as ChatCompletionResponse;
  } catch {
    return {};
  }
}
