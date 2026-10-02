// BTW Aangifte Helper — client-side only. Nothing leaves the browser.

const EU_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"
]);

// Full ISO 3166-1 alpha-2 code list. Country *names* come from Intl.DisplayNames
// so only the codes are hardcoded (typo-proof names). EU_COUNTRIES still decides
// 4a (non-EU) vs 4b (EU); everything here that isn't in EU_COUNTRIES is 4a.
const COUNTRY_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
];
const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);

let _regionNames = null;
function countryName(code) {
  if (!code) return "";
  try {
    if (!_regionNames) _regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return _regionNames.of(code) || code;
  } catch { return code; }
}

// The combobox shows "Netherlands (NL)"; typing the code or the name filters it.
function countryLabel(code) { return `${countryName(code)} (${code})`; }

// name -> code, for resolving a typed full name that wasn't picked from the list.
const NAME_TO_CODE = (() => {
  const m = {};
  for (const c of COUNTRY_CODES) m[countryName(c).toLowerCase()] = c;
  return m;
})();

// Turn whatever the user typed/picked into a canonical code (or "" if unknown).
function resolveCountry(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  const paren = s.match(/\(([A-Za-z]{2})\)\s*$/); // "Netherlands (NL)"
  if (paren && COUNTRY_CODE_SET.has(paren[1].toUpperCase())) return paren[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(s) && COUNTRY_CODE_SET.has(s.toUpperCase())) return s.toUpperCase();
  const byName = NAME_TO_CODE[s.toLowerCase()];
  return byName || "";
}

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

// Two input formats, told apart by their header row rather than guessed column
// by column — a loose match is how a Bench file's "rate" column once passed for
// an exchange rate.
//
//   ninja: Invoice Ninja's expense export. Classification follows Tax Name 1,
//          the VAT is computed at the rate in the form, the country is guessed.
//   bench: Bench's expense export (books → What went out → spreadsheet). It
//          already knows each bill's VAT, whether the charge reversed and where
//          the supplier is, so those are read rather than worked out.
//
// and one for the other side of the return:
//
//   invoices: Invoice Ninja's invoice report — what was billed, with the VAT
//             each invoice charged. Its rows are sales, kept apart from the
//             expenses, so dropping one file never replaces the other kind.
function detectFormat(headers) {
  const set = new Set(headers.map(h => h.trim().toLowerCase()));
  if (set.has("invoice invoice number") || (set.has("invoice amount") && set.has("invoice tax amount"))) return "invoices";
  if (["incurred", "supplier", "net", "vat", "reverse_charge"].every(h => set.has(h))) return "bench";
  if (set.has("expense net amount") || set.has("expense tax name 1")) return "ninja";
  return "unknown";
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
  return /^[A-Za-z]{2}$/.test(code) && COUNTRY_CODE_SET.has(code.toUpperCase());
}

// A typed or exported number, whichever way it was written. The separator that
// comes last is the decimal one when both appear ("1.234,56", "1,234.56"). With
// only one kind: several of them are thousands ("1.234.567"), and a single one
// is a decimal point — a lone dot always, a lone comma always. The old rule
// read a dot before exactly three digits as thousands, which turned an
// exchange rate of 0.921 into 921.
function num(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[^\d,.\-]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma !== -1) {
    s = (s.match(/,/g).length > 1) ? s.split(",").join("") : s.replace(",", ".");
  } else if (lastDot !== -1 && s.match(/\./g).length > 1) {
    s = s.split(".").join("");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// --- Build internal row model from parsed CSV ---
function buildRows(csvRows, format) {
  if (!csvRows.length) return [];
  const headers = csvRows[0];
  if (format === "bench") return buildBenchRows(headers, csvRows.slice(1));
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
      region: "",
      vatRatio: null,
      vatRate: null,
      excluded: false,
    };
  });
}

