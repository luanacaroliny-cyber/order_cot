import { mkdir, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const SPREADSHEET_ID = "1Y9CX9Sfv0EG0474VQnRnAdN1O27z8RVYqMOPqdLg3FI";
const PART_SIZE = 24_000;
const OUTPUT_DIR = new URL("../public/data-parts/", import.meta.url);

const sheets = [
  { key: "bd", source: "bd", gid: "0" },
  { key: "backlog", source: "backlog", gid: "35690987" },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function asBoolean(value) {
  return !["", "0", "0.0", "false", "não", "nao", "none"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function asInteger(value) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalize(rows, source) {
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  const column = Object.fromEntries(headers.map((name, index) => [name, index]));
  const get = (row, name) => row[column[name]] ?? "";

  return rows.slice(1).flatMap((row) => {
    const order = get(row, "wms_order_no").trim();
    if (!order) return [];
    return [{
      src: source,
      o: order,
      p: get(row, "parcel_id").trim(),
      t: get(row, "lm_tracking_number").trim(),
      w: get(row, "whs_id").trim(),
      d: get(row, "cut_off_date").trim().slice(0, 10),
      dt: get(row, "cut_off_datetime").trim(),
      sc: get(row, "status_code").trim(),
      s: get(row, "status_label").trim() || "Sem status",
      u: asBoolean(get(row, "urgent_flag")),
      x: asBoolean(get(row, "oos_flag")),
      ch: get(row, "channel_name").trim(),
      q: asInteger(get(row, "order_total_item_qty")),
      l: get(row, "latest_update_datetime").trim(),
    }];
  });
}

async function downloadSheet(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Google Sheets respondeu ${response.status}`);
  const csv = await response.text();
  if (/<!doctype html|<html/i.test(csv)) {
    throw new Error("A planilha não está disponível para leitura pública por link.");
  }
  return parseCsv(csv);
}

const payload = { updatedAt: new Date().toISOString(), bd: [], backlog: [] };
for (const sheet of sheets) {
  payload[sheet.key] = normalize(await downloadSheet(sheet.gid), sheet.source);
}

const compressed = gzipSync(JSON.stringify(payload));
await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
const partCount = Math.ceil(compressed.length / PART_SIZE);
for (let offset = 0, part = 0; offset < compressed.length; offset += PART_SIZE, part += 1) {
  const filename = `part-${String(part).padStart(3, "0")}`;
  await writeFile(new URL(filename, OUTPUT_DIR), compressed.subarray(offset, offset + PART_SIZE));
}
await writeFile(
  new URL("manifest.json", OUTPUT_DIR),
  JSON.stringify({ parts: partCount, updatedAt: payload.updatedAt }),
);

console.log(JSON.stringify({
  updatedAt: payload.updatedAt,
  bd: payload.bd.length,
  backlog: payload.backlog.length,
  bytes: compressed.length,
  parts: partCount,
}));
