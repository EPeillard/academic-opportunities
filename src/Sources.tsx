import React from "react";

const mailingLists = [
  {
    name: "CHI-JOBS · ACM SIGCHI",
    description:
      "International research and academic positions in human–computer interaction.",
    url: "https://sigchi.org/operations/listserv/",
  },
  {
    name: "bulle-i3",
    description:
      "Research announcements in computer science, including internships, PhDs and academic jobs.",
    url: "https://listes.irit.fr/sympa/info/bull-i3",
  },
  {
    name: "GDR IHM",
    description:
      "Announcements from the French human–computer interaction research community.",
    url: "https://listes.services.cnrs.fr/wws/info/gdr-ihm",
  },
  {
    name: "GT RV · GdR IG-RV",
    description: "Announcements from the virtual reality research community.",
    url: "https://gdr-igrv.fr/listes/",
  },
];

const websites = [
  {
    name: "AFXR · Emplois et Carrières",
    url: "https://www.afxr.org/page/976227-emplois-et-carrieres",
  },
  { name: "CNRS recruitment", url: "https://emploi.cnrs.fr/" },
  { name: "Inria recruitment", url: "https://recrutement.inria.fr/" },
  { name: "ADUM", url: "https://adum.fr/" },
  { name: "EURAXESS", url: "https://euraxess.ec.europa.eu/" },
  { name: "Jobbnorge", url: "https://www.jobbnorge.no/" },
  { name: "Interfolio", url: "https://apply.interfolio.com/" },
];

export function Sources() {
  return (
    <article className="sources-page">
      <div className="page-heading">
        <h1>Sources</h1>
        <p>Where the opportunities in this catalogue come from.</p>
      </div>
      <p>
        Opportunities are selected manually from research mailing lists and
        vacancy websites. Listings retain links to the original vacancy or
        application website when available.
      </p>
      <section aria-labelledby="mailing-lists-title">
        <h2 id="mailing-lists-title">Mailing lists</h2>
        <ul className="source-directory">
          {mailingLists.map((source) => (
            <li key={source.name}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.name} ↗
              </a>
              <p>{source.description}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="websites-title">
        <h2 id="websites-title">Vacancy websites</h2>
        <p>
          Announcements link to university and laboratory websites, as well as
          recruitment portals such as:
        </p>
        <ul className="source-directory website-directory">
          {websites.map((source) => (
            <li key={source.name}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.name} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted">
        The catalogue is updated manually; these sources are not monitored
        automatically. Each listing provides its own vacancy links. Check the
        original announcement for current availability and application details.
      </p>
    </article>
  );
}
