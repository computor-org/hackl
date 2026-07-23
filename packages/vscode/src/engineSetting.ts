const SETTING = "hackl.engine.enabled";

export type EngineSettingUpdate = "updated" | "reload-required";

export async function updateEngineEnabled(
  enabled: boolean,
  update: (next: boolean) => PromiseLike<void>,
): Promise<EngineSettingUpdate> {
  try {
    await update(!enabled);
    return "updated";
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes(SETTING) && text.includes("not a registered configuration")) {
      return "reload-required";
    }
    throw error;
  }
}
