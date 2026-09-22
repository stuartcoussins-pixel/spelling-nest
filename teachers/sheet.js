/* Spelling Nest · spelling sheet maker
   Builds an A4 spelling sheet as a PDF in the teacher's own browser. Nothing is sent to
   Spelling Nest: the words, the school name and the logo never leave the computer. The QR
   code on each sheet is a link with that week's words and test date written into it, so
   there is no school account and nothing stored on our side.
   Works in the browser (window.SNSheet) and in Node for the tests (module.exports). */
(function (root) {
  'use strict';

  var APP = 'https://spellingnest.co.uk/app/';
  var MAX_WORDS = 20;
  var NAVY = [2, 33, 64], SOFT = [75, 97, 121], LINE = [150, 166, 184], FILL = [236, 241, 246], PINK = [247, 177, 191];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  var ORD = ['1st', '2nd', '3rd', '4th', '5th'];

  /* ---------- words and dates ---------- */
  function tidyWord(w) {
    return String(w || '').replace(/[‘’ʼ`´]/g, '’').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function splitWords(text) {
    var out = [], seen = {};
    String(text || '').split(/[\n,;\t]+/).forEach(function (w) {
      w = tidyWord(w);
      if (!w || !/[A-Za-z]/.test(w)) return;
      var k = w.toLowerCase();
      if (seen[k]) return; seen[k] = 1; out.push(w);
    });
    return out;
  }
  /* Accepts 2026-10-02, 02/10/2026, 2/10/26. Returns yyyy-mm-dd or '' */
  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
    return null;
  }
  function iso(y, mo, d) {
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function prettyDate(isoDate) {
    if (!isoDate) return '';
    var p = isoDate.split('-').map(Number), dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dt.getUTCDay()] + ' ' + p[2] + ' ' + months[p[1] - 1];
  }

  /* ---------- the whole year: pasted from a spreadsheet, or a CSV file ----------
     Columns, in this order: Week, Focus, Test date, then the words (one per cell, or all in one
     cell separated by commas). Empty cells are kept, so a missing focus or date is fine. */
  function parseCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  }
  function parseYear(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); });
    var sheets = [], problems = [];
    lines.forEach(function (line, n) {
      var cells = line.indexOf('\t') >= 0 ? line.split('\t') : parseCsvLine(line);
      cells = cells.map(function (c) { return String(c).trim(); });
      if (n === 0 && /^(week|title|sheet)/i.test(cells[0]) && /focus|rule/i.test(cells.join(' '))) return; // the template's heading row
      var title = cells[0] || '', focus = cells[1] || '', rawDate = cells[2] || '';
      var words = splitWords(cells.slice(3).join(','));
      var date = parseDate(rawDate);
      var row = 'Row ' + (n + 1) + (title ? ' (' + title + ')' : '');
      if (!title && !words.length) return;
      if (date === null) { problems.push(row + ': the test date "' + rawDate + '" was not understood, so it was left off. Use 02/10/2026.'); date = ''; }
      if (!words.length) { problems.push(row + ': no words found, so this week was skipped.'); return; }
      if (words.length > MAX_WORDS) { problems.push(row + ': ' + words.length + ' words; only the first ' + MAX_WORDS + ' fit on a sheet.'); words = words.slice(0, MAX_WORDS); }
      sheets.push({ title: title, focus: focus, date: date, words: words });
    });
    return { sheets: sheets, problems: problems };
  }
  var TEMPLATE = 'Week,Focus,Test date,Words\n' +
    'Autumn 1 week 1,Short vowel sounds,12/09/2026,"cat, dog, sun, pin, red"\n' +
    'Autumn 1 week 2,The ck sound,19/09/2026,"back, duck, sock, kick, neck"\n' +
    'Autumn 1 week 3,Homophones,26/09/2026,"there, their, they’re, hear, here"\n';

  /* ---------- the link inside the QR code ---------- */
  function sheetLink(sheet, classLabel) {
    var title = [classLabel, sheet.title].filter(Boolean).join(' · ').slice(0, 60);
    var q = 'w=' + sheet.words.map(function (w) { return encodeURIComponent(w.toLowerCase().replace(/\u2019/g, "'")); }).join(',');
    if (title) q += '&t=' + encodeURIComponent(title);
    if (sheet.date) q += '&d=' + sheet.date;
    return APP + '?' + q + '&ref=sheet';
  }

  /* ---------- drawing ---------- */
  function kit(doc, x, y, s) { // Kit the owl, drawn from the same shapes as the site's logo; s = width in mm
    var k = s / 120;
    function E(cx, cy, rx, ry, col) { doc.setFillColor(col[0], col[1], col[2]); doc.ellipse(x + cx * k, y + cy * k, rx * k, ry * k, 'F'); }
    doc.setFillColor(2, 33, 64); doc.triangle(x + 26 * k, y + 40 * k, x + 22 * k, y + 14 * k, x + 44 * k, y + 30 * k, 'F');
    doc.triangle(x + 94 * k, y + 40 * k, x + 98 * k, y + 14 * k, x + 76 * k, y + 30 * k, 'F');
    E(24, 76, 12, 26, [11, 53, 99]); E(96, 76, 12, 26, [11, 53, 99]); E(60, 70, 40, 44, NAVY); E(60, 86, 25, 24, PINK);
    E(43, 53, 16, 16, [255, 255, 255]); E(77, 53, 16, 16, [255, 255, 255]); E(45, 55, 8, 8, NAVY); E(75, 55, 8, 8, NAVY);
    doc.setFillColor(242, 182, 80); doc.triangle(x + 54 * k, y + 66 * k, x + 66 * k, y + 66 * k, x + 60 * k, y + 75 * k, 'F');
  }
  function qrDraw(doc, qrcode, text, x, y, size) {
    var qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    var n = qr.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
    doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F');
    doc.setFillColor(0, 0, 0);
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.01, cell + 0.01, 'F');
    return n;
  }
  /* Put text inside a box: shrink to a minimum size, then wrap to at most maxLines, then cut
     with an ellipsis. It can never spill out of the box. The box is recorded for the tests. */
  function textBox(doc, text, box, o) {
    o = o || {}; text = String(text || ''); if (!text) return null;
    var size = o.size || 12, min = o.min || 8, maxLines = o.maxLines || 1, lines;
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    size = fit(doc, text, box.w, size, min);
    lines = doc.getTextWidth(text) <= box.w ? [text] : doc.splitTextToSize(text, box.w);
    var lineH = size * 0.3528 * 1.2;
    while (lines.length > 1 && lines.length * lineH > box.h && size > min) { size -= 0.5; doc.setFontSize(size); lineH = size * 0.3528 * 1.2; lines = doc.splitTextToSize(text, box.w); }
    if (lines.length > maxLines || (lines.length > 1 && lines.length * lineH > box.h + 0.01)) {
      var keep = Math.max(1, Math.min(maxLines, Math.floor((box.h + 0.01) / lineH)));
      lines = lines.slice(0, keep); var last = lines[keep - 1];
      while (last.length > 1 && doc.getTextWidth(last + '\u2026') > box.w) last = last.slice(0, -1);
      lines[keep - 1] = last.replace(/\s+$/, '') + '\u2026';
    }
    var blockH = lines.length * lineH, cap = size * 0.3528 * 0.72;
    var y0 = box.y + (box.h - blockH) / 2 + (lineH - cap) / 2 + cap;
    var x = o.align === 'right' ? box.x + box.w : o.align === 'center' ? box.x + box.w / 2 : box.x;
    lines.forEach(function (l, i) { doc.text(l, x, y0 + i * lineH, { align: o.align || 'left' }); });
    var usedW = Math.max.apply(null, lines.map(function (l) { return doc.getTextWidth(l); }));
    var bx = o.align === 'right' ? box.x + box.w - usedW : o.align === 'center' ? box.x + (box.w - usedW) / 2 : box.x;
    record(doc, o.name || 'text', bx, box.y + (box.h - blockH) / 2, usedW, blockH);
    return { size: size, lines: lines };
  }
  function record(doc, name, x, y, w, h) { (doc.__layout = doc.__layout || []).push({ page: doc.getNumberOfPages(), name: name, x: x, y: y, w: w, h: h }); }
  function fit(doc, text, maxW, size, min) {
    doc.setFontSize(size);
    while (size > min && doc.getTextWidth(text) > maxW) { size -= 0.5; doc.setFontSize(size); }
    return size;
  }

  /* Page geometry. Children need room to write, so rows are at least 13mm tall with handwriting
     lines in every box, the printed word is kept modest, and the writing columns get the width.
     Four or five columns go landscape so each box is wide enough for a whole word in a child's
     hand; three columns fit portrait. A long list carries on to a second page rather than
     squashing the rows. */
  function geometry(o) {
    var cols = o.columns === 'days' ? 5 : Math.max(3, Math.min(5, o.columns || 5));
    var land = cols >= 4;
    var W = land ? 297 : 210, H = land ? 210 : 297, M = 14;
    /* Fixed zones, top to bottom. Nothing is drawn outside its zone:
       band   the header (logo or Kit, school name, sheet title)
       rule   a line under the header, so nothing can run into the body
       info   focus on the left, test day and page on the right
       strip  Look, Say, Cover, Write, Check
       table  from top down to footTop
       foot   the QR code and its text */
    var band = land ? { y: 11, h: 15 } : { y: 12, h: 18 };
    var rule = band.y + band.h + 2.5, info = rule + 5, strip = { y: info + 3, h: 7.5 };
    var top = land ? 48 : 56, qs = land ? 30 : 36, footTop = H - M - qs - 4, hh = 10;
    var minRow = 13, maxRow = 17;
    var perPage = Math.floor((footTop - top - hh) / minRow);
    return { band: band, rule: rule, info: info, strip: strip, logoMax: land ? { w: 36, h: band.h } : { w: 40, h: band.h }, cols: cols, land: land, W: W, H: H, M: M, top: top, qs: qs, footTop: footTop, hh: hh, minRow: minRow, maxRow: maxRow, perPage: perPage };
  }
  function pagesFor(words, g) { // split as evenly as possible, never more than perPage on a page
    var n = Math.max(1, Math.ceil(words.length / g.perPage)), per = Math.ceil(words.length / n), out = [];
    for (var i = 0; i < words.length; i += per) out.push(words.slice(i, i + per));
    return out;
  }

  function drawPage(doc, qrcode, sheet, words, pageNo, pageCount, o, g) {
    var W = g.W, M = g.M, y = 14, inner = W - 2 * M;
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    var heading = [o.classLabel, sheet.title].filter(Boolean).join(' · ') || 'Spellings';

    /* header band. The left zone (logo or Kit, then the school name) and the right zone (the
       sheet title) each get a fixed share of the width with a gap between them, so however long
       a name or title is, or however wide or tall a logo is, nothing can overlap. */
    var band = g.band, gap = 6, leftW = (inner - gap) * 0.55, rightX = M + leftW + gap, rightW = inner - leftW - gap;
    var nameX = M;
    if (o.branding === 'dual') {
      if (o.logo) {
        var sc = Math.min(g.logoMax.w / o.logo.w, g.logoMax.h / o.logo.h), lw = o.logo.w * sc, lh = o.logo.h * sc;
        var ly = band.y + (band.h - lh) / 2;
        doc.addImage(o.logo.dataUrl, o.logo.type, M, ly, lw, lh); record(doc, 'logo', M, ly, lw, lh);
        nameX = M + lw + 4;
      }
      if (o.school) textBox(doc, o.school, { x: nameX, y: band.y, w: M + leftW - nameX, h: band.h }, { bold: true, size: 14, min: 9, maxLines: 2, name: 'school' });
    } else {
      var ks = Math.min(15, band.h); kit(doc, M, band.y + (band.h - ks) / 2 - 0.5, ks); record(doc, 'kit', M, band.y + (band.h - ks) / 2, ks, ks);
      textBox(doc, 'Spelling Nest', { x: M + ks + 3, y: band.y, w: leftW - ks - 3, h: band.h }, { bold: true, size: 15, min: 11, name: 'brand' });
    }
    textBox(doc, heading, { x: rightX, y: band.y, w: rightW, h: band.h }, { bold: true, size: 15, min: 10, maxLines: 2, align: 'right', name: 'heading' });
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.4); doc.line(M, g.rule, W - M, g.rule);

    /* focus on the left, test day and page on the right, each in its own zone */
    var infoBox = { y: g.info - 3.2, h: 4.8 };
    var right = [sheet.date ? 'Test: ' + prettyDate(sheet.date) : '', pageCount > 1 ? 'Page ' + pageNo + ' of ' + pageCount : ''].filter(Boolean).join('   \u00b7   ');
    if (sheet.focus) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); var fl = doc.getTextWidth('Focus: ');
      textBox(doc, 'Focus:', { x: M, y: infoBox.y, w: fl + 0.5, h: infoBox.h }, { bold: true, size: 12, min: 12, name: 'focus-label' });
      textBox(doc, String(sheet.focus), { x: M + fl + 0.5, y: infoBox.y, w: leftW - fl - 0.5, h: infoBox.h }, { size: 12, min: 9, name: 'focus' });
    }
    if (right) textBox(doc, right, { x: rightX, y: infoBox.y, w: rightW, h: infoBox.h }, { size: 12, min: 9, align: 'right', name: 'date' });

    /* how to practise */
    y = g.strip.y; doc.setFillColor(FILL[0], FILL[1], FILL[2]); doc.roundedRect(M, y, inner, g.strip.h, 2, 2, 'F');
    textBox(doc, 'Look   \u00b7   Say   \u00b7   Cover   \u00b7   Write   \u00b7   Check', { x: M, y: y, w: inner, h: g.strip.h }, { bold: true, size: 11, min: 9, align: 'center', name: 'strip' });
    record(doc, 'table', M, g.top, inner, 0.1);

    /* the table: a modest printed word, wide writing boxes, handwriting lines */
    var top = g.top, cols = g.cols, hh = g.hh;
    var heads = o.columns === 'days' ? DAYS : ORD.slice(0, cols).map(function (s) { return s + ' attempt'; });
    var c1 = g.land ? 48 : 44, cw = (inner - c1) / cols;
    var rows = words.length, rh = Math.max(g.minRow, Math.min(g.maxRow, (g.footTop - top - hh) / rows));
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
    doc.setFillColor(FILL[0], FILL[1], FILL[2]); doc.rect(M, top, inner, hh, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    fit(doc, 'Spellings', c1 - 4, 11.5, 8); doc.text('Spellings', M + c1 / 2, top + 6.8, { align: 'center' });
    var hsz = Math.min.apply(null, heads.map(function (h) { return fit(doc, h, cw - 3, 11, 7); })); doc.setFontSize(hsz);
    heads.forEach(function (h, i) { doc.text(h, M + c1 + cw * i + cw / 2, top + 6.8, { align: 'center' }); });
    words.forEach(function (w, r) {
      var ry = top + hh + r * rh;
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.rect(M, ry, inner, rh);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      var s = fit(doc, w, c1 - 6, 16, 9);
      doc.text(w, M + c1 / 2, ry + rh / 2 + s * 0.3528 * 0.36, { align: 'center' });
      /* handwriting lines in each writing box: a solid baseline and a dashed middle line */
      var base = ry + rh * 0.74, mid = ry + rh * 0.44;
      for (var c = 0; c < cols; c++) {
        var x0 = M + c1 + cw * c + 2.5, x1 = M + c1 + cw * (c + 1) - 2.5;
        doc.setDrawColor(190, 202, 214); doc.setLineWidth(0.25); doc.setLineDashPattern([], 0); doc.line(x0, base, x1, base);
        doc.setDrawColor(210, 219, 228); doc.setLineWidth(0.2); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(x0, mid, x1, mid);
        doc.setLineDashPattern([], 0);
      }
    });
    var bottom = top + hh + rows * rh;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
    for (var i = 0; i < cols; i++) { var lx = M + c1 + cw * i; doc.line(lx, top, lx, bottom); }
    doc.setLineWidth(0.6); doc.rect(M, top, inner, bottom - top);

    /* footer: the QR code and what it does (the same code on every page of a sheet) */
    var qs = g.qs, qy = g.H - M - qs;
    qrDraw(doc, qrcode, sheetLink(sheet, o.classLabel), M, qy, qs); record(doc, 'qr', M, qy, qs, qs);
    record(doc, 'table-bottom', M, bottom, inner, 0.1);
    var tx = M + qs + 6, tw = inner - qs - (o.branding === 'dual' ? 30 : 10);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    doc.text('Practise these words at home', tx, qy + 6.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(doc.splitTextToSize('Scan the code with a phone camera. This week’s words load straight into Spelling Nest, ready for your child to practise in ten minutes a day.', tw), tx, qy + 12.5);
    doc.setTextColor(SOFT[0], SOFT[1], SOFT[2]); doc.setFontSize(8);
    doc.text(doc.splitTextToSize('The code holds only these words' + (sheet.date ? ' and the test date' : '') + '. Nothing about your child is shared. spellingnest.co.uk', tw), tx, qy + (g.land ? 23 : 25));
    record(doc, 'foot-text', tx, qy, tw, qs);
    if (o.branding === 'dual') { kit(doc, W - M - 15, qy + qs - 17, 15); record(doc, 'foot-kit', W - M - 15, qy + qs - 17, 15, 15); }
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  }

  function makePdf(jsPDF, qrcode, o) {
    var g = geometry(o), orient = g.land ? 'landscape' : 'portrait';
    var doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orient, compress: true });
    doc.setProperties({ title: (o.classLabel ? o.classLabel + ' ' : '') + 'spelling sheets', creator: 'Spelling Nest sheet maker', subject: 'Spelling practice' });
    var first = true;
    (o.sheets || []).forEach(function (s) {
      var parts = pagesFor(s.words, g);
      parts.forEach(function (words, k) { if (!first) doc.addPage('a4', orient); first = false; drawPage(doc, qrcode, s, words, k + 1, parts.length, o, g); });
    });
    return doc;
  }

  var api = { makePdf: makePdf, geometry: geometry, pagesFor: pagesFor, sheetLink: sheetLink, parseYear: parseYear, splitWords: splitWords, parseDate: parseDate, prettyDate: prettyDate, TEMPLATE: TEMPLATE, MAX_WORDS: MAX_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SNSheet = api;
})(typeof window !== 'undefined' ? window : this);
