# E-Books im Know-How-Vault (PDF/EPUB) über MergiBot abrufbar

MergiBot kann jetzt E-Books aus dem Vault-Ordner **`ebooks/`** (relativ zu `MS_VAULT_PATH`,
also `Dev Projects/Know How/ebooks`) vollständig abrufen. Bisher las der Bot nur Markdown aus
`Wiki/`, `Doctrine/` und `Inbox/`.

## Wie es funktioniert

- **Ablegen**: E-Books als `.pdf` oder `.epub` in `Know How/ebooks/` legen (Unterordner sind
  erlaubt, werden rekursiv gefunden). Am besten sprechende Dateinamen mit Titel/Autor, denn die
  Suche findet Bücher über den Datei-/Ordnernamen.
- **Finden** (`search_knowledge_base`): E-Books werden zusätzlich zu den Markdown-Seiten
  durchsucht — allerdings über den **Datei-/Ordnernamen** (Buchtitel), nicht über den Volltext.
  Volltextsuche pro Anfrage über alle Bücher wäre zu teuer/langsam.
- **Lesen** (`read_knowledge_base_file`): Beim Lesen einer `.pdf`/`.epub`-Datei wird der Text
  **on-demand** extrahiert (PDF-Textlayer bzw. EPUB-XHTML-Kapitel). Große Bücher werden in
  Abschnitten zu je ~100'000 Zeichen geliefert; das Ergebnis nennt am Anfang den `offset` für den
  nächsten Abschnitt, mit dem der Bot weiterblättert, bis das Buch vollständig gelesen ist.

## Grenzen

- **Gescannte PDFs ohne Text-Ebene** (reine Bilder) liefern keinen Text — es findet **kein OCR**
  statt. Der Bot meldet das klar zurück.
- EPUB-Extraktion ist best-effort (liest die OPF-Spine für die Kapitelreihenfolge, sonst alle
  XHTML-Dateien alphabetisch). Formatierung/Tabellen gehen dabei verloren, der Fließtext bleibt.
- `ebooks/` wird bewusst **nicht** in die Markdown-Volltextsuche aufgenommen — nur Namensmatch in
  der Suche, Volltext erst beim gezielten Lesen.

## Einmalige Schritte nach diesem Update

Es kamen zwei neue Laufzeit-Abhängigkeiten dazu (`pdf-parse`, `fflate`) plus Typen
(`@types/pdf-parse`). Damit der Bot startet/baut:

```bash
npm install
npm run dev      # lokal testen
# bzw. für Produktion:
npm run build && npm start
# Railway: neu deployen (railway up)
```

Kein neuer Microsoft-Graph-Scope nötig — der bestehende `Files.ReadWrite` deckt das Lesen der
E-Books mit ab.
