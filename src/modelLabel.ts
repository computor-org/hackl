// Compact a backend model id for display. Requests still use the full id;
// only the GUI shows the short form.
//
//   unsloth/qwen3.6:35b-a3b@128k        -> qwen3.6:35b
//   qwen/qwen3-coder-next:80b-a3b-q4km   -> qwen3-coder-next
//   gpt-5.4-mini                         -> gpt-5.4-mini
//
// Drop the vendor prefix and @context suffix. When the name already carries a
// descriptor (hyphenated word, e.g. "coder-next") it is self-explanatory and
// the size is dropped; otherwise the total parameter size is appended so a bare
// family name like "qwen3.6" stays distinguishable.
export function shortModelLabel(id: string): string {
  if (!id) return id;
  const noVendor = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  const noCtx = noVendor.split("@")[0];
  const colon = noCtx.indexOf(":");
  if (colon === -1) return noCtx;
  const name = noCtx.slice(0, colon);
  const params = noCtx.slice(colon + 1);
  const hasDescriptor = name.split("-").slice(1).some((seg) => /[a-zA-Z]/.test(seg));
  if (hasDescriptor) return name;
  const size = params.split("-").find((seg) => /^\d+(\.\d+)?b$/i.test(seg));
  return size ? `${name}:${size}` : name;
}
