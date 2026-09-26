(function (scope) {
  'use strict';
  // Each span covers an exact part of the source. Formatting replaces that
  // span; it never adds a second copy of the original payload.
  function balancedJson(text, start) {
    const stack = []; let quoted = false; let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        if (stack.pop() !== (c === '}' ? '{' : '[')) return -1;
        if (!stack.length) return i + 1;
      }
    }
    return -1;
  }
  function xmlEnd(text, start) {
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
    tokens.lastIndex = start; let depth = 0; let root = false; let m;
    while ((m = tokens.exec(text))) {
      if (!root && text.slice(start, m.index).trim() && !text.slice(start, m.index).trim().startsWith('<?')) return -1;
      const tag = m[0];
      if (/^<[!?]/.test(tag)) continue;
      root = true;
      if (tag.startsWith('</')) depth--;
      else if (!tag.endsWith('/>')) depth++;
      if (depth === 0) return tokens.lastIndex;
    }
    return -1;
  }
  function scan(text, readXml) {
    const spans = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i]; let end = -1; let data; let format;
      if (c === '{' || c === '[') {
        end = balancedJson(text, i);
        if (end > i) {
          const raw = text.slice(i, end);
          // Empty thread IDs and [null] are common log prefixes, not bodies.
          const metadata = /^\[(?:null|\s*)\]$/.test(raw) && /^\s+\S/.test(text.slice(end)) && !/(?:request|response|body|payload)\s*[:=]\s*$/i.test(text.slice(Math.max(0, i - 40), i));
          if (!metadata) { try { data = JSON.parse(raw); format = 'JSON'; } catch { end = -1; } }
        }
      } else if (c === '<' && /^<(?:\?xml\b|[A-Za-z_])/.test(text.slice(i)) && readXml) {
        end = xmlEnd(text, i);
        if (end > i) { try { data = readXml(text.slice(i, end)); format = 'XML'; } catch { end = -1; } }
      }
      if (format) { spans.push({ start: i, end, data, format, raw: text.slice(i, end) }); i = end - 1; }
    }
    return spans;
  }
  function fields(text) {
    const wrapped = [...text.matchAll(/<>([\s\S]*?)<>/g)];
    if (wrapped.length && text.replace(/<>[\s\S]*?<>/g, '').trim() === '') {
      return wrapped.map(m => { const at = m[1].indexOf(':'); return at >= 0 ? [m[1].slice(0, at).trim(), m[1].slice(at + 1).trim()] : ['Text', m[1]]; });
    }
    const items = [...text.matchAll(/(?:^|[\n,;]|\s+)([A-Za-z_][\w .-]*?)\s*[:=]\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\n,;]+?)(?=\s+[A-Za-z_][\w.-]*\s*[:=]|[\n,;]|$)/g)];
    return items.map(m => [m[1].trim(), m[2].replace(/^(["'])([\s\S]*)\1$/, '$2').trim()]);
  }
  function vertical(text, readXml, writeXml) {
    text = text.trim();
    if (!text) return { output: '', count: 0, payloads: 0 };
    const wrapped = text.match(/<>[\s\S]*?<>/g);
    if (wrapped && text.replace(/<>[\s\S]*?<>/g, '').trim() === '') {
      return { output: wrapped.join('\n'), count: wrapped.length, payloads: 0 };
    }
    const spans = scan(text, readXml); let cursor = 0; let output = '';
    for (const span of spans) {
      const prefix = text.slice(cursor, span.start).trim();
      if (prefix) output += (output ? '\n' : '') + prefix + '\n';
      else if (output && !output.endsWith('\n')) output += '\n';
      output += span.format === 'JSON' ? JSON.stringify(span.data, null, 2) : writeXml(span.raw);
      cursor = span.end;
    }
    if (spans.length) { const suffix = text.slice(cursor).trim(); if (suffix) output += '\n' + suffix; }
    else {
      const pairs = fields(text);
      output = pairs.length ? pairs.map(([key, value]) => `${key}: ${value}`).join('\n') : text;
    }
    return { output, count: output.split('\n').length, payloads: spans.length };
  }
  function title(context) {
    context = context.split('\n').at(-1);
    if (/\bresponse\b|\bcallback\b/i.test(context)) return 'Response Body';
    if (/\brequest\b|incoming message/i.test(context)) return 'Request Body';
    return 'Log Content';
  }
  function sections(text, readXml) {
    const spans = scan(text, readXml); const result = []; let cursor = 0;
    for (const span of spans) {
      const context = text.slice(cursor, span.start).trim();
      result.push({ title: title(context), context, data: span.data, format: span.format, line: text.slice(0, span.start).split('\n').length });
      cursor = span.end;
    }
    if (!spans.length) {
      const pairs = fields(text);
      return [{ title: title(text), context: '', data: pairs.length ? Object.fromEntries(pairs) : { message: text.trim() }, format: 'Text', line: 1 }];
    }
    const remaining = text.slice(cursor).trim().replace(/^[;=\s]+/, '');
    if (remaining) result.push({ title: 'Log Messages', context: '', data: { message: remaining }, format: 'Text', line: text.slice(0, cursor).split('\n').length });
    return result;
  }
  scope.LogCore = { scan, fields, vertical, sections };
  if (typeof module !== 'undefined') module.exports = scope.LogCore;
})(typeof window === 'undefined' ? globalThis : window);
