export interface ReasoningSplit {
  answer: string;
  reasoning: string;
}

export function splitReasoning(content: string): ReasoningSplit {
  const reasoning: string[] = [];
  let answer = "";
  let position = 0;

  while (position < content.length) {
    const start = content.indexOf("<think>", position);
    if (start < 0) {
      answer += content.slice(position);
      break;
    }

    answer += content.slice(position, start);
    const bodyStart = start + "<think>".length;
    const end = content.indexOf("</think>", bodyStart);
    if (end < 0) {
      reasoning.push(content.slice(bodyStart));
      break;
    }

    reasoning.push(content.slice(bodyStart, end));
    position = end + "</think>".length;
  }

  return {
    answer: answer.trimStart(),
    reasoning: reasoning.join("\n\n").trim(),
  };
}
