export interface ConfigurationChangeEventLike {
  affectsConfiguration(section: string): boolean;
}

export interface HacklConfigurationChange {
  connection: boolean;
  localSelection: boolean;
  codexSelection: boolean;
  codexDetection: boolean;
}

export function classifyHacklConfigurationChange(
  event: ConfigurationChangeEventLike,
): HacklConfigurationChange {
  const localSelection = affectsAny(event, ["hackl.endpoint", "hackl.model"]);
  const codexSelection = event.affectsConfiguration("hackl.codex.model");
  const codexDetection = affectsAny(event, ["hackl.codex.enabled", "hackl.codex.command"]);
  return {
    connection: localSelection || codexSelection || codexDetection,
    localSelection,
    codexSelection,
    codexDetection,
  };
}

function affectsAny(event: ConfigurationChangeEventLike, sections: string[]): boolean {
  return sections.some((section) => event.affectsConfiguration(section));
}
