# Feature Specification: Articles List Export

**Feature Branch**: `005-articles-export`  
**Created**: 2026-03-15  
**Status**: Draft  
**Input**: User description: "create a new feature to export in the ArticlesList. It should be comprehensive. Research
to see how a new component might help. Export options: all data from articles in CSV, RIS, Zotero RDF; option to export
PDF files linked to articles. File handling: option to export just the main files (article) or all files. If all files,
export to a folder per article in the export folder that contains the csv or ris etc."

## Clarifications

### Session 2026-03-15

- Q: When creating one folder per article in "All files" mode, how should each article's folder be named? → A: Both — "
  id_sanitized_title" so every folder is unique and readable.
- Q: For large exports (e.g. hundreds of articles with "All files"), how should the system behave? → A: No limit or
  warning; always allow with progress feedback and optional cancel. Export may run asynchronously and the user is
  notified when the download is ready.
- Q: When the user opens the export flow without having selected any articles, what should be the default for "which
  articles to export"? → A: "Current list" — export all articles currently visible (after filters/search).
- Q: When some linked files cannot be included (e.g. missing or inaccessible), where should the user see which items or
  files were skipped? → A: Both — brief summary in the UI and a list (e.g. README or manifest) inside the package.
- Q: When export runs asynchronously and the system notifies the user that the download is ready, how should the user
  get the file? → A: Notification includes a one-time download link (or button) that starts the download.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export article metadata in standard formats (Priority: P1)

A researcher viewing the articles list can export the visible (filtered) articles—or a selection of them—as
bibliographic data in CSV, RIS, or Zotero RDF. They choose one or more formats and receive downloadable file(s)
containing title, authors, year, journal, DOI, PMID, keywords, and abstract so they can reuse the data in spreadsheets
or reference managers.

**Why this priority**: Core value is portable metadata; no file handling or PDFs required.

**Independent Test**: User applies filters (or selects rows), triggers export, chooses CSV (or RIS or RDF), and receives
a valid file that opens in a spreadsheet or reference manager and contains the expected fields for the chosen articles.

**Acceptance Scenarios**:

1. **Given** the user is on the articles list with at least one article visible, **When** they trigger export and
   choose "CSV", **Then** they receive a CSV file containing one row per exported article with standard bibliographic
   columns.
2. **Given** the user has selected two articles, **When** they trigger export and choose "RIS", **Then** they receive
   one RIS file containing exactly those two records in valid RIS format.
3. **Given** the user triggers export and chooses "Zotero RDF", **Then** they receive an RDF file that can be imported
   into Zotero (or compatible tools) and contains the exported articles.
4. **Given** the user has applied filters so that five articles are visible, **When** they export "current list" without
   selecting rows, **Then** the export includes exactly those five articles.

---

### User Story 2 - Export article metadata plus main PDFs only (Priority: P2)

A user wants to take a copy of the article metadata plus only the main PDF file for each article (e.g. the primary
full-text). They choose to include "main files only" and get a single export package: the chosen metadata file(s) (
CSV/RIS/RDF) plus one PDF per article where a main file exists, in a flat structure (e.g. one folder with all metadata
files and all main PDFs).

**Why this priority**: Covers the common case of "metadata + main PDF" without folder-per-article complexity.

**Independent Test**: User exports with "Include files: Main files only" and receives a download containing the metadata
file(s) and one PDF per article (when available), with no subfolders per article.

**Acceptance Scenarios**:

1. **Given** the user has chosen to export three articles and "Include files: Main files only", **When** two of them
   have a main PDF and one does not, **Then** the export contains the metadata file(s) plus two PDF files (and the third
   article appears only in the metadata).
2. **Given** the user exports with "Main files only" and no article has a main PDF, **When** export completes, **Then**
   they receive only the metadata file(s) with no error.

---

### User Story 3 - Export all files with folder per article (Priority: P3)

A user wants a full backup or transfer package: metadata plus every file attached to each article (main and
supplementary). When they choose "all files", the system creates one subfolder per article inside the export folder.
Each subfolder contains the metadata export (CSV, RIS, or RDF) for that article plus all associated files (e.g. main
PDF, supplements), so each article is self-contained.

**Why this priority**: Enables full per-article packages for backup or sharing; builds on P1 and P2.

**Independent Test**: User exports with "Include files: All files" and receives a root export folder containing one
subfolder per article; each subfolder contains the chosen metadata format(s) for that article and all of that article's
files.

**Acceptance Scenarios**:

1. **Given** the user exports five articles with "All files" and CSV format, **When** export completes, **Then** the
   export folder contains five subfolders named with article id and sanitized title, each containing one CSV for that
   article and all files linked to that article.
2. **Given** one article has a main PDF and two supplementary files, **When** export is "All files", **Then** that
   article's subfolder contains the metadata file plus three files (main + two supplements).
3. **Given** the user exports with "All files" and multiple metadata formats (e.g. CSV and RIS), **When** export
   completes, **Then** each article subfolder contains both format files plus the same set of attached files.

---

### Edge Cases

