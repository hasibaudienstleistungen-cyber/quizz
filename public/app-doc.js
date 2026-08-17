/* ===========================================================================
 * app-doc.js – PDF-Erzeugung & Dokumentkopf für die Fotodokumentation
 * Reine, global verfügbare Funktionen (kein Modulsystem), damit sie sowohl
 * im Server-Frontend als auch im eingebetteten Artifact laufen.
 *
 * Öffentliche API:
 *   window.buildMetaPanel(meta, onChange)  -> DOM-Element (Dokumentkopf-Editor)
 *   window.generateFotoPdf(meta, photos, sectionMeta) -> Promise<Blob>
 *   window.pdfFilename(meta) -> string
 *   window.deliverPdf(blob, filename, statusEl) -> Promise<string>
 * =========================================================================== */
(function () {
  'use strict';

  var GREY = [110, 110, 105];
  var DARK = [42, 42, 40];
  var BORDER = [206, 204, 199];

  // ---- Dokumentkopf-Editor -------------------------------------------------
  var META_FIELDS = [
    ['titel', 'Titel'],
    ['firma', 'Firma (Kopf & Fuss)'],
    ['projektTitel', 'Projekt'],
    ['thema', 'Thema'],
    ['datum', 'Datum'],
    ['aufgenommenDurch', 'Aufgenommen durch'],
  ];

  window.META_DEFAULTS = {
    titel: 'Fotodokumentation',
    firma: 'Schärli Architektur AG',
    projektTitel: '1452.0 Neubau Wohnhaus Leumattstrasse 33, Luzern',
    thema: 'Zustandsdokumentation Bestand / Umgebung vor Baubeginn',
    datum: '3. – 16. August 2026',
    aufgenommenDurch: 'meha',
  };

  window.buildMetaPanel = function (meta, onChange) {
    var panel = document.createElement('div');
    panel.className = 'section-block';
    panel.id = 'metaPanel';

    var head = document.createElement('div');
    head.className = 'section-header';
    head.style.marginBottom = '8px';
    head.innerHTML = '<span style="font-weight:600;font-size:15px;">📝 Dokumentkopf</span>' +
      '<span class="sec-num">erscheint in der PDF-Kopf- und Fusszeile</span>';
    panel.appendChild(head);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:170px 1fr; gap:8px 12px; align-items:center;';
    META_FIELDS.forEach(function (f) {
      var key = f[0], label = f[1];
      var l = document.createElement('label');
      l.textContent = label;
      l.style.cssText = 'font-size:13px; color:var(--muted);';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = meta[key] || '';
      inp.style.cssText = 'width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:6px; font:inherit;';
      inp.addEventListener('input', function (e) { meta[key] = e.target.value; if (onChange) onChange(); });
      grid.appendChild(l);
      grid.appendChild(inp);
    });
    panel.appendChild(grid);
    return panel;
  };

  // ---- Hilfsfunktionen -----------------------------------------------------
  function setStyle(doc, style) {
    if (style === 'B') doc.setFont('helvetica', 'bold');
    else if (style === 'I') doc.setFont('helvetica', 'italic');
    else doc.setFont('helvetica', 'normal');
  }

  // Umbruch für "Bild N: <caption>": Label fett, Text kursiv, Folgezeilen linksbündig.
  function wrapLabelCaption(doc, label, caption, maxW, fontSize) {
    doc.setFontSize(fontSize);
    var words = (caption || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var line = [];
    var lineW = 0;

    setStyle(doc, 'B');
    lineW = doc.getTextWidth(label);
    line.push({ text: label, style: 'B' });

    setStyle(doc, 'I');
    for (var i = 0; i < words.length; i++) {
      var token = words[i] + (i < words.length - 1 ? ' ' : '');
      var tw = doc.getTextWidth(token);
      if (lineW + tw > maxW && line.length > 0) {
        lines.push(line);
        line = [{ text: token, style: 'I' }];
        lineW = tw;
      } else {
        line.push({ text: token, style: 'I' });
        lineW += tw;
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  function drawLines(doc, lines, x, y, lh, fontSize) {
    doc.setFontSize(fontSize);
    for (var i = 0; i < lines.length; i++) {
      var segs = lines[i];
      var cx = x;
      var yy = y + i * lh;
      for (var j = 0; j < segs.length; j++) {
        var s = segs[j];
        setStyle(doc, s.style);
        if (s.style === 'B') doc.setTextColor(DARK[0], DARK[1], DARK[2]);
        else doc.setTextColor(GREY[0], GREY[1], GREY[2]);
        doc.text(s.text, cx, yy);
        cx += doc.getTextWidth(s.text);
      }
    }
  }

  // ---- PDF-Erzeugung -------------------------------------------------------
  window.generateFotoPdf = function (meta, photos, sectionMeta) {
    return new Promise(function (resolve, reject) {
      try {
        var jsPDFctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDFctor) { reject(new Error('jsPDF nicht geladen')); return; }

        var doc = new jsPDFctor({ unit: 'pt', format: 'a4', compress: true });
        var PW = doc.internal.pageSize.getWidth();
        var PH = doc.internal.pageSize.getHeight();
        var M = 42;
        var contentW = PW - 2 * M;
        var footerY = PH - 30;
        var bottomLimit = PH - 48;
        var y = M;

        function newPage() { doc.addPage(); y = M; }
        function ensure(space) { if (y + space > bottomLimit) newPage(); }

        // ---- Kopf ----
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        doc.setTextColor(GREY[0], GREY[1], GREY[2]);
        doc.text(meta.titel || 'Fotodokumentation', M, y + 6);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
        doc.text(meta.firma || '', PW - M, y + 4, { align: 'right' });
        y += 20;

        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        doc.setTextColor(GREY[0], GREY[1], GREY[2]);
        var subLines = doc.splitTextToSize(meta.projektTitel || '', contentW);
        doc.text(subLines, M, y + 4);
        y += subLines.length * 11 + 6;

        doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(0.6);
        doc.line(M, y, PW - M, y); y += 16;

        // ---- Metablock ----
        function labelValue(label, value, x, yy) {
          doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK[0], DARK[1], DARK[2]);
          doc.setFontSize(10.5);
          doc.text(label, x, yy);
          var lw = doc.getTextWidth(label);
          doc.setFont('helvetica', 'normal');
          var v = ' ' + (value || '');
          doc.text(v, x + lw, yy);
          return lw + doc.getTextWidth(v);
        }
        labelValue('Projekt:', meta.projektTitel, M, y); y += 15;
        labelValue('Thema:', meta.thema, M, y); y += 15;
        var usedW = labelValue('Datum:', meta.datum, M, y);
        labelValue('Aufgenommen durch:', meta.aufgenommenDurch, M + usedW + 26, y);
        y += 22;

        // ---- Kapitel & Bilder ----
        var sections = sectionMeta.filter(function (s) { return !s.removed; })
          .sort(function (a, b) { return a.nr - b.nr; });
        var gap = 16;
        var colW = (contentW - gap) / 2;
        var bildNr = 0;

        sections.forEach(function (sec) {
          var items = photos.filter(function (p) { return p.section === sec.nr && !p.removed; });
          if (items.length === 0) return;

          ensure(70);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
          doc.setTextColor(DARK[0], DARK[1], DARK[2]);
          doc.text(sec.nr + '. ' + (sec.title || ''), M, y);
          y += 16;

          if (sec.beschreibung && sec.beschreibung.trim()) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            doc.setTextColor(DARK[0], DARK[1], DARK[2]);
            var dl = doc.splitTextToSize(sec.beschreibung.trim(), contentW);
            ensure(dl.length * 13 + 6);
            doc.text(dl, M, y);
            y += dl.length * 13 + 4;
          }
          y += 4;

          for (var i = 0; i < items.length; i += 2) {
            var rowItems = items.slice(i, i + 2);
            var cells = rowItems.map(function (p, idx) {
              var x = M + idx * (colW + gap);
              var props;
              try { props = doc.getImageProperties(p.thumb); } catch (e) { props = { width: 4, height: 3 }; }
              var iw = colW, ih = colW * (props.height / props.width);
              var maxIh = 300;
              if (ih > maxIh) { ih = maxIh; iw = maxIh * (props.width / props.height); }
              return { p: p, x: x, iw: iw, ih: ih, imgX: x + (colW - iw) / 2 };
            });
            cells.forEach(function (c) { c.nr = ++bildNr; });
            cells.forEach(function (c) {
              c.capLines = wrapLabelCaption(doc, 'Bild ' + c.nr + ': ', c.p.caption || '', colW, 9.5);
            });
            var capLH = 12;
            var rowH = 0;
            cells.forEach(function (c) {
              var h = c.ih + 12 + c.capLines.length * capLH;
              if (h > rowH) rowH = h;
            });
            rowH += 12;
            ensure(rowH);

            var rowTop = y;
            cells.forEach(function (c) {
              try { doc.addImage(c.p.thumb, 'JPEG', c.imgX, rowTop, c.iw, c.ih); } catch (e) {}
              doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(0.6);
              doc.rect(c.imgX, rowTop, c.iw, c.ih);
              drawLines(doc, c.capLines, c.x, rowTop + c.ih + 12, capLH, 9.5);
            });
            y = rowTop + rowH;
          }
          y += 8;
        });

        // ---- Fusszeile + automatische Seitenzahlen ----
        var total = doc.getNumberOfPages();
        var footerLeft = [meta.firma, meta.aufgenommenDurch].filter(Boolean).join(', ');
        for (var pnr = 1; pnr <= total; pnr++) {
          doc.setPage(pnr);
          doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(0.6);
          doc.line(M, footerY - 10, PW - M, footerY - 10);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
          doc.setTextColor(GREY[0], GREY[1], GREY[2]);
          doc.text(footerLeft, M, footerY);
          doc.text('Seite ' + pnr, PW - M, footerY, { align: 'right' });
        }

        resolve(doc.output('blob'));
      } catch (err) {
        reject(err);
      }
    });
  };

  window.pdfFilename = function (meta) {
    var base = (meta.projektTitel || meta.titel || 'Fotodokumentation')
      .replace(/[^\w\-. äöüÄÖÜ]+/g, '')
      .trim().replace(/\s+/g, '_').slice(0, 80) || 'Fotodokumentation';
    return base + '.pdf';
  };

  // ---- Auslieferung (umgebungsabhängig) -----------------------------------
  window.deliverPdf = function (blob, filename) {
    // Installierte/lokale App: direkter Download funktioniert.
    if (!(window.claude && typeof window.claude.use === 'function')) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 6000);
      return Promise.resolve('downloaded');
    }
    // Artifact-Vorschau: Download-Fähigkeit versuchen, sonst eingebettete Ansicht.
    return window.claude.use('downloads').then(function (downloads) {
      if (!downloads) { showPdfPreview(blob, filename); return 'preview'; }
      return downloads.save({ filename: filename, data: blob })
        .then(function () { return 'saved'; })
        .catch(function (e) {
          if (e && e.code === 'declined') return 'declined';
          showPdfPreview(blob, filename);
          return 'preview';
        });
    }).catch(function () { showPdfPreview(blob, filename); return 'preview'; });
  };

  function showPdfPreview(blob, filename) {
    var url = URL.createObjectURL(blob);
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.style.display = 'flex';
    var box = document.createElement('div');
    box.className = 'modal';
    box.style.cssText = 'max-width:900px; width:94vw; height:90vh; display:flex; flex-direction:column;';
    box.innerHTML =
      '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">' +
      '<h2 style="margin:0; flex:1;">PDF-Vorschau</h2>' +
      '<button id="pdfPreviewOpen">In neuem Tab öffnen</button>' +
      '<button id="pdfPreviewClose">Schliessen</button></div>' +
      '<p class="sub" style="margin:0 0 8px;">In der Vorschau ist kein direkter Datei-Download möglich. ' +
      'Zum Speichern das Download-/Drucksymbol in der PDF-Ansicht unten nutzen oder „In neuem Tab öffnen". ' +
      'In der installierten App wird die Datei direkt gespeichert.</p>';
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.style.cssText = 'flex:1; width:100%; border:1px solid var(--border); border-radius:8px; background:#fff;';
    box.appendChild(frame);
    bg.appendChild(box);
    document.body.appendChild(bg);
    function close() {
      bg.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    box.querySelector('#pdfPreviewClose').addEventListener('click', close);
    var openBtn = box.querySelector('#pdfPreviewOpen');
    if (openBtn) openBtn.addEventListener('click', function () { window.open(url, '_blank'); });
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
  }
})();
