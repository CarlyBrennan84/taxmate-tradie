/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECEIPT_SCANNER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