- When the list is empty or no articles match the current filters (or no articles are selected when "selected only" is
  used), export is disabled (e.g. export trigger disabled or submit disabled in the dialog) so the user cannot start an
  export with zero articles.
- When the user exports a large number of articles (e.g. hundreds) with "All files", the system imposes no hard limit;
  it provides progress feedback and allows cancellation. The export may run asynchronously, and the user is notified
  when the download is ready.
- When an article has no main file and the user chose "Main files only", the article appears only in the metadata
  export; no placeholder or error is required for the missing PDF.
- When a linked file (e.g. PDF) cannot be retrieved (e.g. missing or inaccessible), the export completes for the rest;
  the user is informed via a brief summary in the UI and a list of skipped files inside the package (e.g. README or
  manifest).
- Special characters in article titles or filenames are handled so that generated folder names and file names remain
  valid and non-duplicated (e.g. sanitized or id-based names where needed).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow the user to export the current visible (filtered) list of articles or only the
  selected articles, with the choice explicit in the export flow. When the user has not selected any articles, the
  default MUST be "current list" (all visible articles).
- **FR-002**: The system MUST support exporting article metadata in at least three formats: CSV, RIS, and Zotero RDF (
  user may choose one or more per export).
- **FR-003**: Exported metadata MUST include for each article: title, authors, publication year, journal title, DOI,
  PMID (if present), keywords, and abstract.
- **FR-004**: The system MUST offer an option to include or exclude linked files (PDFs and other attachments) in the
  export.
- **FR-005**: When including files, the system MUST offer two modes: "main files only" (one primary file per article,
  e.g. main PDF) and "all files" (every file linked to each article).
- **FR-006**: When "main files only" is selected, the export MUST produce a single logical package (e.g. one folder)
  containing the metadata file(s) and one file per article where a main file exists.
- **FR-007**: When "all files" is selected, the export MUST produce one subfolder per article inside the export
  destination; each subfolder MUST be named with article id and sanitized title (e.g. "id_sanitized_title") and MUST
  contain the metadata file(s) for that article and all files linked to that article.
- **FR-008**: The user MUST be able to trigger export from the articles list (e.g. toolbar or bulk actions) and
  configure format(s), file scope (none / main only / all), and scope of articles (current list vs selected) before
  starting the export.
- **FR-009**: The system MUST provide clear feedback during export (e.g. progress or "Preparing download…") and a clear
  outcome (success with download, or failure with an understandable message). For long-running exports, the system MAY
  run the export asynchronously and MUST notify the user when the download is ready; the notification MUST include a
  one-time download link or button so the user can start the download.
- **FR-010**: If some linked files cannot be included (e.g. missing or inaccessible), the system MUST still complete the
  export for the rest and inform the user which items or files were skipped in both ways: a brief summary in the UI (
  e.g. after export completes) and a list inside the package (e.g. README or manifest file).

### Key Entities

- **Article**: A bibliographic record with metadata (title, authors, year, journal, DOI, PMID, keywords, abstract) and
  optional linked files.
- **Article file**: A file attached to an article, with a role (e.g. main full-text vs supplementary). One file per
  article may be designated as the "main" file.
- **Export package**: The deliverable of an export: one or more metadata files (CSV, RIS, RDF) and optionally linked
  files, structured either as a single folder (main files only) or as a folder per article (all files).

## Assumptions

- Export is initiated from the articles list UI; the exact placement (e.g. new toolbar button, dropdown, or dedicated
  export component) is left to design/implementation.
- "Current list" means the articles currently visible after filters and search; "selected" means the set of articles the
  user has selected via checkboxes. When no articles are selected, the export scope defaults to "current list".
- CSV column set is fixed for the feature (e.g. one column per metadata field); exact column order and headers can
  follow a standard (e.g. common reference-manager CSV conventions).
- RIS and Zotero RDF outputs conform to widely used specifications so that standard tools (EndNote, Zotero, Mendeley,
  etc.) can import them.
- In "all files" mode, each article subfolder is named with article id and sanitized title (e.g. "id_sanitized_title")
  for uniqueness and readability. Other file naming uses sanitization or id where needed to avoid invalid characters and
  collisions.
- Large exports may be delivered as a single archive (e.g. ZIP) for convenience; the internal structure (flat vs
  folder-per-article) still follows FR-006 and FR-007. Large or file-inclusive exports may be processed asynchronously;
  when ready, the user is notified and the notification includes a one-time download link or button to start the
  download.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can export the visible or selected articles in at least one of CSV, RIS, or Zotero RDF and open the
  result in a spreadsheet or reference manager without format errors.
- **SC-002**: When "main files only" is chosen, the user receives one package containing metadata file(s) and at most
  one file per article (the main file where it exists).
- **SC-003**: When "all files" is chosen, the user receives a structure where each exported article has its own folder
  containing that article’s metadata export and all of its linked files.
- **SC-004**: Users can complete a metadata-only export (no files) in under 30 seconds for at least 100 articles (from
  trigger to download ready). This target applies to metadata-only export; file-inclusive or async exports are not
  required to meet the 30s limit.
- **SC-005**: If any linked file cannot be included, the user is informed of what was skipped and the rest of the export
  completes successfully.
