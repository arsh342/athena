/** Feed endpoints, verified against the live services on 2026-11-19. Public data only; nothing about the user's code is sent. */
export const FEEDS = {
  /** OSV per-ecosystem exports: `<base>/<Ecosystem>/all.zip`, `<base>/<Ecosystem>/modified_id.csv` (`<iso time>,<id>`, newest first), `<base>/<Ecosystem>/<id>.json`. License: CC-BY 4.0 / per-source (see https://osv.dev/docs/). */
  osvExport: 'https://osv-vulnerabilities.storage.googleapis.com',
  /** CISA Known Exploited Vulnerabilities catalogue (JSON: `vulnerabilities[].cveID`, `dateAdded`). US government work, public domain. */
  kev: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  /** FIRST EPSS daily scores (CSV.gz: a `#model_version:…,score_date:…` line, then `cve,epss,percentile`). Free to use with attribution to FIRST. */
  epss: 'https://epss.cyentia.com/epss_scores-current.csv.gz',
  /** GitHub Advisory Database records are included in the OSV export (GHSA ids); CC BY 4.0, attributed to GitHub. */
  attribution: 'Advisory data: OSV.dev (CC-BY 4.0) incl. GitHub Advisory Database (CC BY 4.0); CISA KEV; FIRST EPSS.',
} as const;

/** Ecosystem directory names used by the OSV export (same spelling as `Dependency.ecosystem`). */
export const OSV_ECOSYSTEMS = ['npm', 'PyPI', 'Maven', 'NuGet', 'Go', 'crates.io', 'Packagist'] as const;
export type OsvEcosystem = (typeof OSV_ECOSYSTEMS)[number];
