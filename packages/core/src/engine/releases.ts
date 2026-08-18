// Pinned llama.cpp prebuilt release for the managed install. Tag + per-flavor
// asset URL and sha256 are pinned from a specific ggml-org/llama.cpp release; the
// downloader refuses to install an asset whose sha256 does not match. sha256
// values are GitHub's published asset digests. Bump deliberately (re-fetch via
// `gh api repos/ggml-org/llama.cpp/releases/tags/<tag>` and update both fields).

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface ReleaseTable {
  tag: string;
  assets: Record<string, ReleaseAsset>; // keyed by flavor, e.g. "ubuntu-vulkan-x64"
}

export const LLAMACPP_RELEASE: ReleaseTable = {
  tag: "b10488",
  assets: {
    "macos-arm64": {
      name: "llama-b10488-bin-macos-arm64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10488/llama-b10488-bin-macos-arm64.tar.gz",
      sha256: "ada90bbc4787caac49fbb95ed2487a03fb4bbb456057a31e316878e1a895827a",
    },
    "macos-x64": {
      name: "llama-b10488-bin-macos-x64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10488/llama-b10488-bin-macos-x64.tar.gz",
      sha256: "80567f47511d5e11872835614b99cd678fa276b05553563e8aab3f2cb6b90abd",
    },
    "ubuntu-vulkan-x64": {
      name: "llama-b10488-bin-ubuntu-vulkan-x64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10488/llama-b10488-bin-ubuntu-vulkan-x64.tar.gz",
      sha256: "f180b1e34714a978b57af5ba0badffaec442a187bf9ebf224045e3df24aa0684",
    },
    "win-vulkan-x64": {
      name: "llama-b10488-bin-win-vulkan-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10488/llama-b10488-bin-win-vulkan-x64.zip",
      sha256: "8de77b0f912ad9c22bcfcb3798a36f2140fb0232df5defa2ea87d7f3e2652183",
    },
  },
};
