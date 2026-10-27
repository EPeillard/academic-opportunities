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
                {attachment.url.split(".").pop()?.toUpperCase()} ·{" "}
                {size(attachment.size)}
              </span>
              <a
                href={attachment.url}
                download={attachment.name}
                aria-label={`Download ${attachment.name}`}
              >
                Download
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
