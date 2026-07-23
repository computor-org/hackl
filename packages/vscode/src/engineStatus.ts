import type { EngineSessionStatus } from "@hackl/core";

export interface EngineStatusDisplay {
  text: string;
  tooltip: string;
}

export function engineStatusDisplay(
  enabled: boolean,
  configuredExternal: boolean,
  status?: EngineSessionStatus,
): EngineStatusDisplay {
  if (!enabled) {
    return {
      text: "$(server) Hackl server: off",
      tooltip: "Hackl-managed llama.cpp is disabled globally. External endpoints are unaffected. Click to enable.",
    };
  }
  if (configuredExternal) {
    return {
      text: "$(plug) Hackl server: external",
      tooltip: "Using an explicitly configured endpoint. Hackl will never stop it. Click to disable managed startup.",
    };
  }
  if (!status || status.state === "stopped") {
    return {
      text: "$(server) Hackl server: unavailable",
      tooltip: "No managed server is running. Click to disable automatic startup.",
    };
  }
  if (status.state === "running-external") {
    return {
      text: "$(plug) Hackl server: external",
      tooltip: `${status.endpoint}\nAuto-discovered external server; Hackl will never stop it.`,
    };
  }
  const label = short(status.alias ?? status.model ?? "local");
  const shared = status.leases > 1 ? ` · ${status.leases} clients` : "";
  const ownership = status.hostMode === "foreground" ? "foreground terminal" : status.owner ?? "automatic";
  return {
    text: `$(server-process) Hackl: ${label}`,
    tooltip: `${status.endpoint}\nOwned by ${ownership}${shared}\nClick to disable this VS Code client's lease.`,
  };
}

function short(model: string): string {
  return model.split("/").pop() ?? model;
}
