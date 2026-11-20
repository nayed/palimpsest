/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the git proxy (the Cloudflare Worker). */
  readonly VITE_GIT_PROXY?: string;
}
