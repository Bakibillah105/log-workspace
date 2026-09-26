const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = { activeTab: "vertical", formatMode: "auto", uploadTarget: null, reportText: "", comparisonText: "" };
const examples = {
  format: '{"referenceId":"TXN-20481","amount":"184.23","currency":"BDT","status":"Accepted","password":"private-value","customer":{"phone":"+8801700000000","country":"Bangladesh"}}',
  vertical: "<>firstName:Baki<> <>Lastname:Billah<>",
  compareA: "<>firstName:Baki<> <>lastName:Billah<> <>status:Active<>",
  compareB: "<>firstName:Masum<> <>lastName:Haque<> <>status:Active<>",
  report: [
    '[INFO] [2026-09-26 10:30:00] RequestDispatcher Request: {"header":{"requestId":"REQ-20481","password":"demo-password"},"body":{"beneficiaryInfo":{"firstName":"Baki","lastName":"Billah","DOB":"08/10/1995"},"transactionInfo":{"initiationDate":"26/09/26","amount":3050,"currency":"BDT"}}}',
    "[INFO] [2026-09-26 10:30:02] RequestDispatcher Response: {\"responseCode\":\"0\",\"responseMessage\":\"Request accepted successfully\"}",
    "[WARN] [2026-09-26 10:30:03] Processing took longer than expected",
    "[INFO] [2026-09-26 10:30:05] RequestDispatcher Response: {\"responseCode\":\"3000\",\"responseMessage\":\"Remit Success\",\"conversationID\":\"CONV-90871234\"}",
  ].join("\n"),
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1600);
}

function setTab(name) {
  state.activeTab = name;
  $$(".tab").forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $$(".tab-pane").forEach((pane) => {
    const selected = pane.id === `pane-${name}`;
    pane.hidden = !selected;
    pane.classList.toggle("active-pane", selected);
  });
}

function updateCount(inputId, countId) {
  const length = $(`#${inputId}`).value.length;
  $(`#${countId}`).textContent = `${length.toLocaleString()} character${length === 1 ? "" : "s"}`;
}

