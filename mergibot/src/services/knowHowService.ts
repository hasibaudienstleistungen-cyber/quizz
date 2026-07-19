import { parse as parseYaml } from "yaml";
import pdfParse from "pdf-parse";
import { unzipSync, strFromU8 } from "fflate";
import { env } from "../config/env";
import { graphFetch, graphFetchOptional, GRAPH_BASE_URL } from "./graphClient";

/** Ordner, die für Volltextsuche durchsucht werden. Raw/ bewusst ausgeschlossen (unverarbeitete Rohquellen). */
const SEARCHABLE_DIRS = ["Wiki", "Doctrine", "Inbox"];

/** Ordner mit binären E-Books (PDF/EPUB). Werden nicht als Volltext durchsucht (das wäre pro Suche
 * zu teuer), sondern über Datei-/Ordnernamen gefunden; den Volltext holt der Bot bei Bedarf gezielt
 * über read_knowledge_base_file, das PDF/EPUB on-demand in Text umwandelt. */
const EBOOK_DIRS = ["ebooks"];
const EBOOK_EXTENSIONS = [".pdf", ".epub"];

/** Ganze Bücher können Hunderttausende Zeichen haben — zu viel für eine einzelne Tool-Antwort.
 * read_knowledge_base_file gibt den extrahierten Text daher in Abschnitten dieser Größe zurück; der
 * Bot blättert per offset weiter. */
const EBOOK_READ_CHUNK = 100_000;

/** Bündelweise Content-Abrufe während der Suche, statt alle Kandidaten sequenziell zu holen (Graph
 * ist ein HTTP-Roundtrip pro Datei, anders als der frühere lokale fs-Zugriff). */
const SEARCH_CONCURRENCY = 10;

function vaultRootPath(): string {
  if (!env.msVaultPath) {
    throw new Error("MS_VAULT_PATH ist nicht konfiguriert.");
  }
  return env.msVaultPath.replace(/^\/+|\/+$/g, "");
}

/** Verhindert Path-Traversal: lehnt `..`/`.`/leere Segmente explizit ab, statt Graphs eigener
 * root:/{path}:-Adressierung zu vertrauen (die würde `..` serverseitig auflösen wie ein Dateisystem). */
function resolveVaultItemPath(relativePath: string): string {
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === ".." || segment.includes("\0")) {
      throw new Error("Ungültiger Pfad: außerhalb des Vaults.");
    }
  }
  return [vaultRootPath(), ...segments].join("/");
}

function encodeItemPath(itemPath: string): string {
  return itemPath.split("/").map(encodeURIComponent).join("/");
}

function contentUrl(itemPath: string): string {
  return `/me/drive/root:/${encodeItemPath(itemPath)}:/content`;
}

interface GraphDriveItem {
  name: string;
  folder?: unknown;
  file?: unknown;
}

interface GraphChildrenResponse {
  value: GraphDriveItem[];
  "@odata.nextLink"?: string;
}

/** Listet die direkten Kinder eines Ordners. `undefined`, falls der Ordner nicht existiert
 * (z.B. Inbox/ vor der allerersten Notiz, oder ebooks/ bevor das erste Buch abgelegt wurde). */
async function listChildren(itemPath: string): Promise<GraphDriveItem[] | undefined> {
  const items: GraphDriveItem[] = [];
  let next: string | undefined = `/me/drive/root:/${encodeItemPath(itemPath)}:/children?$select=name,folder,file&$top=200`;
  let first = true;

  while (next) {
    const res: Response | undefined = first ? await graphFetchOptional(next) : await graphFetch(next);
    if (!res) return undefined;
    first = false;

    const data = (await res.json()) as GraphChildrenResponse;
    items.push(...data.value);
    const nextLink = data["@odata.nextLink"];
    next = nextLink ? nextLink.replace(GRAPH_BASE_URL, "") : undefined;
  }

  return items;
}

/** Sammelt rekursiv alle Dateipfade unterhalb von `itemPath`, die `matches(name)` erfüllen. */
async function listFilesRecursive(
  itemPath: string,
  matches: (name: string) => boolean
): Promise<string[]> {
  const children = await listChildren(itemPath);
  if (!children) return [];

  const results: string[] = [];
  for (const child of children) {
    const childPath = `${itemPath}/${child.name}`;
    if (child.folder) {
      results.push(...(await listFilesRecursive(childPath, matches)));
    } else if (child.file && matches(child.name)) {
      results.push(childPath);
    }
  }
  return results;
}

