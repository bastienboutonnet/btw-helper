// BTW Aangifte Helper — client-side only. Nothing leaves the browser.

const EU_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"
]);

// Persisted vendor -> country map (localStorage).
const VENDOR_MAP_KEY = "btw.vendorCountry";
function loadVendorMap() {
  try { return JSON.parse(localStorage.getItem(VENDOR_MAP_KEY)) || {}; }
  catch { return {}; }
}
function saveVendorMap(map) {
  try { localStorage.setItem(VENDOR_MAP_KEY, JSON.stringify(map)); } catch {}
}
let vendorMap = loadVendorMap();

// --- CSV parsing (handles quotes, commas, and newlines inside quotes) ---
function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

function headerIndex(headers) {
  const norm = h => h.trim().toLowerCase();
  const find = (...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => norm(h) === n);
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    date:      find("expense date", "date"),
    vendor:    find("expense vendor", "vendor"),
    net:       find("expense net amount", "net amount", "amount"),
    tax:       find("expense tax name 1", "tax name 1", "tax name"),
    currency:  find("expense currency", "currency"),
    converted: find("expense converted amount", "converted amount"),
    rate:      find("expense exchange rate", "exchange rate", "rate"),
  };
}

// --- Country detection from vendor name ---
// e.g. "Acme (DE)" or "Acme – DE" or "Acme - fr"
function detectCountry(vendor) {
  if (!vendor) return "";
  const bracket = vendor.match(/[([]\s*([A-Za-z]{2})\s*[)\]]/);
  if (bracket && isCountryCode(bracket[1])) return bracket[1].toUpperCase();
  const dash = vendor.match(/[-–—]\s*([A-Za-z]{2})\s*$/);
  if (dash && isCountryCode(dash[1])) return dash[1].toUpperCase();
  return "";
}
function isCountryCode(code) {
  return /^[A-Za-z]{2}$/.test(code) &&
    (EU_COUNTRIES.has(code.toUpperCase()) || code.toUpperCase() === "GB" || code.toUpperCase() === "US" || code.toUpperCase() === "CH" || code.toUpperCase() === "NO");
}

function num(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// --- Build internal row model from parsed CSV ---
function buildRows(csvRows) {
  if (!csvRows.length) return [];
  const headers = csvRows[0];
  const idx = headerIndex(headers);
  return csvRows.slice(1).map(cells => {
    const vendor = cells[idx.vendor] || "";
    const savedCountry = vendorMap[vendor.trim().toLowerCase()];
    return {
      date: cells[idx.date] || "",
      vendor,
      tax: (cells[idx.tax] || "").trim(),
      country: savedCountry || detectCountry(vendor),
      net: num(cells[idx.net]),
      currency: (cells[idx.currency] || "EUR").trim().toUpperCase(),
      converted: idx.converted !== -1 ? num(cells[idx.converted]) : 0,
      exchangeRate: idx.rate !== -1 ? num(cells[idx.rate]) : 0,
    };
  });
}

// --- Convert a row's net to EUR ---
function netInEur(row) {
  if (row.currency === "EUR" || !row.currency) return row.net;
  if (row.converted) return row.converted;
  if (row.exchangeRate) return row.net * row.exchangeRate;
  return row.net; // fall back; will be flagged
}

// --- Classify a single row ---
function classify(row, rcRate) {
  const tax = row.tax.toLowerCase();
  const eur = netInEur(row);
  const result = { netEur: eur, vatEur: 0, rubriek: "none", flags: [] };

  if (row.currency !== "EUR" && !row.converted && !row.exchangeRate) {
    result.flags.push("No converted amount or exchange rate for non-EUR row.");
  }

  if (tax === "reverse charge") {
    result.vatEur = eur * (rcRate / 100);
    if (!row.country) {
      result.rubriek = "none";
      result.flags.push("Reverse charge with no country — set 4a (non-EU) or 4b (EU).");
    } else if (EU_COUNTRIES.has(row.country)) {
      result.rubriek = "4b";
    } else {
      result.rubriek = "4a";
    }
  } else if (tax === "vat (nl)" || tax.startsWith("vat (nl")) {
    // NL input VAT — needs a VAT amount. If none provided, flag it.
    result.vatEur = 0; // amount comes from a VAT column if present; otherwise user edits
    result.rubriek = "5b";
    result.flags.push("VAT (NL) row — confirm the input VAT amount in the VAT column.");
  } else if (tax) {
    result.rubriek = "none";
    result.flags.push(`Unrecognized Tax Name 1: "${row.tax}".`);
  } else {
    result.rubriek = "none";
  }
  return result;
}

// --- Compute all totals ---
function computeTotals(rows, rcRate) {
  const t = { "4a-net": 0, "4a-vat": 0, "4b-net": 0, "4b-vat": 0, "5b": 0 };
  const classified = rows.map(r => ({ row: r, c: classify(r, rcRate) }));
  for (const { c } of classified) {
    if (c.rubriek === "4a") { t["4a-net"] += c.netEur; t["4a-vat"] += c.vatEur; t["5b"] += c.vatEur; }
    else if (c.rubriek === "4b") { t["4b-net"] += c.netEur; t["4b-vat"] += c.vatEur; t["5b"] += c.vatEur; }
    else if (c.rubriek === "5b") { t["5b"] += c.vatEur; }
  }
  return { totals: t, classified };
}

// --- Formatting ---
const fmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
function euro(n) { return fmt.format(n || 0); }

// --- State + render ---
let state = { rows: [], rcRate: 21 };

function render() {
  const { totals, classified } = computeTotals(state.rows, state.rcRate);

  for (const [key, val] of Object.entries(totals)) {
    const el = document.querySelector(`[data-t="${key}"]`);
    if (el) el.textContent = euro(val);
  }

  const flags = [];
  classified.forEach(({ row, c }, i) => {
    c.flags.forEach(f => flags.push({ i, vendor: row.vendor, msg: f }));
  });

  const flagList = document.getElementById("flags");
  flagList.innerHTML = "";
  flags.forEach(f => {
    const li = document.createElement("li");
    li.textContent = `Row ${f.i + 1} · ${f.vendor || "—"}: ${f.msg}`;
    flagList.appendChild(li);
  });
  document.getElementById("flagCount").textContent = flags.length;

  const tbody = document.querySelector("#rows tbody");
  tbody.innerHTML = "";
  const flaggedRowIdx = new Set(flags.map(f => f.i));
  classified.forEach(({ row, c }, i) => {
    const tr = document.createElement("tr");
    if (flaggedRowIdx.has(i)) tr.classList.add("flagged");
    tr.dataset.i = i;
    tr.appendChild(td(row.date, "date"));
    tr.appendChild(td(row.vendor, "vendor"));
    tr.appendChild(td(row.tax, "tax"));
    tr.appendChild(td(row.country, "country"));
    tr.appendChild(td(row.net, "net", true, true));
    tr.appendChild(td(row.currency, "currency"));
    tr.appendChild(td(row.exchangeRate || "", "exchangeRate", true, true));
    tr.appendChild(td(euro(c.netEur), null, false, true));
    tr.appendChild(td(euro(c.vatEur), null, false, true));
    const rub = document.createElement("td");
    rub.innerHTML = `<span class="rubriek-tag rubriek-${c.rubriek}">${c.rubriek === "none" ? "—" : c.rubriek}</span>`;
    tr.appendChild(rub);
    tbody.appendChild(tr);
  });
  document.getElementById("rowCount").textContent = state.rows.length;
}

function td(value, field, editable = true, numeric = false) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (numeric) cell.classList.add("num");
  if (field && editable) {
    cell.contentEditable = "true";
    cell.dataset.field = field;
  }
  return cell;
}

