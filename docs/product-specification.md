# Product specification

## Goal and scope

Public, account-free discovery of research jobs across computer science and adjacent disciplines, not restricted to XR/HCI. Types: Internship, PhD, Postdoc, Research Engineer, Research Scientist, Faculty, Other. Topics include HCI, XR, Graphics/Visualization, Robotics/HRI, AI/ML, Vision, Perception/Cognitive Science, Software Engineering, Cybersecurity, Data Science, Human Factors and interdisciplinary research. An opportunity may have multiple topics.

## Opportunity contract

Title, type, organization, laboratory, country, city, topics, duration, compensation, start date, application deadline, contact, application URL, description, publication date, source references and publication format. Missing extracted values stay null (topics may be empty). Dates use ISO calendar dates and timestamps UTC. Unknown or open deadlines are null, never inferred. Country labels are display strings in M1; normalize to ISO country codes in ingestion later.

Private records preserve raw messages, provenance per field, source associations, immutable revisions, checks and audit. The public response includes only approved metadata, approved source labels/URLs/dates, and safe description. No private quote, message ID, object key, headers, attachment, original body or moderation note is public.

States: draft → pending_review or published; pending_review → published or rejected; published → archived or pending_review; archived/rejected can return to review by an authorized administrator. Every future transition is validated server-side and audited; publication requires independent permission and extraction checks. Critical ambiguity requires review; missing optional compensation/duration/lab/start date/contact does not.

## Public experience (M1)

Responsive listing, keyword search (title, organization, lab and description), type/topic/country filters, published-since date, deadline-before date, and include/exclude unknown deadlines. Deadline-before excludes null deadlines unless explicitly included. Filters combine with AND and are represented in URL parameters. Paginated results ordered newest first with stable ID tie-breaker. Detail pages include source references and all available metadata; unknowns show “Not specified”. Loading, empty, invalid query, not found and retryable error states. Clear synthetic-demo notice. No real recruiting links in examples.

## Private experience (later)

Access-protected review queue with evidence, original safe text preview, independent gate results and source policy. Correct, reject, merge, approve and republish with reason and optimistic concurrency. Never render raw HTML/attachments. Browser login alone is insufficient; server checks identity for every mutation/read. This interface is intentionally absent in M1.

## Acceptance for M1

Fresh checkout can install locked dependencies, migrate and seed local D1 without Cloudflare credentials, run web and Worker locally, filter and open details, and run tests/typechecks/build. Only published records can be retrieved, including direct IDs. Invalid filters return 400; unsupported API methods 405; private/admin routes deny access. API outputs validated by shared Zod schemas. HTML-like content is escaped by React; links use restricted HTTPS policy. No email, queues, extraction, cron, real authentication, deployment, production resources, or routine automation is operational yet.
