/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDBASE_ENV_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
