import React from "react";
import type { Attachment } from "./schema";

function size(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PositionDocuments({
  attachments,
}: {
  attachments: Attachment[];
}) {
  if (!attachments.length) return null;
  return (
    <section className="position-documents" aria-label="Position documents">
      <h2>Position documents</h2>
      <ul>
        {attachments.map((attachment) => (
          <li key={attachment.url}>
            <a href={attachment.url} target="_blank" rel="noopener noreferrer">
              {attachment.name}
            </a>
            <div className="document-actions">
              <span className="muted">
                {
                  {
                    "application/pdf": "PDF",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                      "DOCX",
                    "image/png": "PNG",
                  }[attachment.mediaType]
                }{" "}
                · {size(attachment.size)}
              </span>
              {attachment.url.startsWith("/documents/") ? (
                <a
                  href={attachment.url}
                  download={attachment.name}
                  aria-label={`Download ${attachment.name}`}
                >
                  Download
                </a>
              ) : (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${attachment.name}`}
                >
                  Open document ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