const isMarkdownFile = (name: string): boolean => name.toLowerCase().endsWith(".md");
const isEbookFile = (name: string): boolean =>
  EBOOK_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

async function itemExists(itemPath: string): Promise<boolean> {
  const res = await graphFetchOptional(`/me/drive/root:/${encodeItemPath(itemPath)}:?$select=name`);
  return res !== undefined;
}

interface VaultFrontmatter {
  type?: string;
  domain?: string;
  title?: string;
  status?: string;
  updated?: string;
}

/** Liest YAML-Frontmatter (`---\n...\n---`) vom Dateianfang, falls vorhanden. Ältere Vault-Seiten
 * ohne Frontmatter liefern `null` — das ist der Normalfall, kein Fehler. */
function parseFrontmatter(text: string): VaultFrontmatter | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as VaultFrontmatter) : null;
  } catch {
    return null;
  }
}

export interface VaultSearchResult {
  file: string;
  snippet: string;
  meta?: { type?: string; status?: string; updated?: string; title?: string };
}

/** Zerlegt eine Suchanfrage in einzelne Wörter (unicode-fähig, damit Umlaute nicht zerschnitten
 * werden). Mehrwort-Anfragen sollen NICHT als ein starrer Gesamt-Substring behandelt werden — sonst
 * scheitert die Suche schon an minimalen Wortabweichungen (z.B. "Baustofflehre" vs. tatsächlich
 * verwendetem "Baustoffkunde", oder einer anderen Wortstellung). */
function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens));
}

interface VaultCandidate {
  itemPath: string;
  text: string;
  matchedTokens: string[];
  isEbook: boolean;
}

/** Volltextsuche über Wiki/, Doctrine/ und Inbox/: zerlegt die Anfrage in Wörter und bewertet jede
 * Datei danach, wie viele dieser Wörter irgendwo im Text vorkommen (nicht: ob die ganze Anfrage als
 * ein Stück vorkommt) — findet dadurch auch Treffer, bei denen nur ein Teil der Begriffe exakt im
 * Dokument auftaucht. Zusätzlich werden E-Books (PDF/EPUB) in ebooks/ über ihren Datei-/Ordnernamen
 * einbezogen — deren Volltext holt der Bot bei Bedarf über read_knowledge_base_file. Ergebnisse
 * werden nach Trefferanzahl sortiert, beste zuerst. */
