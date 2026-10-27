import React, { useEffect, useState } from "react";
import { AnnouncementDocumentSchema } from "./schema";
import type { AnnouncementDocument, AnnouncementReference } from "./schema";

// Each announcement is a static build asset, loaded only when its offer opens.
const documents = import.meta.glob<AnnouncementDocument>(
  "../data/announcements/*.json",
  { import: "default" },
);

export function AnnouncementText({
  document,
}: {
  document: AnnouncementDocument;
}) {
  return (
    <div className="announcement-text">
      {document.parts.map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part.text}
          </a>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </div>
  );
}

function Announcement({ id }: { id: string }) {
  const [document, setDocument] = useState<AnnouncementDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setDocument(null);
    setFailed(false);
    const load = documents[`../data/announcements/${id}.json`];
    Promise.resolve()
      .then(() => {
        if (!load) throw new Error("Missing announcement");
        return load();
      })
      .then((value) => {
        if (active) setDocument(AnnouncementDocumentSchema.parse(value));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  if (failed)
    return (
      <p role="alert">
        The announcement text could not be loaded.{" "}
        <button className="text-button" onClick={() => setAttempt(attempt + 1)}>
          Try again
        </button>
      </p>
    );
  if (!document)
    return (
      <p role="status" className="muted">
        Loading announcement…
      </p>
    );
  return <AnnouncementText document={document} />;
}

const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

function EarlierAnnouncement({
  reference,
}: {
  reference: AnnouncementReference;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="earlier-announcement"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Earlier announcement · {date(reference.announcedAt)}</summary>
      {open && <Announcement id={reference.id} />}
    </details>
  );
}

export function Announcements({
  references,
}: {
  references: AnnouncementReference[];
}) {
  const unique = references
    .filter(
      (ref, index) =>
        references.findIndex((other) => other.id === ref.id) === index,
    )
    .sort((a, b) => b.announcedAt.localeCompare(a.announcedAt));
  if (!unique.length) return null;
  return (
    <section className="announcements" aria-label="Announcement details">
      <h2>Announcement details</h2>
      <p className="muted">Announced {date(unique[0].announcedAt)}</p>
      <Announcement key={unique[0].id} id={unique[0].id} />
      {unique.slice(1).map((reference) => (
        <EarlierAnnouncement key={reference.id} reference={reference} />
      ))}
    </section>
  );
}
