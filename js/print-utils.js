// ============================================================
//  print-utils.js — shared "generate a document → preview/print/
//  save as PDF" opener, used by every document generator across
//  js/onboarding.js (Term Sheet, Subscription Agreement, DD Report)
//  and js/lp-register.js (LP Welcome Letter, Capital Call Notice,
//  Capital Account Statement).
//
//  Deliberately does NOT auto-fire window.print() on a timer — a
//  blind setTimeout races the popup's actual render/font-load time
//  and was the source of "nothing happened, tab just sat there"
//  complaints. The toolbar's print button is the only, reliable
//  trigger. window.open() itself still fires synchronously from the
//  caller's onclick handler (unchanged), which is what actually keeps
//  browsers from treating it as an unrequested popup.
// ============================================================

function openPrintableDocument(bodyHtml, opts) {
  opts = opts || {};
  const title = opts.title || 'Документ';
  const features = opts.features || 'width=960,height=800';
  const extraStyle = opts.extraStyle || '';

  const win = window.open('', '_blank', features);
  if (!win) {
    showToast('⚠ Разрешите всплывающие окна в браузере и повторите', 'red');
    return null;
  }

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
    '<style>' +
    'body{font-family:Arial,sans-serif;margin:0;color:#1a1a1a;background:#fff}' +
    '.print-toolbar{text-align:center;padding:16px;background:#f8fafc;border-bottom:1px solid #e2e8f0}' +
    '.print-toolbar button{background:#1a365d;color:#fff;border:none;padding:10px 28px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit}' +
    '@media print{' +
      '.no-print,.print-toolbar{display:none !important}' +
      '.page-break{page-break-before:always}' +
      'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '}' +
    extraStyle +
    '</style></head><body>' +
    '<div class="print-toolbar no-print">' +
      '<button onclick="window.print()">🖨️ Печать / Сохранить PDF</button>' +
    '</div>' +
    bodyHtml +
    '</body></html>';

  win.document.write(html);
  win.document.close();
  win.focus();
  return win;
}
