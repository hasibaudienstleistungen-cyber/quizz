# MergiBot — E-Book-Abruf (Änderungs-Record)

Dieser Ordner spiegelt die Dateien, die im OneDrive-Projekt
`Dev Projects/MergiBot` geändert wurden, um E-Books (PDF/EPUB) aus dem
Know-How-Vault (`Dev Projects/Know How/ebooks/`) über MergiBot vollständig
abrufbar zu machen. Der lauffähige Code liegt in OneDrive, nicht in diesem
Repo — hier dient er nur als versionierter, diffbarer Nachweis der Änderung.

## Geänderte/neue Dateien

- `src/services/knowHowService.ts` — ebooks/-Ordner in die Suche aufgenommen
  (Namensmatch) und `readVaultFile` erweitert: PDF/EPUB werden on-demand in
  Text umgewandelt und bei großen Büchern abschnittsweise (per `offset`)
  geliefert. Neue Helfer: `extractPdfText`, `extractEpubText`, `stripHtml`,
  `resolveZipPath`, `sliceEbookText`, `listFilesRecursive`.
- `src/tools/knowHowTool.ts` — Tool-Beschreibungen aktualisiert;
  `read_knowledge_base_file` um optionalen `offset`-Parameter erweitert.
- `package.json` — neue Abhängigkeiten `pdf-parse`, `fflate` und
  `@types/pdf-parse`.
- `EBOOKS.md` — Kurzdoku des Features + Einrichtungsschritte.

Siehe `EBOOKS.md` für die einmaligen Schritte (`npm install`, Redeploy).