// Bench rows carry their own answers. `vat` is the tax actually on the bill,
// kept as a ratio of the net so that it follows the net if a cell is corrected
// here — and so a 9% bill is never re-taxed at the rate in the form. A bill
// Bench converted is already in EUR, with what it originally said in the last
// columns; one it couldn't convert stays in its own currency and is flagged.
// Bench defuses a leading formula character with an apostrophe; it is undone
// here because nothing in this page evaluates a cell.
function buildBenchRows(headers, body) {
  const col = name => headers.findIndex(h => h.trim().toLowerCase() === name);
  const at = (cells, name) => { const i = col(name); return i === -1 ? "" : (cells[i] || "").trim(); };
  const text = v => v.replace(/^'(?=[=+\-@])/, "");
  return body.map(cells => {
    const net = num(at(cells, "net"));
    const vat = num(at(cells, "vat"));
    const reverse = at(cells, "reverse_charge").toLowerCase() === "yes";
    const region = at(cells, "supplier_region");
    return {
      date: at(cells, "incurred"),
      vendor: text(at(cells, "supplier")) || text(at(cells, "what")),
      // Bench has no tax name; these are the two this page understands, so the
      // rest of it — and a hand correction in the table — works unchanged.
      tax: reverse ? "Reverse Charge" : vat > 0 ? "VAT (NL)" : "",
      country: "",
      region: region === "eu" || region === "outside_eu" ? region : "",
      net,
      currency: (at(cells, "currency") || "EUR").toUpperCase(),
      converted: 0,
      // Bench's own `rate` column is the rate it already applied — the amounts
      // are in EUR by then — so it is never read as one still to apply.
      exchangeRate: 0,
      vatRatio: net > 0 ? vat / net : 0,
      vatRate: null,
      excluded: false,
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

// --- Tax names ---
// Dutch input VAT comes in two kinds of name: the standard rate, worked out at
// the rate in the form, and the reduced one (laag tarief) — any name with
// "reduced", "laag" or "verlaagd" in it, as tax names are whatever was typed
// into the expense system — at 9% unless the row is given a rate of its own.
const REDUCED_RATE = 9;
const isReduced = tax => /\b(reduced|laag|verlaagd)\b/.test(tax);
const isNlVat = tax => tax.startsWith("vat (nl") || isReduced(tax);
const nameRate = tax => isReduced(tax) ? REDUCED_RATE : null;

// --- Classify a single row ---
function classify(row, rcRate) {
  const tax = row.tax.toLowerCase();
  const eur = netInEur(row);
  const result = { netEur: eur, vatEur: 0, rubriek: "none", flags: [], rate: null, rateFromForm: false };

  if (row.currency !== "EUR" && !row.converted && !row.exchangeRate) {
    result.flags.push(row.vatRatio !== null
      ? `Not converted in Bench (${row.currency}) — give it a rate there, or type one in the Rate column.`
      : "No converted amount or exchange rate for non-EUR row.");
  }

  // A Bench row brings the VAT that was on the bill; anything else is worked
  // out at the rate typed on the row, else the one its tax name implies, else
  // the rate in the form.
  const ownRate = row.vatRatio !== null ? row.vatRatio * 100 : row.vatRate ?? nameRate(tax);
  const rate = ownRate ?? rcRate;
  const vatOf = n => {
    result.rate = rate;
    result.rateFromForm = ownRate === null;
    return row.vatRatio !== null ? Math.round(n * row.vatRatio * 100) / 100 : n * (rate / 100);
  };

  if (tax === "reverse charge") {
    result.vatEur = vatOf(eur);
    // A country picked here wins; otherwise the region Bench was told.
    const inEu = row.country ? EU_COUNTRIES.has(row.country)
      : row.region ? row.region === "eu"
      : null;
    if (inEu === null) {
      result.rubriek = "none";
      result.flags.push(row.vatRatio !== null
        ? "Reverse charge, but Bench doesn't say where the supplier is — set the country here, or the supplier in Bench."
        : "Reverse charge with no country — set it: NL goes in 2a, the EU in 4b, outside the EU in 4a.");
    } else {
      // A Dutch supplier reversing the charge is the domestic scheme, 2a —
      // not 4b, though the Netherlands is in the EU.
      result.rubriek = row.country === "NL" ? "2a" : inEu ? "4b" : "4a";
    }
  } else if (isNlVat(tax) || row.vatRate !== null || row.vatRatio > 0) {
    // A rate typed on the row (or VAT Bench says was on the bill) means it
    // carried Dutch VAT, whatever its name.
    // NL input VAT (voorbelasting): deductible in 5b only.
    result.vatEur = vatOf(eur);
    result.rubriek = "5b";
  } else if (tax) {
    result.rubriek = "none";
    result.flags.push(`Unrecognized Tax Name 1: "${row.tax}" — use Reverse Charge, VAT (NL) or Reduced VAT, or type its VAT % if it is Dutch VAT.`);
  } else {
    result.rubriek = "none";
  }
  return result;
}

// --- Compute all totals ---
// Every row in the file counts unless it is unticked in the table. Choosing the
// period is the export's job — Bench and Invoice Ninja can both export a
// quarter — so this page adds up what it was given, less what was set aside.
function computeTotals(rows, rcRate) {
  const t = { "2a-net": 0, "2a-vat": 0, "4a-net": 0, "4a-vat": 0, "4b-net": 0, "4b-vat": 0, "5b": 0 };
  const classified = rows.map((r, i) => ({ row: r, c: classify(r, rcRate), i }));
  for (const { row, c } of classified) {
    if (row.excluded) continue;
    if (c.rubriek === "2a") { t["2a-net"] += c.netEur; t["2a-vat"] += c.vatEur; t["5b"] += c.vatEur; }
    else if (c.rubriek === "4a") { t["4a-net"] += c.netEur; t["4a-vat"] += c.vatEur; t["5b"] += c.vatEur; }
    else if (c.rubriek === "4b") { t["4b-net"] += c.netEur; t["4b-vat"] += c.vatEur; t["5b"] += c.vatEur; }
    else if (c.rubriek === "5b") { t["5b"] += c.vatEur; }
  }
  return { totals: t, classified };
}

// --- Sales: Invoice Ninja's invoice report ---
// The VAT is what each invoice actually charged (`Invoice Tax Amount`), and the
// net is the amount less it — so line-item taxes, discounts and surcharges are
// all already in. A draft, cancelled or reversed invoice was never turnover, so
// it arrives unticked. Ninja's exchange rate is client currency per euro; it
// is turned round here into euros per unit, the way the expense side reads.
const NOT_TURNOVER = new Set(["draft", "cancelled", "reversed"]);

function buildInvoiceRows(headers, body) {
  const col = name => headers.findIndex(h => h.trim().toLowerCase() === name);
  const at = (cells, ...names) => {
    for (const n of names) { const i = col(n); if (i !== -1) return (cells[i] || "").trim(); }
    return "";
  };
  const has = name => col(name) !== -1;
  return body.map(cells => {
    const client = at(cells, "client name");
    const amount = num(at(cells, "invoice amount"));
    const vat = has("invoice tax amount") ? num(at(cells, "invoice tax amount"))
      : amount - num(at(cells, "invoice subtotal"));
    const currency = (at(cells, "invoice currency", "client currency") || "EUR").toUpperCase();
    const ninjaRate = num(at(cells, "invoice exchange rate"));
    const status = at(cells, "invoice status");
    return {
      date: at(cells, "invoice date"),
      number: at(cells, "invoice invoice number", "invoice number"),
      vendor: client,
      country: resolveCountry(at(cells, "client country")) || vendorMap[client.toLowerCase()] || "",
      currency,
      net: Math.round((amount - vat) * 100) / 100,
      vat,
      exchangeRate: currency !== "EUR" && ninjaRate ? Math.round(1e6 / ninjaRate) / 1e6 : 0,
      status,
      excluded: NOT_TURNOVER.has(status.toLowerCase()),
    };
  });
}

// Which rubriek a sale belongs in. Taxed: by the rate it works out to — 21% in
// 1a, 9% in 1b, anything else in 1c. Untaxed: by where the client is — the
// Netherlands in 1e, another EU country in 3b (reverse-charged, and on the ICP
// listing too), outside the EU nowhere: a service to a business there is taxed
// there and is left off the Dutch return.
function classifySale(row) {
  const toEur = n => row.currency === "EUR" || !row.currency ? n
    : row.exchangeRate ? Math.round(n * row.exchangeRate * 100) / 100 : n;
  const result = { netEur: toEur(row.net), vatEur: toEur(row.vat), rubriek: "none", flags: [], rate: null };
  if (row.currency !== "EUR" && !row.exchangeRate) {
    result.flags.push(`No exchange rate for this ${row.currency} invoice — type euros per ${row.currency} in the Rate column.`);
  }
  if (Math.abs(row.vat) >= 0.005) {
    const rate = row.net ? row.vat / row.net * 100 : 0;
    result.rate = rate;
    result.rubriek = Math.abs(rate - 21) < 0.5 ? "1a" : Math.abs(rate - REDUCED_RATE) < 0.5 ? "1b" : "1c";
  } else if (!row.country) {
    result.rate = 0;
    result.flags.push("No VAT charged and no client country — set it: NL goes in 1e, the EU in 3b, outside the EU off the return.");
  } else {
    result.rate = 0;
    result.rubriek = row.country === "NL" ? "1e" : EU_COUNTRIES.has(row.country) ? "3b" : "out";
  }
  return result;
}

function computeSalesTotals(rows) {
  const t = { "1a-net": 0, "1a-vat": 0, "1b-net": 0, "1b-vat": 0, "1c-net": 0, "1c-vat": 0, "1e-net": 0, "3b-net": 0 };
  const classified = rows.map((r, i) => ({ row: r, c: classifySale(r), i }));
  for (const { row, c } of classified) {
    if (row.excluded || !(`${c.rubriek}-net` in t)) continue;
    t[`${c.rubriek}-net`] += c.netEur;
    if (`${c.rubriek}-vat` in t) t[`${c.rubriek}-vat`] += c.vatEur;
  }
  return { totals: t, classified };
}

// --- Formatting ---
const fmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
function euro(n) { return fmt.format(n || 0); }

// --- State + render ---
let state = { rows: [], rcRate: 21, format: "", sales: [] };

const FORMAT_LABELS = {
  bench: "Bench export — VAT, reverse charge and supplier region read from the file",
  ninja: "Invoice Ninja export — classified by Tax Name 1, VAT at each row's VAT %",
  unknown: "Columns not recognised — read as Invoice Ninja; check the rows below",
};
const SALES_LABEL = "Invoice Ninja invoice report — each invoice's own VAT, rubriek by its rate or the client's country";
const RUBRIEK_TEXT = { none: "—", out: "not on return" };

function render() {
  ensureCountryDatalist();
  const { totals, classified } = computeTotals(state.rows, state.rcRate);
  const sales = computeSalesTotals(state.sales);

  const formatEl = document.getElementById("format");
  formatEl.textContent = [
    state.format && `Expenses read as: ${FORMAT_LABELS[state.format]}`,
    state.sales.length && `Invoices read as: ${SALES_LABEL}`,
  ].filter(Boolean).join(" · ");
  // The rate in the form only applies where the file doesn't bring its own.
  document.getElementById("rcRate").disabled = state.format === "bench";

  // 5a is all the VAT owed — on sales, and the reverse-charged VAT on
  // purchases; 5c is what is left once the voorbelasting in 5b comes off it.
  const all = { ...totals, ...sales.totals };
  all["5a"] = all["1a-vat"] + all["1b-vat"] + all["1c-vat"] + all["2a-vat"] + all["4a-vat"] + all["4b-vat"];
  all["5c"] = all["5a"] - all["5b"];
  for (const [key, val] of Object.entries(all)) {
    const el = document.querySelector(`[data-t="${key}"]`);
    if (el) el.textContent = euro(key === "5c" ? Math.abs(val) : val);
  }
  document.getElementById("result-label").textContent = all["5c"] < 0 ? "5c · to reclaim" : "5c · to pay";
  // 1c and 2a are rare; their boxes show only when something lands there.
  document.querySelectorAll(".box-1c").forEach(b => { b.hidden = !all["1c-net"]; });
  document.querySelectorAll(".box-2a").forEach(b => { b.hidden = !all["2a-net"]; });

  const flags = [];
  // An excluded row has nothing left to review.
  sales.classified.forEach(({ row, c, i }) => {
    if (row.excluded) return;
    c.flags.forEach(f => flags.push({ msg: `Invoice ${row.number || i + 1} · ${row.vendor || "—"}: ${f}` }));
  });
  classified.forEach(({ row, c, i }) => {
    if (row.excluded) return;
    c.flags.forEach(f => flags.push({ i, msg: `Row ${i + 1} · ${row.vendor || "—"}: ${f}` }));
  });

  const flagList = document.getElementById("flags");
  flagList.innerHTML = "";
  flags.forEach(f => {
    const li = document.createElement("li");
    li.textContent = f.msg;
    flagList.appendChild(li);
  });
  document.getElementById("flagCount").textContent = flags.length;

  renderSales(sales.classified);

  const tbody = document.querySelector("#rows tbody");
  tbody.innerHTML = "";
  const flaggedRowIdx = new Set(flags.filter(f => f.i !== undefined).map(f => f.i));
  classified.forEach(({ row, c, i }) => {
    const tr = document.createElement("tr");
    if (flaggedRowIdx.has(i)) tr.classList.add("flagged");
    if (row.excluded) tr.classList.add("excluded");
    tr.dataset.i = i;
    tr.appendChild(countCell(row));
    tr.appendChild(td(row.date, "date"));
    tr.appendChild(td(row.vendor, "vendor"));
    tr.appendChild(td(row.tax, "tax"));
    tr.appendChild(rateCell(row, c));
    tr.appendChild(countryCell(row));
    tr.appendChild(td(row.net, "net", true, true));
    tr.appendChild(td(row.currency, "currency"));
    tr.appendChild(td(row.exchangeRate || "", "exchangeRate", true, true));
    tr.appendChild(td(euro(c.netEur), null, false, true));
    tr.appendChild(td(euro(c.vatEur), null, false, true));
    tr.appendChild(rubriekCell(row, c));
    tbody.appendChild(tr);
  });
  document.getElementById("rowCount").textContent = countText(state.rows);
}

// The invoices table: only there once an invoice report has been dropped.
function renderSales(classified) {
  document.getElementById("salesCard").hidden = !state.sales.length;
  const tbody = document.querySelector("#sales tbody");
  tbody.innerHTML = "";
  classified.forEach(({ row, c, i }) => {
    const tr = document.createElement("tr");
    if (!row.excluded && c.flags.length) tr.classList.add("flagged");
    if (row.excluded) tr.classList.add("excluded");
    tr.dataset.i = i;
    tr.appendChild(countCell(row));
    tr.appendChild(td(row.date, "date"));
    tr.appendChild(td(row.number, null, false));
    tr.appendChild(td(row.vendor, null, false));
    tr.appendChild(td(row.status, null, false));
    tr.appendChild(countryCell(row));
    tr.appendChild(td(row.net, "net", true, true));
    tr.appendChild(td(row.currency, "currency"));
    tr.appendChild(td(row.exchangeRate || "", "exchangeRate", true, true));
    tr.appendChild(td(c.rate === null ? "" : String(Math.round(c.rate * 100) / 100), null, false, true));
    tr.appendChild(td(euro(c.netEur), null, false, true));
    tr.appendChild(td(euro(c.vatEur), null, false, true));
    tr.appendChild(rubriekCell(row, c));
    tbody.appendChild(tr);
  });
  document.getElementById("salesCount").textContent = countText(state.sales);
}

function rubriekCell(row, c) {
  const cell = document.createElement("td");
  const tag = document.createElement("span");
  const rubriek = row.excluded ? "excluded" : c.rubriek;
  tag.className = `rubriek-tag rubriek-${row.excluded || c.rubriek === "out" ? "none" : c.rubriek}`;
  tag.textContent = RUBRIEK_TEXT[rubriek] || rubriek;
  cell.appendChild(tag);
  return cell;
}

function countText(rows) {
  const excluded = rows.filter(r => r.excluded).length;
  return excluded ? `${rows.length - excluded} of ${rows.length}` : rows.length;
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

// Count cell: a tick that, cleared, leaves the row in the table but out of
// every total — for an expense that made it into the export but isn't part of
// this return.
function countCell(row) {
  const cell = document.createElement("td");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !row.excluded;
  box.dataset.field = "excluded";
  box.setAttribute("aria-label", `Count ${row.vendor || "this row"} in the totals`);
  cell.appendChild(box);
  return cell;
}

// VAT % cell: the rate the row's VAT was worked out at. Greyed when it is only
// the form's rate passing through, so typing one here is what pins it. The
// shown text is kept so that tabbing through without typing changes nothing —
// otherwise a Bench bill's exact VAT would be rounded to the displayed rate.
function rateCell(row, c) {
  const shown = c.rate !== null ? String(Math.round(c.rate * 100) / 100)
    : row.vatRate !== null ? String(row.vatRate) : "";
  const cell = td(shown, "vatRate", true, true);
  cell.dataset.shown = shown;
  if (c.rateFromForm) cell.classList.add("inherited");
  return cell;
}

// One shared <datalist> of every country, built once and kept out of the tbody
// (which render() wipes each pass). Options are "Netherlands (NL)" so the native
// combobox filters as you type either the name or the code.
const COUNTRY_LIST_ID = "country-codes";
function ensureCountryDatalist() {
  if (document.getElementById(COUNTRY_LIST_ID)) return;
  const dl = document.createElement("datalist");
  dl.id = COUNTRY_LIST_ID;
  for (const code of COUNTRY_CODES) {
    const opt = document.createElement("option");
    opt.value = countryLabel(code);
    dl.appendChild(opt);
  }
  document.body.appendChild(dl);
}

// Country cell: a searchable combobox bound to the shared datalist. Free typing
// is allowed but resolved to a canonical code on change, so 4a/4b stays reliable.
function countryCell(row) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", COUNTRY_LIST_ID);
  input.className = "country-input";
  input.dataset.field = "country";
  // A Bench row may already know which side of the EU border its supplier is
  // on without naming a country; say so rather than show an empty box.
  input.placeholder = row.region === "eu" ? "EU · Bench"
    : row.region === "outside_eu" ? "non-EU · Bench"
    : "search…";
  input.value = COUNTRY_CODE_SET.has(row.country) ? countryLabel(row.country) : (row.country || "");
  cell.appendChild(input);
  return cell;
}

// --- Edits recompute live ---
// Both tables share these handlers; a row is found in whichever list its table
// shows.
const rowOf = el => {
  const tr = el.closest("tr");
  const list = tr.closest("table").id === "sales" ? state.sales : state.rows;
  return list[Number(tr.dataset.i)];
};
const tables = document.querySelectorAll("#rows tbody, #sales tbody");
const onRows = (type, fn, capture) => tables.forEach(t => t.addEventListener(type, fn, capture));

onRows("blur", (e) => {
  const cell = e.target.closest("td[contenteditable]");
  if (!cell) return;
  const field = cell.dataset.field;
  const row = rowOf(cell);
  if (!row) return;
  const raw = cell.textContent.trim();

  if (field === "vatRate") {
    if (raw === cell.dataset.shown) return;
    const rate = raw === "" ? null : num(raw);
    // A Bench row's VAT is a ratio of its net; a rate typed over it replaces
    // that, and clearing it leaves the bill's own VAT in place.
    if (row.vatRatio !== null) { if (rate !== null) row.vatRatio = rate / 100; }
    else row.vatRate = rate;
  }
  else if (["net", "exchangeRate"].includes(field)) row[field] = num(raw);
  else row[field] = raw;
  render();
}, true);

// Enter commits a cell rather than adding a line to it.
onRows("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("td[contenteditable]")) {
    e.preventDefault();
    e.target.blur();
  }
});

// Country is a combobox <input>, committing on "change" (blur / Enter / pick).
// Resolve the typed/picked text to a canonical code, then persist to the
// vendor->country map so the same vendor auto-fills next time.
onRows("change", (e) => {
  const box = e.target.closest("input[data-field='excluded']");
  if (box) {
    const row = rowOf(box);
    if (row) { row.excluded = !box.checked; render(); }
    return;
  }
  const input = e.target.closest("input[data-field='country']");
  if (!input) return;
  const row = rowOf(input);
  if (!row) return;
  row.country = resolveCountry(input.value);
  if (row.vendor) { vendorMap[row.vendor.trim().toLowerCase()] = row.country; saveVendorMap(vendorMap); }
  render();
});

// --- File loading ---
// An invoice report fills the sales side and an expense export the purchases
// side; each replaces only its own, so the two can be dropped in either order
// or together.
function ingest(text) {
  const csv = parseCSV(text);
  const format = csv.length ? detectFormat(csv[0]) : "";
  if (format === "invoices") {
    state.sales = buildInvoiceRows(csv[0], csv.slice(1));
  } else {
    state.format = format;
    state.rows = buildRows(csv, format);
  }
  render();
}
const ingestFiles = files => Promise.all([...files].map(f => f.text())).then(texts => texts.forEach(ingest));

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  ingestFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => {
  ingestFiles(fileInput.files);
  fileInput.value = "";
});

document.getElementById("rcRate").addEventListener("input", (e) => {
  state.rcRate = num(e.target.value);
  render();
});
document.getElementById("recalc").addEventListener("click", render);

// Embedded fallback sample so the button works even without the file served.
const SAMPLE_CSV = `Expense Date,Expense Vendor,Expense Net Amount,Expense Tax Name 1,Expense Currency,Expense Converted Amount,Expense Exchange Rate
2026-04-03,Hetzner (DE),49.00,Reverse Charge,EUR,,
2026-04-08,AWS - IE,120.50,Reverse Charge,EUR,,
2026-04-12,GitHub (US),21.00,Reverse Charge,USD,19.35,0.9214
2026-05-02,Coolblue,89.99,VAT (NL),EUR,,
2026-05-19,Figma (US),144.00,Reverse Charge,USD,132.60,0.9208
2026-06-01,KPN,60.00,VAT (NL),EUR,,
2026-06-11,Some Vendor,30.00,,EUR,,`;

document.getElementById("loadSample").addEventListener("click", () => {
  fetch("sample.csv").then(r => r.text()).then(ingest).catch(() => {
    ingest(SAMPLE_CSV);
  });
});

render();
