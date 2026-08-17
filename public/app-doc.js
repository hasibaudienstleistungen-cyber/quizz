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

  // ---- In-App-Dialoge (native prompt/confirm/alert sind in der Vorschau gesperrt)
  function makeModal(message, withInput, defaultValue, okLabel, danger) {
    return new Promise(function (resolve) {
      var bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.style.display = 'flex';
      var box = document.createElement('div');
      box.className = 'modal';
      box.style.maxWidth = '420px';
      var h = document.createElement('h2');
      h.style.marginTop = '0';
      h.textContent = message;
      box.appendChild(h);

      var input = null;
      if (withInput) {
        input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue || '';
        input.style.cssText = 'width:100%; padding:8px; border:1px solid var(--border); border-radius:8px; font:inherit;';
        box.appendChild(input);
      }

      var row = document.createElement('div');
      row.style.cssText = 'margin-top:14px; display:flex; gap:8px; justify-content:flex-end;';
      var cancel = document.createElement('button');
      cancel.textContent = 'Abbrechen';
      var ok = document.createElement('button');
      ok.className = 'primary';
      ok.textContent = okLabel || 'OK';
      if (danger) { ok.style.background = 'var(--danger)'; ok.style.borderColor = 'var(--danger)'; }

      function done(v) { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) {
        if (e.key === 'Escape') done(withInput ? null : false);
        else if (e.key === 'Enter') done(withInput ? (input ? input.value : '') : true);
      }
      cancel.addEventListener('click', function () { done(withInput ? null : false); });
      ok.addEventListener('click', function () { done(withInput ? (input ? input.value : '') : true); });
      bg.addEventListener('click', function (e) { if (e.target === bg) done(withInput ? null : false); });
      document.addEventListener('keydown', onKey);

      // Nur Abbrechen anzeigen, wenn es etwas abzubrechen gibt.
      if (okLabel === 'nur-ok') { ok.textContent = 'OK'; } else { row.appendChild(cancel); }
      row.appendChild(ok);
      box.appendChild(row);
      bg.appendChild(box);
      document.body.appendChild(bg);
      if (input) setTimeout(function () { input.focus(); input.select(); }, 30);
      else setTimeout(function () { ok.focus(); }, 30);
    });
  }
  // Gibt eingegebenen Text oder null (Abbruch) zurück.
  window.uiPrompt = function (message, defaultValue) { return makeModal(message, true, defaultValue, 'OK', false); };
  // Gibt true/false zurück.
  window.uiConfirm = function (message, danger) { return makeModal(message, false, null, 'Ja', danger !== false); };
  // Nur Hinweis mit OK.
  window.uiAlert = function (message) { return makeModal(message, false, null, 'nur-ok', false); };

  // ---- Projekt-Leiste ------------------------------------------------------
  // state: { projects:[{id,name}], activeId }
  // handlers: { onSwitch(id), onNew(), onRename(), onDelete() }
  window.buildProjectBar = function (state, handlers) {
    var bar = document.createElement('div');
    bar.className = 'section-block';
    bar.id = 'projectBar';
    bar.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';

    var label = document.createElement('span');
    label.textContent = '📁 Projekt:';
    label.style.cssText = 'font-weight:600;';

    var select = document.createElement('select');
    select.style.cssText = 'font:inherit; padding:6px 8px; border:1px solid var(--border); border-radius:8px; min-width:220px; flex:1; max-width:460px;';
    state.projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name || '(ohne Name)';
      if (p.id === state.activeId) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function (e) { handlers.onSwitch(e.target.value); });

    function mkBtn(txt, fn, primary) {
      var b = document.createElement('button');
      b.textContent = txt;
      if (primary) b.className = 'primary';
      b.style.fontSize = '13px';
      b.addEventListener('click', fn);
      return b;
    }

    bar.appendChild(label);
    bar.appendChild(select);
    bar.appendChild(mkBtn('＋ Neues Projekt', handlers.onNew, true));
    bar.appendChild(mkBtn('✎ Umbenennen', handlers.onRename));
    bar.appendChild(mkBtn('🗑 Löschen', handlers.onDelete));
    return bar;
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
    var inArtifact = !!(window.claude && typeof window.claude.use === 'function');

    // Installierte/lokale App (kein Capability-Runtime): direkter Download.
    if (!inArtifact) {
      var url = URL.createObjectURL(blob);
      try {
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) {}
      setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
      return Promise.resolve('downloaded');
    }

    // Artifact-Vorschau: erst echten Datei-Download versuchen; wird das Format
    // abgelehnt, den PDF-Dialog anzeigen (öffnet das PDF in einem echten Tab).
    return window.claude.use('downloads').then(function (downloads) {
      if (!downloads) return openPdfDialog(blob, filename, null);
      return downloads.save({ filename: filename, data: blob })
        .then(function () { return 'saved'; })
        .catch(function (e) {
          if (e && e.code === 'declined') return 'declined';
          return openPdfDialog(blob, filename, downloads);
        });
    }).catch(function () { return openPdfDialog(blob, filename, null); });
  };

  function blobToDataURL(blob) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { resolve(null); };
      r.readAsDataURL(blob);
    });
  }

  // Öffnet das fertige PDF in einem echten Browser-Tab (dort gibt es die native
  // Download-/Druck-Funktion). Zusätzlich ein garantierter HTML-Fallback über die
  // downloads-Fähigkeit, falls Popups blockiert sind.
  function openPdfDialog(blob, filename, downloads) {
    return blobToDataURL(blob).then(function (dataUri) {
      var bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.style.display = 'flex';
      var box = document.createElement('div');
      box.className = 'modal';
      box.style.cssText = 'max-width:520px;';

      var h = document.createElement('h2');
      h.style.marginTop = '0';
      h.textContent = 'PDF ist fertig';
      box.appendChild(h);

      var p = document.createElement('p');
      p.className = 'sub';
      p.style.cssText = 'margin:0 0 4px;';
      p.textContent = filename;
      box.appendChild(p);

      var p2 = document.createElement('p');
      p2.className = 'sub';
      p2.style.cssText = 'margin:6px 0 14px;';
      p2.textContent = 'Öffnet das PDF in einem neuen Tab – dort mit dem Download-Symbol des PDF-Viewers als Datei speichern oder drucken.';
      box.appendChild(p2);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;';
      var openBtn = document.createElement('button');
      openBtn.className = 'primary';
      openBtn.textContent = '⬇ PDF in neuem Tab öffnen';
      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Schliessen';
      row.appendChild(openBtn); row.appendChild(closeBtn);
      box.appendChild(row);

      var hint = document.createElement('div');
      hint.style.cssText = 'color:var(--danger); font-size:12px; margin-top:10px; min-height:16px;';
      box.appendChild(hint);

      bg.appendChild(box);
      document.body.appendChild(bg);
      function close() { bg.remove(); }
      closeBtn.addEventListener('click', close);
      bg.addEventListener('click', function (e) { if (e.target === bg) close(); });

      openBtn.addEventListener('click', function () {
        var win = null;
        try { win = window.open('', '_blank'); } catch (e) {}
        if (win && win.document) {
          try {
            win.document.open();
            win.document.write(
              '<!doctype html><html><head><meta charset="utf-8"><title>' + filename + '</title>' +
              '<style>html,body{margin:0;height:100%}embed,iframe{border:0;width:100%;height:100%}</style></head>' +
              '<body><embed type="application/pdf" src="' + dataUri + '"></body></html>');
            win.document.close();
            hint.textContent = '';
            return;
          } catch (e) {}
        }
        // Popup blockiert: als HTML-Datei sichern (garantierter Weg), sonst Hinweis.
        if (downloads) {
          var htmlDoc =
            '<!doctype html><html><head><meta charset="utf-8"><title>' + filename + '</title>' +
            '<style>html,body{margin:0;height:100%}embed{border:0;width:100%;height:100%}</style></head>' +
            '<body><embed type="application/pdf" src="' + dataUri + '"></body></html>';
          downloads.save({ filename: filename.replace(/\.pdf$/i, '') + '.html', data: htmlDoc })
            .then(function () { hint.style.color = 'var(--ok)'; hint.textContent = 'Als HTML-Datei gespeichert – im Browser öffnen und drucken/als PDF sichern.'; })
            .catch(function () { hint.textContent = 'Popups sind blockiert. Bitte Popups für diese Seite erlauben – oder die installierte App für den direkten PDF-Download nutzen.'; });
        } else {
          hint.textContent = 'Popups sind blockiert. Bitte Popups für diese Seite erlauben – oder die installierte App für den direkten PDF-Download nutzen.';
        }
      });
      return 'preview';
    });
  }
})();