export async function searchVault(query: string, maxResults = 8): Promise<VaultSearchResult[]> {
  const root = vaultRootPath();
  const tokens = tokenize(query);
  const lowerQuery = query.toLowerCase();

  const [markdownLists, ebookLists] = await Promise.all([
    Promise.all(SEARCHABLE_DIRS.map((dirName) => listFilesRecursive(`${root}/${dirName}`, isMarkdownFile))),
    Promise.all(EBOOK_DIRS.map((dirName) => listFilesRecursive(`${root}/${dirName}`, isEbookFile))),
  ]);
  const files = markdownLists.flat();
  const ebookFiles = ebookLists.flat();

  const candidates: VaultCandidate[] = [];

  // Markdown-Seiten: Treffer über den Volltext.
  for (let i = 0; i < files.length; i += SEARCH_CONCURRENCY) {
    const batch = files.slice(i, i + SEARCH_CONCURRENCY);
    const contents = await Promise.all(
      batch.map(async (itemPath) => ({
        itemPath,
        text: await (await graphFetch(contentUrl(itemPath))).text(),
      }))
    );

    for (const { itemPath, text } of contents) {
      const lowerText = text.toLowerCase();
      const matchedTokens = tokens.length
        ? tokens.filter((t) => lowerText.includes(t))
        : lowerText.includes(lowerQuery)
          ? [lowerQuery]
          : [];
      if (matchedTokens.length === 0) continue;
      candidates.push({ itemPath, text, matchedTokens, isEbook: false });
    }
  }

  // E-Books: Treffer nur über den relativen Pfad (Datei- und Ordnername, oft der Buchtitel).
  for (const itemPath of ebookFiles) {
    const haystack = itemPath.slice(root.length + 1).toLowerCase();
    const matchedTokens = tokens.length
      ? tokens.filter((t) => haystack.includes(t))
      : haystack.includes(lowerQuery)
        ? [lowerQuery]
        : [];
    if (matchedTokens.length === 0) continue;
    candidates.push({ itemPath, text: "", matchedTokens, isEbook: true });
  }

  candidates.sort((a, b) => b.matchedTokens.length - a.matchedTokens.length);

  return candidates.slice(0, maxResults).map((candidate) => {
    if (candidate.isEbook) {
      return {
        file: candidate.itemPath.slice(root.length + 1),
        snippet:
          "E-Book (PDF/EPUB) — Volltext mit read_knowledge_base_file abrufbar. Große Bücher werden " +
          "abschnittsweise geliefert; für den nächsten Teil erneut mit dem angegebenen offset lesen.",
        meta: { type: "ebook" },
      };
    }

    const { itemPath, text, matchedTokens } = candidate;
    const frontmatter = parseFrontmatter(text);
    const lines = text.split("\n");

    // Snippet um die Zeile mit den meisten Treffern der gefundenen Wörter, statt nur der ersten
    // Zeile mit irgendeinem Treffer.
    let bestLineIndex = 0;
    let bestLineScore = -1;
    lines.forEach((l, idx) => {
      const lowerLine = l.toLowerCase();
      const score = matchedTokens.filter((t) => lowerLine.includes(t)).length;
      if (score > bestLineScore) {
        bestLineScore = score;
        bestLineIndex = idx;
      }
    });

    const snippet = lines
      .slice(Math.max(0, bestLineIndex - 1), bestLineIndex + 2)
      .join("\n")
      .trim();

    return {
      file: itemPath.slice(root.length + 1),
      snippet,
      meta: frontmatter
        ? {
            type: frontmatter.type,
            status: frontmatter.status,
            updated: frontmatter.updated,
            title: frontmatter.title,
          }
        : undefined,
    };
  });
}

/** Extrahiert den Textlayer eines PDFs. Rein-gescannte PDFs ohne Text-Ebene liefern hier leeren
 * Text (kein OCR). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

/** Entfernt HTML/XML-Markup aus einem (X)HTML-Kapitel eines EPUBs und normalisiert Whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Löst einen href relativ zum Verzeichnis der OPF-Datei innerhalb des ZIP auf (inkl. `../`). */
function resolveZipPath(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split("#")[0].split("?")[0]);
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const segment of cleanHref.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/");
}

/** Best-effort-Textextraktion aus einem EPUB (ZIP aus XHTML-Kapiteln): liest die OPF-Spine für die
 * richtige Kapitelreihenfolge; findet sie keine, werden alle (X)HTML-Dateien alphabetisch genommen. */