// --- Edits recompute live ---
document.querySelector("#rows tbody").addEventListener("blur", (e) => {
  const cell = e.target.closest("td[contenteditable]");
  if (!cell) return;
  const tr = cell.closest("tr");
  const i = Number(tr.dataset.i);
  const field = cell.dataset.field;
  const row = state.rows[i];
  if (!row) return;
  const raw = cell.textContent.trim();

  if (["net", "converted", "exchangeRate"].includes(field)) row[field] = num(raw);
  else if (field === "country") {
    row.country = raw.toUpperCase();
    if (row.vendor) { vendorMap[row.vendor.trim().toLowerCase()] = row.country; saveVendorMap(vendorMap); }
  }
  else row[field] = raw;
  render();
}, true);

// --- File loading ---
function ingest(text) {
  state.rows = buildRows(parseCSV(text));
  render();
}

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (file) file.text().then(ingest);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) file.text().then(ingest);
});

document.getElementById("rcRate").addEventListener("input", (e) => {
  state.rcRate = num(e.target.value);
});
document.getElementById("recalc").addEventListener("click", render);

document.getElementById("loadSample").addEventListener("click", () => {
  fetch("sample.csv").then(r => r.text()).then(ingest).catch(() => {
    ingest(SAMPLE_CSV);
  });
});

// Embedded fallback sample so the button works even without the file served.
const SAMPLE_CSV = `Expense Date,Expense Vendor,Expense Net Amount,Expense Tax Name 1,Expense Currency,Expense Converted Amount,Expense Exchange Rate
2026-04-03,Hetzner (DE),49.00,Reverse Charge,EUR,,
2026-04-08,AWS - IE,120.50,Reverse Charge,EUR,,
2026-04-12,GitHub (US),21.00,Reverse Charge,USD,19.35,0.9214
2026-05-02,Coolblue,89.99,VAT (NL),EUR,,
2026-05-19,Figma (US),144.00,Reverse Charge,USD,132.60,0.9208
2026-06-01,KPN,60.00,VAT (NL),EUR,,
2026-06-11,Some Vendor,30.00,,EUR,,`;

render();
