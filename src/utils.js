import { AREA_ID_KEYS, AREA_NAME_KEYS, DEPOTS, MUNICIPALITY_KEYS, ZIP_KEYS } from "./config.js";

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.length > 1 || String(row[0] || "").trim()) {
    rows.push(row);
  }

  return rows;
}

export function normalizeHeader(value) {
  return String(value || "")
    .replace(/\ufeff/g, "")
    .trim()
    .toLowerCase();
}

export function pickCsvValue(row, indexByHeader, keys) {
  for (const key of keys) {
    const idx = indexByHeader.get(String(key).toLowerCase());
    if (idx === undefined) {
      continue;
    }
    const value = row[idx];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function collectPostalCodes(raw) {
  const input = String(raw || "").trim();
  if (!input) {
    return [];
  }
  const codes = [];
  const re = /(\d{3})-?(\d{4})/g;
  let m = re.exec(input);
  while (m) {
    const code = `${m[1]}${m[2]}`;
    if (code.length === 7) {
      codes.push(code);
    }
    m = re.exec(input);
  }

  if (codes.length > 0) {
    return [...new Set(codes)];
  }

  const normalized = normalizeZip(input);
  if (normalized.length === 7) {
    return [normalized];
  }
  return [];
}

export function getAreaId(props) {
  for (const key of AREA_ID_KEYS) {
    if (props[key] === null || props[key] === undefined) {
      continue;
    }
    const value = normalizeAreaIdValue(key, props[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeAreaIdValue(key, value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (ZIP_KEYS.includes(key)) {
    return normalizeZip(raw);
  }
  return raw;
}

export function getAreaName(props) {
  const n03Name = composeN03Name(props);
  if (n03Name) {
    return n03Name;
  }
  for (const key of AREA_NAME_KEYS) {
    if (props[key]) {
      return String(props[key]).trim();
    }
  }
  return "";
}

export function getMunicipality(props, fallbackName = "") {
  const n03Name = composeN03Name(props);
  if (n03Name) {
    return canonicalMunicipality(n03Name);
  }
  for (const key of MUNICIPALITY_KEYS) {
    if (props[key]) {
      return canonicalMunicipality(String(props[key]));
    }
  }
  return canonicalMunicipality(fallbackName);
}

export function getMunicipalityFromProps(props) {
  return canonicalMunicipality(
    String(props?.municipality || props?.area_name || props?.市区 || props?.N03_004 || composeN03Name(props) || "")
  );
}

export function composeN03Name(props) {
  const city = String(props.N03_004 || "").trim();
  const ward = String(props.N03_005 || "").trim();
  if (city && ward) {
    return `${city}${ward}`;
  }
  return city || "";
}

export function extractTownName(props, areaName, municipality) {
  const direct = String(props.town_name || props.S_NAME || props.町 || "").trim();
  if (direct) {
    return direct;
  }

  const name = String(areaName || "").trim();
  const muni = String(municipality || "").trim();
  if (name && muni && name.startsWith(muni) && name.length > muni.length) {
    return name.slice(muni.length).trim();
  }
  return "";
}

export function canonicalMunicipality(value) {
  return canonicalAreaName(value);
}

export function canonicalTownName(value) {
  let out = String(value || "").trim();
  if (!out || out === "以下に掲載がない場合") {
    return "";
  }
  out = out.replace(/[\s　]/g, "");
  out = out.replace(/ヶ/g, "ケ").replace(/ヵ/g, "ケ").replace(/ｹ/g, "ケ");
  out = out.replace(/之/g, "の");
  out = out.replace(/[0-9０-９]+丁目$/g, "");
  out = out.replace(/[一二三四五六七八九十]+丁目$/g, "");
  return out;
}

export function normalizeZip(value) {
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.length >= 7) {
    return digits.slice(0, 7);
  }
  return digits;
}

export function formatPostalCode(zip) {
  const digits = normalizeZip(zip);
  if (digits.length !== 7) {
    return "";
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
}

export function formatPostalCodes(codes) {
  const values = Array.isArray(codes) ? codes : [];
  const formatted = values.map((value) => formatPostalCode(value)).filter(Boolean);
  if (formatted.length === 0) {
    return "-";
  }
  return [...new Set(formatted)].join(" / ");
}

export function extractDepot(props) {
  const values = [
    props.depot,
    props.depot_code,
    props.depot_name,
    props.担当デポ,
    props.管轄デポ,
    props.管轄,
  ];
  for (const value of values) {
    const code = normalizeDepotCode(value);
    if (code) {
      return code;
    }
  }
  return "";
}

export function normalizeDepotCode(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const upper = raw.toUpperCase();
  if (DEPOTS[upper]) {
    return upper;
  }
  if (upper.includes("SGM")) {
    return "SGM";
  }
  if (upper.includes("FUJ")) {
    return "FUJ";
  }
  if (upper.includes("YOK")) {
    return "YOK";
  }
  if (raw.includes("相模原")) {
    return "SGM";
  }
  if (raw.includes("藤沢")) {
    return "FUJ";
  }
  if (raw.includes("横浜港北")) {
    return "YOK";
  }
  return "";
}

export function formatAreaIdForDisplay(areaId) {
  const raw = String(areaId || "");
  if (!raw) {
    return "";
  }
  if (raw.startsWith("name:") || raw.startsWith("feature:")) {
    return raw;
  }
  return raw.replace(/^(KA\d+|TK\d+|SA\d+|CB\d+|N03|KA|TK|SA|CB)-/i, "");
}

export function normalizeMatchKey(value) {
  return String(value || "")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

export function canonicalAreaName(value) {
  let out = String(value || "").trim();
  out = out.replace(/[\s　]/g, "");
  out = out.replace(/\(.*?\)/g, "");
  out = out.replace(/（.*?）/g, "");
  out = out.replace(/^東京都/, "");
  out = out.replace(/^神奈川県/, "");

  if (out === "町田") {
    out = "町田市";
  }
  if (out === "藤沢") {
    out = "藤沢市";
  }
  if (/^横浜.+区$/.test(out) && !out.startsWith("横浜市")) {
    out = out.replace(/^横浜/, "横浜市");
  }
  if (/^川崎.+区$/.test(out) && !out.startsWith("川崎市")) {
    out = out.replace(/^川崎/, "川崎市");
  }
  if (/^相模原.+区$/.test(out) && !out.startsWith("相模原市")) {
    out = out.replace(/^相模原/, "相模原市");
  }

  return out;
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
