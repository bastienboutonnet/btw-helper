# BTW Aangifte Helper

A single-page tool for preparing your quarterly Dutch VAT return (omzetbelasting).
Drop an expense CSV export — from **Invoice Ninja** or from **Bench** — and it derives
the rubriek totals: **4a** and **4b** for reverse-charge purchases, **5b** for all
deductible input VAT (voorbelasting).

Everything runs client-side in the browser. **Nothing is uploaded and nothing is
filed** — it only computes the numbers you then type into Mijn Belastingdienst.

## What it does

- **4a / 4b** — reverse-charge purchases, split by where the supplier is (4a non-EU, 4b EU)
- **5b** — all deductible input VAT, including the reverse-charge VAT (which nets to €0
  but must appear in both boxes)
- Every row in the file counts — export just the quarter you're filing
- Editable table with live-recomputing totals and a flags-to-review list

## Input formats

The format is recognised from the header row, never guessed column by column.

**Invoice Ninja** (`Expense Vendor`, `Expense Net Amount`, `Expense Tax Name 1`,
`Expense Currency`, `Expense Converted Amount`, optionally `Expense Exchange Rate`,
`Expense Date`):

- `Reverse Charge` → net + VAT at the form's rate into 4a/4b by country, the same VAT into 5b
- `VAT (NL)` → VAT at the form's rate into 5b only
- `Reduced VAT` → VAT at 9% (laag tarief) into 5b only
- Any row's rate can be overridden in the table's **VAT %** column (greyed while it's
  just the form's default)
- Vendor country: saved map (localStorage) → detected from the vendor name
  (`Acme (DE)` or `Acme – DE`) → else you set it in the table
- Non-EUR rows use the Converted Amount when present, otherwise Amount × Exchange Rate

**Bench** (the books → What went out → *Spreadsheet of bills dated* → the quarter;
columns `incurred`, `supplier`, `currency`, `net`, `vat`, `reverse_charge`,
`supplier_region`, …):

- Each bill's own `vat` is used, so a 9% bill stays 9% — the form's rate is ignored.
  The **VAT %** column shows the rate it works out to; typing one there overrides it
- `reverse_charge = yes` → 4a/4b by `supplier_region` (`outside_eu` / `eu`); a country
  picked in the table overrides it. No region → flagged
- Any other bill with VAT → 5b
- Bench cuts the export by the date on the bill, which is what a return is cut by
- A bill given a rate in Bench arrives in EUR already. One without stays in its own
  currency and is flagged until you type a rate in the table

Bench counts any VAT on a bill as reclaimable. A bill carrying foreign VAT (a German
hotel, say) isn't reclaimable on a Dutch return — log it in Bench at 0%.

## Run locally (no build step)

It's plain HTML/CSS/JS. Any static server works:

```sh
cd src
python3 -m http.server 8080
# open http://localhost:8080
```

## Run with Docker

```sh
docker build -t btw-helper .
docker run --rm -p 8080:80 btw-helper
# open http://localhost:8080
```

## Deploy from GHCR (home lab)

On every push to `main` (and on `v*` tags), the `publish` workflow builds a
multi-arch image and pushes it to GitHub Container Registry. Your Ansible
playbooks in `~/repos/homelab` then pull that package.

Image tags produced:
- `ghcr.io/bastienboutonnet/btw-helper:latest` (main branch)
- `ghcr.io/bastienboutonnet/btw-helper:1.2.0`, `:1.2` (from `vX.Y.Z` tags)
- `ghcr.io/bastienboutonnet/btw-helper:sha-<short>`

Pull and run on the host:

```sh
docker pull ghcr.io/bastienboutonnet/btw-helper:latest
docker run -d --name btw-helper -p 8080:80 --restart unless-stopped \
  ghcr.io/bastienboutonnet/btw-helper:latest
```

For your Ansible role, point at the image and expose the port however your other
home-lab services do it, e.g.:

```yaml
- name: Run BTW Aangifte Helper
  community.docker.docker_container:
    name: btw-helper
    image: ghcr.io/bastienboutonnet/btw-helper:latest
    pull: true
    restart_policy: unless-stopped
    ports:
      - "8080:80"
```

> The package is private by default. Either make it public in the repo's
> **Packages** settings, or give the host a pull token (a PAT with `read:packages`,
> `docker login ghcr.io`).

## First push

```sh
git init
git add .
git commit -m "Initial commit: BTW Aangifte Helper"
git branch -M main
git remote add origin git@github.com:bastienboutonnet/btw-helper.git
git push -u origin main
```

Cutting a versioned release (triggers a semver-tagged image):

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Layout

```
btw-helper/
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── sample.csv          # committed sample so the tool works out of the box
├── Dockerfile
├── nginx.conf
├── .github/workflows/publish.yml
├── .gitignore              # ignores real *.csv exports (keeps src/sample.csv)
├── LICENSE                 # MIT
└── README.md
```

## Notes

- Real expense exports are git-ignored so financial data never gets committed.
  Only `src/sample.csv` is tracked.
- The default VAT rate is adjustable in the UI (21%); per row in the **VAT %** column.
- Classification logic lives in `src/app.js` (`classify` and `computeTotals`) —
  that's the place to extend as your expense categories grow.