function normalizeControlMarkers(text) { return text.replace(/#011/g, " ").replace(/\u000b/g, " "); }

function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("XML document type declarations are not supported.");
  const cleaned = text.replace(/>((?:\s|#011)+)</g, '> <');
  const documentNode = new DOMParser().parseFromString(cleaned, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("The XML is incomplete or contains an invalid tag.");
  return documentNode;
}

function formatXml(text) {
  const doc = parseXml(text); const serializer = new XMLSerializer();
  function print(node, depth) {
    const indent = '  '.repeat(depth);
    if (node.nodeType !== 1 || !node.children.length || [...node.childNodes].some(n => (n.nodeType === 3 || n.nodeType === 4) && n.textContent.trim())) return indent + serializer.serializeToString(node);
    const start = serializer.serializeToString(node.cloneNode(false)).replace(/\s*\/>$/, '>');
    return indent + start + '\n' + [...node.childNodes].filter(n => n.nodeType !== 3 || n.textContent.trim()).map(n => print(n, depth + 1)).join('\n') + '\n' + indent + '</' + node.nodeName + '>';
  }
  return print(doc.documentElement, 0);
}

function xmlNodeToValue(node) {
  const children = [...node.children];
  const attributes = Object.fromEntries([...node.attributes].map((attr) => [`@${attr.name}`, attr.value]));
  if (!children.length) {
    const text = node.textContent.trim();
    return Object.keys(attributes).length ? { ...attributes, "#text": text } : text;
  }
  const result = Object.assign(Object.create(null), attributes);
  children.forEach((child) => {
    const value = xmlNodeToValue(child);
    if (Object.prototype.hasOwnProperty.call(result, child.nodeName)) {
      result[child.nodeName] = Array.isArray(result[child.nodeName]) ? [...result[child.nodeName], value] : [result[child.nodeName], value];
    } else result[child.nodeName] = value;
  });
  const ownText = [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent.trim()).join(" ").trim();
  if (ownText) result["#text"] = ownText;
  return result;
}

function xmlToJson(text) {
  const documentNode = parseXml(text);
  return { [documentNode.documentElement.nodeName]: xmlNodeToValue(documentNode.documentElement) };
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function safeTag(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `field_${cleaned}`;
}

function valueToXml(value, tagName, depth = 0) {
  const tag = safeTag(tagName);
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) return value.map((item) => valueToXml(item, tag, depth)).join("\n");
  if (value && typeof value === "object") {
    const body = Object.entries(value).map(([key, item]) => valueToXml(item, key, depth + 1)).join("\n");
    return `${indent}<${tag}>\n${body}\n${indent}</${tag}>`;
  }
  return `${indent}<${tag}>${escapeXml(value ?? "")}</${tag}>`;
}

function jsonToXml(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1) {
    const [rootName, rootValue] = Object.entries(value)[0];
    return `<?xml version="1.0" encoding="UTF-8"?>\n${valueToXml(rootValue, rootName)}`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${valueToXml(value, "root")}`;
}

function setResultState(element, message, type = "success") {
  element.className = `result-state${type === "neutral" ? " neutral" : type === "error" ? " error" : ""}`;
  element.innerHTML = `<span aria-hidden="true">${type === "error" ? "!" : type === "neutral" ? "•" : "✓"}</span> ${message}`;
}

function runFormat() {
  const input = $("#format-input").value.trim();
  const output = $("#format-output");
  const status = $("#format-state");
  if (!input) {
    output.textContent = "Your formatted result will appear here.";
    output.classList.add("empty-output");
    setResultState(status, "Paste JSON or XML first", "neutral");
    return;
  }
  try {
    let result;
    let label;
    if (state.formatMode === "json-to-xml") {
      const data = JSON.parse(input);
      result = jsonToXml(data);
      label = "JSON converted to XML";
    } else if (state.formatMode === "xml-to-json") {
      const data = xmlToJson(input);
      result = JSON.stringify(data, null, 2);
      label = "XML converted to JSON";
    } else if (/^[\[{]/.test(input)) {
      const data = JSON.parse(input);
      result = JSON.stringify(data, null, 2);
      label = "JSON formatted";
    } else if (/^</.test(input)) {
      result = formatXml(input);
      label = "XML formatted";
    } else throw new Error("This does not look like JSON or XML. Try Make Vertical instead.");
    output.textContent = result;
    output.classList.remove("empty-output");
    setResultState(status, label);
  } catch (error) {
    output.textContent = error.message;
    output.classList.remove("empty-output");
    setResultState(status, "Could not process this input", "error");
  }
}

function splitIntoVerticalLines(value) {
  return LogCore.vertical(value, xmlToJson, formatXml);
}

function makeVertical() {
  const result = splitIntoVerticalLines($("#vertical-input").value);
  const output = result.output;
  $("#vertical-output").textContent = output || "Your result will appear here.";
  setResultState($("#vertical-state"), result.count ? `${result.count} lines${result.payloads ? ` · ${result.payloads} bodies formatted` : ''}` : "Paste some text first", result.count ? "success" : "neutral");
}

function countMatches(text, regex) { return (text.match(regex) || []).length; }
function firstMatch(text, regex) { return text.match(regex)?.[1]?.trim() || ""; }

function detectSensitiveTypes(text) {
  const types = [];
  if (/(?:password|passcode)\s*[":=<>]/i.test(text)) types.push("passwords");
  if (/(?:credential|token|authorization|api.?key)\s*[":=<>]/i.test(text)) types.push("credentials");
  if (/\+?\d{10,15}/.test(text)) types.push("phone numbers or IDs");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) types.push("email addresses");
  return types;
}

function buildReport(text) {
  const callback = ReportModel.callback(text);
  const errors = countMatches(text, /\[ERROR\]|\bexception\b|\bfailure\b|\bfailed\b/gi) + (callback?.error ? 1 : 0);
  const warnings = countMatches(text, /\[WARN(?:ING)?\]/gi);
  const parsedSections = LogCore.sections(text, xmlToJson);
  const requests = Math.max(parsedSections.filter(s => s.title === 'Request Body' || ReportModel.request(s.data)).length, text.split('\n').filter(line => /\bRequest\s*:|Incoming Message:/i.test(line)).length);
  const responses = Math.max(parsedSections.filter(s => s.title === 'Response Body').length, text.split('\n').filter(line => /\bResponse\s*:|Successfully received callback/i.test(line)).length);
  const success = /Remit Success|"status"\s*:\s*"(?:completed|success|successful)"/i.test(text);
  const accepted = /accept.*success|acknowledged|received callback/i.test(text);
  const failure = errors > 0 || /responseMessage["'\s:=<>]+(?:failed|rejected|declined)|\btimeout\b/i.test(text);
  const status = callback?.error
    ? { title: 'Callback reported an error', note: 'The earlier acceptance is not a final success. Check the callback details below.', tone: 'danger' }
    : success && failure
    ? { title: "Success reported · errors present", note: "Both successful results and errors appear in this log.", tone: "warning" }
    : failure ? { title: "Attention needed", note: "The log contains an error or unsuccessful result.", tone: "danger" }
      : success ? { title: "Success reported", note: "The log contains an explicit successful result.", tone: "success" }
        : accepted ? { title: "Request accepted", note: "Acceptance is recorded; final completion is not confirmed here.", tone: "warning" }
        : { title: "Result unclear", note: "No clear final success or failure was found.", tone: "warning" };
  const amount = firstMatch(text, /(?:"(?:amount|sendingAmount|receivingAmount)"\s*:\s*"?|<(?:[^>:]+:)?(?:Amount|SendingAmount|ReceivingAmount)>)([\d.]+)/i);
  const code = firstMatch(text, /(?:"responseCode"\s*:\s*"|<(?:[^>:]+:)?ResponseCode>)([^"<]+)/i);
  const transaction = firstMatch(text, /(?:"(?:conversationID|transId|referenceId)"\s*:\s*"|<(?:[^>:]+:)?(?:ConversationID|OriginatorConversationID)>)([^"<]+)/i);
  const missingParameter = firstMatch(text, /parameter\s*<([^>]+)>\s*not found/i);
  const sensitiveTypes = detectSensitiveTypes(text);
  const highlights = [];
  if (callback?.error) highlights.push('Callback error: ' + callback.data['Error Message']);
  if (requests) highlights.push(`${requests} request ${requests === 1 ? "entry" : "entries"} found`);
  if (responses) highlights.push(`${responses} response or callback ${responses === 1 ? "entry" : "entries"} found`);
  if (/Remit Success/i.test(text)) highlights.push("Final remittance status says successful");
  else if (/accepted successfully/i.test(text)) highlights.push("A request was accepted successfully");
  if (missingParameter) highlights.push(`Missing parameter detected: ${missingParameter}`);
  if (!highlights.length) highlights.push("No common request or response markers were found");
  const facts = [];
  if (amount) facts.push(["Amount", amount]);
  if (code) facts.push(["Response code", code]);
  if (transaction) facts.push(["Reference", transaction]);
  return { status, metrics: { requests, responses, errors, warnings }, highlights: highlights.slice(0, 4), facts, sensitiveTypes };
}

function createReport(text = $("#report-input").value.trim()) {
  if (!text) { showToast("Paste or upload a log first"); return null; }
  const report = buildReport(text);
  const content = readableLogContent(text);
  state.reportText = [
    `RESULT: ${report.status.title}`, report.status.note, "",
    `Requests: ${report.metrics.requests} | Responses: ${report.metrics.responses} | Errors: ${report.metrics.errors} | Warnings: ${report.metrics.warnings}`,
    report.facts.length ? `Key facts: ${report.facts.map(([key, value]) => `${key}: ${value}`).join(" | ")}` : "",
    "Highlights:", ...report.highlights.map((item) => `- ${item}`),
    '', content.text,
  ].filter((line) => line !== "").join("\n");
  $("#report-empty").hidden = true;
  const output = $("#report-result");
  output.hidden = false;
  output.innerHTML = `
    <section class="report-status ${report.status.tone}"><p class="status-label">OVERALL RESULT</p><h3 class="status-value">${report.status.title}</h3><p class="status-note">${report.status.note}</p></section>
    <div class="metric-grid"><div class="metric"><strong>${report.metrics.requests}</strong><span>Requests</span></div><div class="metric"><strong>${report.metrics.responses}</strong><span>Responses</span></div><div class="metric"><strong>${report.metrics.errors}</strong><span>Errors</span></div><div class="metric"><strong>${report.metrics.warnings}</strong><span>Warnings</span></div></div>
    ${report.facts.length ? `<section class="report-section"><h3>Key facts</h3><div class="report-facts">${report.facts.map(([key, value]) => `<span class="fact-chip"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</span>`).join("")}</div></section>` : ""}
    <section class="report-section"><h3>Highlights</h3><ul class="report-list">${report.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
    <div class="body-reports">${content.html}</div>`;
  return report;
}

function readableLabel(key) {
  const raw = key.replace(/^@/, '').replace(/^.*:/, '');
  const aliases = { dob: 'DOB', dateofbirth: 'DOB', firstname: 'First name', lastname: 'Last name', beneficiaryinfo: 'Beneficiary Info', transactioninfo: 'Transaction Info', requestbody: 'Request Body', responsebody: 'Response Body', msisdn: 'Phone number', '#text': 'Value' };
  if (aliases[raw.toLowerCase()]) return aliases[raw.toLowerCase()];
  const label = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function reportValue(key, value) {
  if (value === null) return 'Not provided';
  if (value === '') return '(blank)';
  if (typeof value === 'boolean') return value ? 'Yes (true)' : 'No (false)';
  return String(value);
}

function reportTree(value, depth = 0, path = '') {
  if (depth > 30) return { html: '<p>Nested content exceeds the display limit.</p>', text: 'Nested content exceeds the display limit.' };
  const entries = value !== null && typeof value === 'object' ? Object.entries(value) : [['Value', value]];
  let html = ''; const lines = []; let leafRows = [];
  const flush = () => { if (leafRows.length) { html += reportTable(['Field','Value'], leafRows).html; leafRows = []; } };
  if (!entries.length) return { html: '<p class="status-note">Empty section</p>', text: 'Empty section' };
  for (const [key, item] of entries) {
    const label = Array.isArray(value) ? `Item ${Number(key) + 1}` : readableLabel(key);
    const fieldPath = path ? path + '.' + key : key;
    if (item !== null && typeof item === 'object') {
      flush();
      const child = reportTree(item, depth + 1, fieldPath);
      const clean = key.replace(/^.*:/, '').toLowerCase();
      const wrapper = ['envelope', 'request', 'response', 'body', 'requestbody', 'responsebody'].includes(clean);
      html += wrapper ? child.html : `<section class="readable-group"><h4>${escapeHtml(label)}</h4>${child.html}</section>`;
      lines.push(...(wrapper ? [] : ['  '.repeat(depth) + label]), child.text);
    } else {
      const display = reportValue(fieldPath, item);
      leafRows.push([label,display]);
      lines.push('  '.repeat(depth) + label + ': ' + display);
    }
  }
  flush();
  return { html, text: lines.join('\n') };
}

function reportTable(columns, rows) {
  const safeRows = rows.map(row => row.map((cell, i) => i === 0 ? readableLabel(String(cell)) : reportValue(columns[i] === 'Identifier' ? 'identifier' : row[0],cell)));
  return { html: `<div class="report-table-wrap"><table class="report-table"><thead><tr>${columns.map(c=>`<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${safeRows.map(row=>`<tr>${row.map((cell,i)=>i===0?`<th scope="row">${escapeHtml(cell)}</th>`:`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, text: safeRows.map(row=>row[0]+': '+row.slice(1).join(' | ')).join('\n') };
}

function readableLogContent(text) {
  const callback = ReportModel.callback(text);
  const bodyText = callback ? text.slice(0,callback.start) + text.slice(callback.end) : text;
  const sections = LogCore.sections(bodyText, xmlToJson); const blocks = []; const plain = [];
  for (const section of sections) {
    const request = ReportModel.request(section.data);
    if (request) {
      const groups = request.groups.map(group=>({ ...group, table:reportTable(group.columns,group.rows) }));
      const extra = Object.keys(request.extra).length ? reportTree(request.extra) : null;
      blocks.push(`<article class="body-report report-request"><div class="body-report-heading"><h3>${escapeHtml(request.title)}</h3><span class="stage-badge">Request</span></div>${groups.map(g=>`<section class="report-group"><h4>${escapeHtml(g.title)}</h4>${g.table.html}</section>`).join('')}${extra?`<details class="additional-details"><summary>Other request details</summary>${extra.html}</details>`:''}</article>`);
      plain.push(request.title,...groups.flatMap(g=>[g.title,g.table.text]),...(extra?['Other request details',extra.text]:[]),'');
      continue;
    }
    section.data = ReportModel.normalize(section.data);
    // A standalone object can contain separate request and response wrappers.
    const keys = section.data && typeof section.data === 'object' && !Array.isArray(section.data) ? Object.keys(section.data) : [];
    const allWrappers = keys.length && keys.every(k => /^(?:request|response)(?:body)?$/i.test(k));
    const groups = allWrappers ? keys.map(k => ({ title: /response/i.test(k) ? 'Response Body' : 'Request Body', data: section.data[k] })) : [{ title: section.title, data: section.data }];
    for (const group of groups) {
      let heading = group.title;
      if (heading === 'Log Content' && keys.some(k => /request|response/i.test(k))) heading = keys.some(k => /response/i.test(k)) ? 'Response Body' : 'Request Body';
      const tree = reportTree(group.data);
      const context = section.context ? `<details class="source-context"><summary>Source · line ${section.line}</summary><pre>${escapeHtml(section.context)}</pre></details>` : '';
      const kind = /callback/i.test(section.context) ? 'callback' : /response/i.test(heading) ? 'response' : /request/i.test(heading) ? 'request' : 'neutral';
      if (kind === 'response' && /accept.*success|accepted/i.test(JSON.stringify(group.data))) heading = 'Response — Request accepted';
      if (kind === 'callback') heading = 'Callback — Result';
      blocks.push(`<article class="body-report report-${kind}"><div class="body-report-heading"><h3>${escapeHtml(heading)}</h3><span class="stage-badge">${kind === 'neutral' ? section.format : kind.charAt(0).toUpperCase()+kind.slice(1)}</span></div>${tree.html}${context}</article>`);
      plain.push(heading, tree.text, '');
    }
  }
  if (callback) {
    const table=reportTable(['Field','Value'],Object.entries(callback.data));
    blocks.push(`<article class="body-report report-callback"><div class="body-report-heading"><h3>Callback — ${callback.error?'Error reported':'Result'}</h3><span class="stage-badge">Callback</span></div>${table.html}<p class="callback-note">Column labels follow the five-part callback layout in your example. Result and error codes are shown as recorded.</p></article>`);
    plain.push('Callback — '+(callback.error?'Error reported':'Result'),table.text);
  }
  return { html: blocks.join(''), text: plain.join('\n') };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function flattenForComparison(value, prefix = "", result = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenForComparison(item, `${prefix}[${index}]`, result));
    return result;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => flattenForComparison(item, prefix ? `${prefix}.${key}` : key, result));
    return result;
  }
  const key = prefix || "value";
  result.set(key.toLowerCase(), { key, value: String(value ?? "") });
  return result;
}

function parseSimpleFields(text) {
  const result = new Map();
  const pattern = /(?:<>|\b)([A-Za-z_][\w.-]*)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^<>\s,{}\[\]]+))(?:<>|)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    result.set(key.toLowerCase(), { key, value });
  }
  return result;
}

function extractComparableFields(text) {
  const trimmed = text.trim();
  if (!trimmed) return new Map();
  if (/^[\[{]/.test(trimmed)) {
    try { return flattenForComparison(JSON.parse(trimmed)); } catch { /* try other formats */ }
  }
  if (/^</.test(trimmed) && !/^<>/.test(trimmed)) {
    try { return flattenForComparison(xmlToJson(trimmed)); } catch { /* try simple fields */ }
  }
  const fields = parseSimpleFields(trimmed);
  if (fields.size) return fields;

  const embeddedJson = trimmed.split(/\r?\n/).map((line) => line.slice(line.indexOf("{"))).filter((part) => part.startsWith("{"));
  embeddedJson.forEach((part, index) => {
    try {
      const flattened = flattenForComparison(JSON.parse(part));
      flattened.forEach((item, key) => fields.set(embeddedJson.length > 1 ? `entry${index + 1}.${key}` : key, { key: embeddedJson.length > 1 ? `entry${index + 1}.${item.key}` : item.key, value: item.value }));
    } catch { /* ignore malformed embedded JSON */ }
  });
  if (fields.size) return fields;

  trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => fields.set(`line${index + 1}`, { key: `Line ${index + 1}`, value: line }));
  return fields;
}

function compareLogs(logA, logB) {
  const fieldsA = extractComparableFields(logA);
  const fieldsB = extractComparableFields(logB);
  const allKeys = [...new Set([...fieldsA.keys(), ...fieldsB.keys()])].sort((left, right) => left.localeCompare(right));
  const differences = [];
  let unchanged = 0;
  allKeys.forEach((normalizedKey) => {
    const first = fieldsA.get(normalizedKey);
    const second = fieldsB.get(normalizedKey);
    if (first && second && first.value === second.value) { unchanged += 1; return; }
    const displayKey = first?.key || second?.key || normalizedKey;
    differences.push({
      key: displayKey,
      first: first ? first.value : "Not present",
      second: second ? second.value : "Not present",
      type: !first ? "Added in second log" : !second ? "Missing from second log" : "Changed",
    });
  });
  return { differences, unchanged, fieldCount: allKeys.length };
}

function createComparison(logA = $("#compare-a-input").value.trim(), logB = $("#compare-b-input").value.trim()) {
  if (!logA || !logB) { showToast("Add both logs before comparing"); return null; }
  const comparison = compareLogs(logA, logB);
  $("#compare-empty").hidden = true;
  const output = $("#compare-results");
  output.hidden = false;
  state.comparisonText = comparison.differences.length
    ? [`DIFFERENCES: ${comparison.differences.length}`, ...comparison.differences.map((item) => `- ${item.key}: ${item.first} → ${item.second}`)].join("\n")
    : "NO DIFFERENCES FOUND";

  if (!comparison.differences.length) {
    output.innerHTML = `<div class="compare-summary"><strong>No differences found</strong><span>${comparison.unchanged} matching ${comparison.unchanged === 1 ? "field" : "fields"}</span></div><div class="no-difference">The compared values are the same.</div>`;
    return comparison;
  }

  output.innerHTML = `
    <div class="compare-summary"><strong>${comparison.differences.length} ${comparison.differences.length === 1 ? "difference" : "differences"} found</strong><span>${comparison.unchanged} matching ${comparison.unchanged === 1 ? "field" : "fields"} hidden</span></div>
    <div class="diff-list">
      <div class="diff-row diff-header"><span>Field</span><span>First log</span><span></span><span>Second log</span></div>
      ${comparison.differences.map((item) => `<div class="diff-row"><span class="diff-field">${escapeHtml(item.key)}</span><span class="diff-value">${escapeHtml(item.first)}</span><span class="diff-arrow" aria-label="changed to">→</span><span class="diff-value changed">${escapeHtml(item.second)}</span></div>`).join("")}
    </div>`;
  return comparison;
}

async function copyText(text) {
  if (!text || text.includes("will appear here")) return showToast("Nothing to copy yet");
  await navigator.clipboard.writeText(text);
  showToast("Copied");
}

function downloadText(text, name) {
  if (!text || text.includes("will appear here")) return showToast("Nothing to download yet");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Download ready");
}

function clearAll() {
  ["format-input", "vertical-input", "compare-a-input", "compare-b-input", "report-input"].forEach((id) => { $(`#${id}`).value = ""; });
  $("#format-output").textContent = "Your formatted result will appear here.";
  $("#format-output").classList.add("empty-output");
  $("#vertical-output").textContent = "Your result will appear here.";
  $("#report-result").hidden = true;
  $("#report-result").innerHTML = "";
  $("#report-empty").hidden = false;
  $("#compare-results").hidden = true;
  $("#compare-results").innerHTML = "";
  $("#compare-empty").hidden = false;
  state.reportText = ""; state.comparisonText = "";
  updateCount("format-input", "format-count"); updateCount("vertical-input", "vertical-count"); updateCount("compare-a-input", "compare-a-count"); updateCount("compare-b-input", "compare-b-count"); updateCount("report-input", "report-count");
  setResultState($("#format-state"), "Ready for JSON or XML", "neutral"); setResultState($("#vertical-state"), "Paste some text first", "neutral");
  showToast("Workspace cleared");
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => Promise.resolve(context.registerTool(tool)).catch(() => {});
  register({
    name: "format_or_convert_log", title: "Format or convert log", description: "Format JSON or XML, or convert between them, and update the visible result.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, mode: { type: "string", enum: ["auto", "json-to-xml", "xml-to-json"] } }, required: ["text", "mode"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) {
      if (!input || typeof input.text !== "string" || !["auto", "json-to-xml", "xml-to-json"].includes(input.mode)) throw new Error("text and a valid mode are required");
      setTab("format"); state.formatMode = input.mode; $("#format-input").value = input.text;
      $$('[data-format-mode]').forEach((item) => { const active = item.dataset.formatMode === input.mode; item.classList.toggle("active", active); item.setAttribute('aria-pressed',String(active)); });
      $("#run-format").firstChild.textContent = input.mode === 'auto' ? 'Format ' : 'Convert ';
      updateCount("format-input", "format-count"); runFormat();
      if ($("#format-state").classList.contains("error")) throw new Error($("#format-output").textContent);
      return { mode: input.mode, output: $("#format-output").textContent };
    },
  });
  register({
    name: "make_log_vertical", title: "Make log vertical", description: "Place compact or repeated log fields on separate lines and update the visible result.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) {
      if (!input || typeof input.text !== "string") throw new Error("text is required");
      setTab("vertical"); $("#vertical-input").value = input.text; updateCount("vertical-input", "vertical-count"); makeVertical();
      return { lines: $("#vertical-output").textContent.split("\n").length };
    },
  });
  register({
    name: "compare_logs", title: "Compare two logs", description: "Match fields from two logs, show changed values, and update the visible comparison.",
    inputSchema: { type: "object", properties: { firstLog: { type: "string" }, secondLog: { type: "string" } }, required: ["firstLog", "secondLog"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) {
      if (!input || typeof input.firstLog !== "string" || typeof input.secondLog !== "string" || !input.firstLog.trim() || !input.secondLog.trim()) throw new Error("Both logs are required");
      setTab("compare"); $("#compare-a-input").value = input.firstLog; $("#compare-b-input").value = input.secondLog;
      updateCount("compare-a-input", "compare-a-count"); updateCount("compare-b-input", "compare-b-count");
      const comparison = createComparison(input.firstLog, input.secondLog);
      return { differences: comparison.differences.length, unchanged: comparison.unchanged, fields: comparison.differences.map((item) => item.key) };
    },
  });
  register({
    name: "create_simple_log_report", title: "Create simple log report", description: "Create a short, non-technical report from a pasted log and update the visible report.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) {
      if (!input || typeof input.text !== "string" || !input.text.trim()) throw new Error("text is required");
      setTab("report"); $("#report-input").value = input.text; updateCount("report-input", "report-count"); const report = createReport(input.text);
      return { result: report.status.title, errors: report.metrics.errors, warnings: report.metrics.warnings };
    },
  });
}

$$('.tab').forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
$$('.tab').forEach((tab, index, tabs) => tab.addEventListener("keydown", (event) => {
  let next;
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault(); setTab(tabs[next].dataset.tab); tabs[next].focus();
}));
$$('[data-format-mode]').forEach((button) => button.addEventListener("click", () => {
  state.formatMode = button.dataset.formatMode;
  $$('[data-format-mode]').forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute('aria-pressed',String(item === button)); });
  $("#run-format").firstChild.textContent = state.formatMode === "auto" ? "Format " : "Convert ";
}));
[["format-input", "format-count"], ["vertical-input", "vertical-count"], ["compare-a-input", "compare-a-count"], ["compare-b-input", "compare-b-count"], ["report-input", "report-count"]].forEach(([input, count]) => $(`#${input}`).addEventListener("input", () => updateCount(input, count)));

$("#format-example").addEventListener("click", () => { $("#format-input").value = examples.format; updateCount("format-input", "format-count"); runFormat(); });
$("#vertical-example").addEventListener("click", () => { $("#vertical-input").value = examples.vertical; updateCount("vertical-input", "vertical-count"); makeVertical(); });
$("#compare-a-example").addEventListener("click", () => { $("#compare-a-input").value = examples.compareA; updateCount("compare-a-input", "compare-a-count"); });
$("#compare-b-example").addEventListener("click", () => { $("#compare-b-input").value = examples.compareB; updateCount("compare-b-input", "compare-b-count"); });
$("#report-example").addEventListener("click", () => { $("#report-input").value = examples.report; updateCount("report-input", "report-count"); createReport(); });
$("#run-format").addEventListener("click", runFormat); $("#make-vertical").addEventListener("click", makeVertical); $("#compare-logs").addEventListener("click", () => createComparison()); $("#create-report").addEventListener("click", () => createReport()); $("#clear-all").addEventListener("click", clearAll);
$$('.copy-trigger').forEach((button) => button.addEventListener("click", () => copyText($(`#${button.dataset.source}`).textContent)));
$$('.download-trigger').forEach((button) => button.addEventListener("click", () => downloadText($(`#${button.dataset.source}`).textContent, button.dataset.name)));
$("#copy-report").addEventListener("click", () => copyText(state.reportText)); $("#download-report").addEventListener("click", () => downloadText(state.reportText, "simple-log-report.txt"));
$("#copy-comparison").addEventListener("click", () => copyText(state.comparisonText)); $("#download-comparison").addEventListener("click", () => downloadText(state.comparisonText, "log-differences.txt"));

$$('.upload-trigger').forEach((button) => button.addEventListener("click", () => { state.uploadTarget = button.dataset.target; $("#file-input").value = ""; $("#file-input").click(); }));
$("#file-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !state.uploadTarget) return;
  if (file.size > 5 * 1024 * 1024) return showToast("Please choose a file smaller than 5 MB");
  $(`#${state.uploadTarget}`).value = await file.text();
  updateCount(state.uploadTarget, state.uploadTarget.replace(/-input$/, "-count"));
  showToast(`${file.name} loaded`);
});

updateCount("format-input", "format-count"); updateCount("vertical-input", "vertical-count"); updateCount("compare-a-input", "compare-a-count"); updateCount("compare-b-input", "compare-b-count"); updateCount("report-input", "report-count"); registerWebMcpTools();
