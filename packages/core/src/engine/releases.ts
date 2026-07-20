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
  tag: "b9575",
  assets: {
    "macos-arm64": {
      name: "llama-b9575-bin-macos-arm64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b9575/llama-b9575-bin-macos-arm64.tar.gz",
      sha256: "b59933f062edbd0c03f2e1fad7f710f44ca11a41e72d384412297de82f7c3e95",
    },
    "macos-x64": {
      name: "llama-b9575-bin-macos-x64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b9575/llama-b9575-bin-macos-x64.tar.gz",
      sha256: "03f9eeb16f92d1305b553558f7ae967903834c3684dd4ca229f833cd3764c24c",
    },
    "ubuntu-vulkan-x64": {
      name: "llama-b9575-bin-ubuntu-vulkan-x64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b9575/llama-b9575-bin-ubuntu-vulkan-x64.tar.gz",
      sha256: "e82dd9f66831128d7efbb165010700b86830ddb5c0cbdb18902113a2a8577880",
    },
    "win-vulkan-x64": {
      name: "llama-b9575-bin-win-vulkan-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b9575/llama-b9575-bin-win-vulkan-x64.zip",
      sha256: "580d8b5d2d947e3207d61f9cdec47bf78ebfd49a69b04504fad937da074d07eb",
    },
  },
};
