// Ambient, loosely-typed declarations for the ESM-only @modelcontextprotocol/sdk
// subpaths used by the manager. They let the CommonJS tsc build compile the
// dynamic import() calls without resolving the package's "exports" map (which
// node-classic moduleResolution cannot read). esbuild ignores these and bundles
// the real implementation from source.
declare module "@modelcontextprotocol/sdk/client/index.js" {
  export const Client: any;
}
declare module "@modelcontextprotocol/sdk/client/stdio.js" {
  export const StdioClientTransport: any;
}
declare module "@modelcontextprotocol/sdk/client/streamableHttp.js" {
  export const StreamableHTTPClientTransport: any;
}
declare module "@modelcontextprotocol/sdk/client/sse.js" {
  export const SSEClientTransport: any;
}