function extractEpubText(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));

  const readZipFile = (path: string): string | undefined => {
    const direct = files[path];
    if (direct) return strFromU8(direct);
    const decoded = files[decodeURIComponent(path)];
    return decoded ? strFromU8(decoded) : undefined;
  };

  const container = readZipFile("META-INF/container.xml") ?? "";
  const opfPath = container.match(/full-path="([^"]+)"/i)?.[1];

  let orderedPaths: string[] = [];
  if (opfPath) {
    const opf = readZipFile(opfPath) ?? "";
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

    const idToHref: Record<string, string> = {};
    const itemRe = /<item\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(opf)) !== null) {
      const attrs = m[1];
      const id = attrs.match(/\bid\s*=\s*"([^"]+)"/i)?.[1];
      const href = attrs.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1];
      if (id && href) idToHref[id] = href;
    }

    const spineRe = /<itemref\b([^>]*)>/gi;
    while ((m = spineRe.exec(opf)) !== null) {
      const idref = m[1].match(/\bidref\s*=\s*"([^"]+)"/i)?.[1];
      const href = idref ? idToHref[idref] : undefined;
      if (href) orderedPaths.push(resolveZipPath(opfDir, href));
    }
  }

  if (orderedPaths.length === 0) {
    orderedPaths = Object.keys(files)
      .filter((p) => /\.x?html?$/i.test(p))
      .sort();
  }

  const parts: string[] = [];
  for (const path of orderedPaths) {
    const raw = readZipFile(path);
    if (!raw) continue;
    const text = stripHtml(raw);
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

/** Schneidet einen Abschnitt (ab `offset`, Länge EBOOK_READ_CHUNK) aus dem extrahierten Volltext
 * heraus und hängt einen Hinweis an, wie der Bot weiterblättert. */
function sliceEbookText(fullText: string, offset: number, relativePath: string): string {
  const total = fullText.length;
  const start = Math.max(0, Math.min(Math.floor(offset) || 0, total));
  const end = Math.min(start + EBOOK_READ_CHUNK, total);
  const chunk = fullText.slice(start, end);
  const header = `[E-Book: ${relativePath} — Zeichen ${start}–${end} von ${total}]`;
  const more =
    end < total
      ? `\n[Weiterlesen: read_knowledge_base_file mit path="${relativePath}" und offset=${end}]`
      : "";
  return `${header}${more}\n\n${chunk}`;
}

/**
 * Liest eine Datei aus dem Vault. Text-Dateien (.md u.a.) werden direkt zurückgegeben; E-Books
 * (.pdf/.epub) im ebooks/-Ordner werden on-demand in Text umgewandelt und — falls sehr groß —
 * abschnittsweise ab `offset` geliefert.
 */
export async function readVaultFile(relativePath: string, offset = 0): Promise<string> {
  const itemPath = resolveVaultItemPath(relativePath);
  const res = await graphFetchOptional(contentUrl(itemPath));
  if (!res) {
    throw new Error(`Datei nicht gefunden: ${relativePath}`);
  }

  const lower = relativePath.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const isEpub = lower.endsWith(".epub");

  if (isPdf || isEpub) {
    const buffer = Buffer.from(await res.arrayBuffer());
    let fullText: string;
    try {
      fullText = isPdf ? await extractPdfText(buffer) : extractEpubText(buffer);
    } catch (err) {
      return `E-Book konnte nicht in Text umgewandelt werden (${relativePath}): ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
    fullText = fullText.replace(/\r\n/g, "\n").trim();
    if (!fullText) {
      return `E-Book enthält keinen extrahierbaren Text — vermutlich ein gescanntes PDF ohne Text-Ebene/OCR: ${relativePath}`;
    }
    return sliceEbookText(fullText, offset, relativePath);
  }

  return res.text();
}

/** Legt eine neue Schnellnotiz in Inbox/ an (nie Überschreiben bestehender Dateien). */
export async function addInboxNote(content: string, title?: string): Promise<string> {
  const root = vaultRootPath();
  const inboxPath = `${root}/Inbox`;

  const date = new Date().toISOString().slice(0, 10);
  const slug =
    (title ?? "notiz")
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "notiz";

  let filename = `${date} ${slug}.md`;
  let itemPath = `${inboxPath}/${filename}`;
  let counter = 2;
  while (await itemExists(itemPath)) {
    filename = `${date} ${slug}-${counter}.md`;
    itemPath = `${inboxPath}/${filename}`;
    counter++;
  }

  const body = `# ${title ?? "Notiz"}\n\n${content}\n\n---\nQuelle: MergiBot, ${new Date().toISOString()}\n`;
  await graphFetch(contentUrl(itemPath), {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body,
  });

  return itemPath.slice(root.length + 1);
}

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
}

/**
 * Legt ein von Claude vollständig verfasstes Dokument (Zusammenfassung, Formular-Inhalt o.ä.) in
 * Inbox/ ab — genau wie add_inbox_note landet es unverarbeitet zur späteren manuellen Durchsicht/
 * Einsortierung ins Wiki, nie automatisch in Wiki/ oder Doctrine/.
 */
export async function createDocument(title: string, content: string): Promise<string> {
  const root = vaultRootPath();
  const inboxPath = `${root}/Inbox`;

  const date = new Date().toISOString().slice(0, 10);
  const safeTitle = sanitizeFilename(title) || "Dokument";
  let filename = `${date} ${safeTitle}.md`;
  let itemPath = `${inboxPath}/${filename}`;
  let counter = 2;
  while (await itemExists(itemPath)) {
    filename = `${date} ${safeTitle}-${counter}.md`;
    itemPath = `${inboxPath}/${filename}`;
    counter++;
  }

  const body = `${content.trim()}\n\n---\nQuelle: MergiBot, ${new Date().toISOString()}\n`;
  await graphFetch(contentUrl(itemPath), {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body,
  });

  return itemPath.slice(root.length + 1);
}
