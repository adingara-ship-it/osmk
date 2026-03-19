import type { APIRoute } from "astro";
import nodemailer from "nodemailer";

export const prerender = false;

const DEFAULT_MAIL_TO = "hellocontactosmk@gmail.com";
const MAX_TOTAL_UPLOAD_BYTES = 3.5 * 1024 * 1024;

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

      const extension = value.name.includes(".") ? "" : ".bin";
      const filename = `${label}-${index + 1}-${value.name.trim() || `${label}${extension}`}`;

      attachments.push({
        content: Buffer.from(await value.arrayBuffer()),
        contentType: value.type || undefined,
        filename,
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
      ["Motivation", getTextField(formData, "motivation")],
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

  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const applicationType = getTextField(formData, "application_type");

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
    const senderName = getTextField(formData, "full_name") || "New contact";

    await transporter.sendMail({
      attachments,
      from: mailFrom,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2b1b1b;">
          <p style="margin:0 0 12px;">New submission received from the OSMK website.</p>
          ${html}
        </div>
      `,
      replyTo: senderEmail,
      subject: `[OSMK] ${applicationLabels[applicationType]} - ${senderName}`,
      text: `New submission received from the OSMK website.\n\n${text}`,
      to: mailTo,
    });

    return buildResponse(request, 200, {
      message: "Your request has been sent successfully.",
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
