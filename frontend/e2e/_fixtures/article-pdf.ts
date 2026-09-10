import { loadE2EEnv } from "./env";

/**
 * A structurally-valid PDF (correct xref offsets) whose pages each print
 * "Page N" — built inline, yet real enough for pdf.js to parse and render.
 * Sizes are PDF points; the default is a single 200×200 page.
 */
export function pdfBytes({
  pages = 1,
  width = 200,
  height = 200,
}: { pages?: number; width?: number; height?: number } = {}): Uint8Array<ArrayBuffer> {
  // Objects 1-3 are the catalog, page tree and font; then a page and its
  // content stream per page, so page n is object 2n+2.
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const fontSize = Math.round(width / 6);
  for (let n = 1; n <= pages; n++) {
    const content = `BT /F1 ${fontSize} Tf ${fontSize} ${Math.round(height / 2)} Td (Page ${n}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  const size = objects.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body + xref + trailer);
}

/** Storage key (bucket `articles`) that the fixture article's MAIN `article_files` row points at. */
export function fixtureArticlePdfKey(articleId: string): string {
  return `e2e-fixtures/${articleId}.pdf`;
}

/**
 * Idempotently ensure the fixture article's MAIN file has real PDF bytes
 * behind it — the shared E2E fixture provisioner creates the `article_files`
 * row but never uploads the object. Upserts, so specs running in parallel
 * can both find it missing without the second upload failing as a duplicate.
 */
export async function ensureArticlePdfBytes(): Promise<void> {
  const env = loadE2EEnv();
  const base = env.supabaseUrl!;
  const key = env.supabaseServiceRoleKey!;
  const objectPath = fixtureArticlePdfKey(env.articleId!);
  const fileName = objectPath.split("/").pop()!;

  const existing = await fetch(`${base}/storage/v1/object/list/articles`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "e2e-fixtures/", search: fileName }),
  });
  const found = existing.ok ? ((await existing.json()) as Array<{ name: string }>) : [];
  if (found.some((f) => f.name === fileName)) return;

  const uploadRes = await fetch(`${base}/storage/v1/object/articles/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: pdfBytes(),
  });
  if (!uploadRes.ok) {
    throw new Error(`ensureArticlePdfBytes upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
}
