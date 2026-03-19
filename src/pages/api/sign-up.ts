import type { APIRoute } from "astro";
import nodemailer from "nodemailer";

export const prerender = false;

const DEFAULT_MAIL_TO = "hellocontactosmk@gmail.com";
const DEFAULT_SUCCESS_MESSAGE = "Your request has been sent successfully.";
const FORM_HONEYPOT_FIELD = "company_website";
const FORM_STARTED_AT_FIELD = "form_started_at";
const MAX_FIELD_LENGTHS = {
  additional_notes: 1500,
  age: 3,
  budget_range: 80,
  collaboration_role: 120,
  company_or_project: 140,
  country: 80,
  email: 254,
  full_name: 120,
  motivation: 2000,
  phone: 40,
  piece_deadline: 120,
  piece_description: 2500,
  piece_extra_notes: 1500,
  piece_type: 100,
  portfolio: 240,
  preferred_size: 40,
  project_description: 2500,
  reference_link: 240,
  request_country: 80,
  timeline: 160,
} as const;
const MIN_FORM_SUBMIT_DELAY_MS = 2500;
const MAX_FORM_AGE_MS = 1000 * 60 * 60 * 12;
const MAX_TOTAL_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const IMAGE_EXTENSIONS = new Set([".avif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"]);
const DOCUMENT_MIME_TYPES = new Set(["application/pdf"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf"]);

const applicationLabels = {
  collaboration: "Creative collaboration",
  model: "Model application",
  unique: "Unique pieces request",
} as const;

type ApplicationType = keyof typeof applicationLabels;

function isApplicationType(value: string): value is ApplicationType {
  return Object.prototype.hasOwnProperty.call(applicationLabels, value);
}

function getTextField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function getFileExtension(filename: string): string {
  const match = /\.[^.]+$/.exec(filename.trim().toLowerCase());
  return match ? match[0] : "";
}

function sanitizeFilename(filename: string, fallbackLabel: string, index: number): string {
  const cleaned = filename
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[\\/:"*?<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);

  if (cleaned.length > 0) {
    return cleaned;
  }

  return `${fallbackLabel}-${index + 1}.bin`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTextSection(title: string, fields: Array<[string, string]>): string {
  const visibleFields = fields.filter(([, value]) => value.length > 0);
  if (visibleFields.length === 0) return "";

  return [
    title,
    "-".repeat(title.length),
    ...visibleFields.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}

function formatHtmlSection(title: string, fields: Array<[string, string]>): string {
  const visibleFields = fields.filter(([, value]) => value.length > 0);
  if (visibleFields.length === 0) return "";

  return `
    <section style="margin-top:24px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#5c1515;">${escapeHtml(title)}</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          ${visibleFields
            .map(
              ([label, value]) => `
                <tr>
                  <td style="padding:8px 0;vertical-align:top;font-weight:700;color:#5c1515;width:180px;">
                    ${escapeHtml(label)}
                  </td>
                  <td style="padding:8px 0;vertical-align:top;color:#2b1b1b;">
                    ${escapeHtml(value).replaceAll("\n", "<br />")}
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function buildRedirectResponse(request: Request, status: "success" | "error", message: string) {
  const redirectUrl = new URL("/sign-up/", request.url);
  redirectUrl.searchParams.set("status", status);
  redirectUrl.searchParams.set("message", message);
  return Response.redirect(redirectUrl, 303);
}

function buildResponse(
  request: Request,
  statusCode: number,
  payload: { message: string; ok: boolean; status: "success" | "error" }
) {
  const wantsJson = request.headers.get("accept")?.includes("application/json");

  if (wantsJson) {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  return buildRedirectResponse(request, payload.status, payload.message);
}

function requireFields(formData: FormData, fieldNames: string[]) {
  const missingFields = fieldNames.filter((field) => getTextField(formData, field).length === 0);
  return missingFields;
}

function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    return origin === requestOrigin;
  }

  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === requestOrigin;
  } catch {
    return false;
  }
}

function validateTextFieldLengths(formData: FormData) {
  for (const [field, maxLength] of Object.entries(MAX_FIELD_LENGTHS)) {
    if (getTextField(formData, field).length > maxLength) {
      return "One or more fields are too long. Please shorten your message and try again.";
    }
  }

  return null;
}

function validateAntiSpamFields(formData: FormData) {
  if (getTextField(formData, FORM_HONEYPOT_FIELD).length > 0) {
    return "honeypot_triggered" as const;
  }

  const startedAt = Number.parseInt(getTextField(formData, FORM_STARTED_AT_FIELD), 10);
  if (!Number.isFinite(startedAt)) {
    return "Please reload the form and try again.";
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FORM_SUBMIT_DELAY_MS) {
    return "Please wait a moment before sending the form.";
  }

  if (elapsed > MAX_FORM_AGE_MS) {
    return "This form has expired. Please reload the page and try again.";
  }

  return null;
}

function fileMatchesRules(
  file: File,
  mimeTypes: Set<string>,
  extensions: Set<string>
): boolean {
  const contentType = file.type.trim().toLowerCase();
  const extension = getFileExtension(file.name);
  return mimeTypes.has(contentType) || extensions.has(extension);
}

function validateAttachments(formData: FormData) {
  const fileRules = [
    {
      extensions: IMAGE_EXTENSIONS,
      field: "headshot",
      maxFiles: 1,
      mimeTypes: IMAGE_MIME_TYPES,
    },
    {
      extensions: IMAGE_EXTENSIONS,
      field: "full_body_picture",
      maxFiles: 1,
      mimeTypes: IMAGE_MIME_TYPES,
    },
    {
      extensions: new Set([...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]),
      field: "attachments",
      maxFiles: 4,
      mimeTypes: new Set([...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES]),
    },
    {
      extensions: IMAGE_EXTENSIONS,
      field: "inspiration_images",
      maxFiles: 4,
      mimeTypes: IMAGE_MIME_TYPES,
    },
  ] as const;

  for (const rule of fileRules) {
    const files = formData
      .getAll(rule.field)
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length > rule.maxFiles) {
      return "Too many files were uploaded. Please reduce the number of attachments and try again.";
    }

    for (const file of files) {
      if (!fileMatchesRules(file, rule.mimeTypes, rule.extensions)) {
        return "Only JPG, PNG, WebP, AVIF, HEIC/HEIF, and PDF files are allowed.";
      }
    }
  }

  return null;
}

async function collectAttachments(formData: FormData) {
  const attachmentDefinitions = [
    { field: "attachments", label: "attachment" },
    { field: "full_body_picture", label: "full-body-picture" },
    { field: "headshot", label: "headshot" },
    { field: "inspiration_images", label: "inspiration-image" },
  ];

  const attachments: Array<{
    content: Buffer;
    contentType?: string;
    filename: string;
  }> = [];

  let totalBytes = 0;

  for (const { field, label } of attachmentDefinitions) {
    const entries = formData.getAll(field);

    for (const [index, value] of entries.entries()) {
      if (!(value instanceof File) || value.size === 0) continue;

      totalBytes += value.size;
      if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
        throw new Error("TOTAL_UPLOAD_LIMIT_EXCEEDED");
      }

      attachments.push({
        content: Buffer.from(await value.arrayBuffer()),
        contentType: value.type || undefined,
        filename: sanitizeFilename(value.name, label, index),
      });
    }
  }

  return attachments;
}

function getTransporter() {
  const host = import.meta.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number.parseInt(import.meta.env.SMTP_PORT?.trim() || "465", 10);
  const secure = (import.meta.env.SMTP_SECURE?.trim() || `${port === 465}`).toLowerCase() === "true";
  const user = import.meta.env.SMTP_USER?.trim();
  const pass = import.meta.env.SMTP_PASS?.trim();

  if (!user || !pass) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  return nodemailer.createTransport({
    auth: {
      pass,
      user,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    host,
    port,
    secure,
  });
}

function getMailMetadata() {
  const mailTo = import.meta.env.MAIL_TO?.trim() || DEFAULT_MAIL_TO;
  const smtpUser = import.meta.env.SMTP_USER?.trim() || DEFAULT_MAIL_TO;
  const mailFrom = import.meta.env.MAIL_FROM?.trim() || `"OSMK website" <${smtpUser}>`;

  return {
    mailFrom,
    mailTo,
  };
}

function buildSections(applicationType: ApplicationType, formData: FormData) {
  const baseFields: Array<[string, string]> = [
    ["Application type", applicationLabels[applicationType]],
    ["Full name", getTextField(formData, "full_name")],
    ["Email address", getTextField(formData, "email")],
    ["Phone number", getTextField(formData, "phone")],
  ];

  const sections = [formatTextSection("Contact", baseFields)];
  const htmlSections = [formatHtmlSection("Contact", baseFields)];

  if (applicationType === "model") {
    const modelFields: Array<[string, string]> = [
      ["Age", getTextField(formData, "age")],
      ["Country", getTextField(formData, "country")],
      ["Instagram or portfolio", getTextField(formData, "portfolio")],
      ["Short note / why OSMK", getTextField(formData, "motivation")],
    ];

    sections.push(formatTextSection("Model details", modelFields));
    htmlSections.push(formatHtmlSection("Model details", modelFields));
  }

  if (applicationType === "collaboration") {
    const collaborationFields: Array<[string, string]> = [
      ["Company / Brand / Project name", getTextField(formData, "company_or_project")],
      ["Role / Type of collaboration", getTextField(formData, "collaboration_role")],
      ["Project description", getTextField(formData, "project_description")],
      ["Proposed timeline", getTextField(formData, "timeline")],
      ["Additional notes", getTextField(formData, "additional_notes")],
    ];

    sections.push(formatTextSection("Collaboration details", collaborationFields));
    htmlSections.push(formatHtmlSection("Collaboration details", collaborationFields));
  }

  if (applicationType === "unique") {
    const uniqueFields: Array<[string, string]> = [
      ["Country", getTextField(formData, "request_country")],
      ["Type of piece", getTextField(formData, "piece_type")],
      ["Preferred size", getTextField(formData, "preferred_size")],
      ["Budget range", getTextField(formData, "budget_range")],
      ["Describe your piece", getTextField(formData, "piece_description")],
      ["Deadline", getTextField(formData, "piece_deadline")],
      ["Instagram or moodboard link", getTextField(formData, "reference_link")],
      ["Anything else", getTextField(formData, "piece_extra_notes")],
    ];

    sections.push(formatTextSection("Unique piece request", uniqueFields));
    htmlSections.push(formatHtmlSection("Unique piece request", uniqueFields));
  }

  return {
    html: htmlSections.filter(Boolean).join(""),
    text: sections.filter(Boolean).join("\n\n"),
  };
}

function validateRequest(applicationType: ApplicationType, formData: FormData) {
  const antiSpamError = validateAntiSpamFields(formData);
  if (antiSpamError) {
    return antiSpamError;
  }

  const fieldLengthError = validateTextFieldLengths(formData);
  if (fieldLengthError) {
    return fieldLengthError;
  }

  const missingBaseFields = requireFields(formData, ["full_name", "email", "phone"]);
  if (missingBaseFields.length > 0) {
    return "Please fill in all required contact fields.";
  }

  const email = getTextField(formData, "email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Please enter a valid email address.";
  }

  if (applicationType === "model") {
    if (requireFields(formData, ["age", "country", "motivation"]).length > 0) {
      return "Please complete all required model details.";
    }

    const headshot = formData.get("headshot");
    const fullBodyPicture = formData.get("full_body_picture");
    if (!(headshot instanceof File) || headshot.size === 0 || !(fullBodyPicture instanceof File) || fullBodyPicture.size === 0) {
      return "Please upload both the headshot and full-body picture.";
    }
  }

  if (applicationType === "collaboration") {
    if (requireFields(formData, ["collaboration_role", "project_description"]).length > 0) {
      return "Please complete the collaboration details.";
    }
  }

  if (applicationType === "unique") {
    if (requireFields(formData, ["piece_type", "preferred_size", "piece_description"]).length > 0) {
      return "Please complete the unique piece request.";
    }
  }

  const attachmentError = validateAttachments(formData);
  if (attachmentError) {
    return attachmentError;
  }

  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return buildResponse(request, 400, {
        message: "Invalid form submission.",
        ok: false,
        status: "error",
      });
    }

    if (!isSameOriginRequest(request)) {
      return buildResponse(request, 403, {
        message: "This request origin is not allowed.",
        ok: false,
        status: "error",
      });
    }

    const formData = await request.formData();
    const applicationType = getTextField(formData, "application_type");

    if (getTextField(formData, FORM_HONEYPOT_FIELD).length > 0) {
      return buildResponse(request, 200, {
        message: DEFAULT_SUCCESS_MESSAGE,
        ok: true,
        status: "success",
      });
    }

    if (!isApplicationType(applicationType)) {
      return buildResponse(request, 400, {
        message: "Invalid application type.",
        ok: false,
        status: "error",
      });
    }

    const validationError = validateRequest(applicationType, formData);
    if (validationError) {
      return buildResponse(request, 400, {
        message: validationError,
        ok: false,
        status: "error",
      });
    }

    const attachments = await collectAttachments(formData);
    const transporter = getTransporter();
    const { mailFrom, mailTo } = getMailMetadata();
    const { html, text } = buildSections(applicationType, formData);
    const senderEmail = getTextField(formData, "email");
    const senderName = normalizeHeaderValue(getTextField(formData, "full_name")) || "New contact";

    await transporter.sendMail({
      attachments,
      from: mailFrom,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2b1b1b;">
          <p style="margin:0 0 12px;">New submission received from the OSMK website.</p>
          ${html}
        </div>
      `,
      replyTo: normalizeHeaderValue(senderEmail),
      subject: `[OSMK] ${applicationLabels[applicationType]} - ${senderName}`,
      text: `New submission received from the OSMK website.\n\n${text}`,
      to: mailTo,
    });

    return buildResponse(request, 200, {
      message: DEFAULT_SUCCESS_MESSAGE,
      ok: true,
      status: "success",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "TOTAL_UPLOAD_LIMIT_EXCEEDED"
        ? "The total size of uploaded files must stay under 3.5 MB."
        : error instanceof Error && error.message === "SMTP_NOT_CONFIGURED"
          ? "The mail server is not configured yet. Add the SMTP environment variables before testing."
          : "Something went wrong while sending your request. Please try again.";

    const statusCode =
      error instanceof Error &&
      (error.message === "TOTAL_UPLOAD_LIMIT_EXCEEDED" || error.message === "SMTP_NOT_CONFIGURED")
        ? 400
        : 500;

    return buildResponse(request, statusCode, {
      message,
      ok: false,
      status: "error",
    });
  }
};
