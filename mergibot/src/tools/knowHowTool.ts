import { searchVault, readVaultFile, addInboxNote, createDocument } from "../services/knowHowService";
import type { ToolDefinition } from "./types";

interface SearchInput {
  query: string;
}

export const searchKnowHowTool: ToolDefinition<SearchInput> = {
  name: "search_knowledge_base",
  description:
    "Durchsucht das persönliche Wissensnetzwerk (Obsidian-Vault 'Know How': Wiki/Concepts, " +
    "Wiki/Entities, Wiki/Summaries, Doctrine, Inbox) nach einem Suchbegriff. Bezieht zusätzlich " +
    "E-Books (PDF/EPUB) im Ordner 'ebooks/' mit ein — diese werden über ihren Titel/Dateinamen " +
    "gefunden (nicht über den Volltext); den vollständigen Buchtext holst du danach mit " +
    "read_knowledge_base_file. Nutze dies, wenn der Nutzer nach Informationen fragt, die in seinem " +
    "Second Brain dokumentiert sein könnten. ACHTUNG: zeigt pro Datei nur einen kurzen Ausschnitt um " +
    "die ERSTE Fundstelle — wenn der gesuchte Inhalt weiter unten in der Datei stehen könnte oder der " +
    "Ausschnitt nicht eindeutig genug ist, IMMER zusätzlich read_knowledge_base_file für die " +
    "komplette Datei aufrufen, statt aus einem unvollständigen Ausschnitt zu schließen, es gebe nichts " +
    "Relevantes.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Suchbegriff (Stichwort, Name, Thema)." },
    },
    required: ["query"],
  },
  execute: async (input) => {
    const results = await searchVault(input.query);
    if (results.length === 0) return "Keine Treffer im Wissensnetzwerk gefunden.";
    return results
      .map((r) => {
        const metaParts = [
          r.meta?.type && `Typ: ${r.meta.type}`,
          r.meta?.status && `Status: ${r.meta.status}`,
          r.meta?.updated && `Aktualisiert: ${r.meta.updated}`,
        ].filter(Boolean);
        const metaLine = metaParts.length ? ` (${metaParts.join(" · ")})` : "";
        return `[${r.file}]${metaLine}\n${r.snippet}`;
      })
      .join("\n\n");
  },
};

interface ReadFileInput {
  path: string;
  offset?: number;
}

export const readKnowHowFileTool: ToolDefinition<ReadFileInput> = {
  name: "read_knowledge_base_file",
  description:
    "Liest eine bestimmte Seite/Datei aus dem Wissensnetzwerk vollständig (Pfad relativ zum Vault, " +
    "z.B. 'Wiki/Concepts/Heimkino Projekt.md' — aus den Ergebnissen von search_knowledge_base). " +
    "Liest auch E-Books im Ordner 'ebooks/' (PDF/EPUB): diese werden automatisch in Text " +
    "umgewandelt. Sehr große E-Books werden in Abschnitten zu je ~100'000 Zeichen zurückgegeben — " +
    "das Ergebnis nennt am Anfang den offset für den nächsten Abschnitt; ruf das Tool dann erneut " +
    "mit genau diesem offset auf, bis das Buch vollständig gelesen ist.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relativer Pfad zur Datei innerhalb des Vaults." },
      offset: {
        type: "number",
        description:
          "Nur für große E-Books: Zeichen-Startposition (Standard 0). Für Folgeabschnitte den im " +
          "vorherigen Ergebnis genannten offset-Wert verwenden.",
      },
    },
    required: ["path"],
  },
  execute: async (input) => readVaultFile(input.path, input.offset ?? 0),
};

interface AddNoteInput {
  content: string;
  title?: string;
}

export const addInboxNoteTool: ToolDefinition<AddNoteInput> = {
  name: "add_inbox_note",
  description:
    "Legt eine neue Schnellnotiz in Inbox/ des Wissensnetzwerks an (unverarbeiteter Rohgedanke, " +
    "wird später manuell einsortiert). Nutze dies, wenn der Nutzer etwas 'in seinem Second Brain', " +
    "'im Wiki' oder 'im Know-How' festhalten möchte. Überschreibt nie bestehende Seiten.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Kurzer Titel der Notiz (optional)." },
      content: { type: "string", description: "Inhalt der Notiz." },
    },
    required: ["content"],
  },
  execute: async (input) => {
    const relativePath = await addInboxNote(input.content, input.title);
    return `Notiz angelegt: ${relativePath}`;
  },
};

interface CreateDocumentInput {
  title: string;
  content: string;
}

export const createVaultDocumentTool: ToolDefinition<CreateDocumentInput> = {
  name: "create_vault_document",
  description:
    "Erstellt ein vollständiges Dokument (Zusammenfassung, Formular-Inhalt o.ä.) aus einem Auftrag " +
    "und legt es in Inbox/ des Wissensnetzwerks ab. Du (Claude) schreibst den kompletten " +
    "Markdown-Inhalt selbst. Landet wie jede Inbox-Notiz unverarbeitet dort — wird NIE automatisch " +
    "in Wiki/Concepts, Wiki/Entities, Wiki/Summaries oder Doctrine einsortiert, das bleibt manuelle " +
    "Kuratierung durch den Nutzer.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Titel des Dokuments (wird zum Dateinamen)." },
      content: { type: "string", description: "Vollständiger Markdown-Inhalt des Dokuments." },
    },
    required: ["title", "content"],
  },
  execute: async (input) => {
    const relativePath = await createDocument(input.title, input.content);
    return `Dokument in Inbox abgelegt: ${relativePath}`;
  },
};
