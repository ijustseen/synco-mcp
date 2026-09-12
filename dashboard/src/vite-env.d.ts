/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_PROJECT_ID?: string;
  readonly VITE_SYNCO_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
