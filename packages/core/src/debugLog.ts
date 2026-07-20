// Diagnostic sink contract. Frontends provide the implementation: the VS Code
// extension writes to an OutputChannel, the CLI writes to a file or stderr.
export type DebugLog = (event: string, data?: unknown) => void;
