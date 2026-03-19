/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly MAIL_FROM?: string;
  readonly MAIL_TO?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PASS?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
