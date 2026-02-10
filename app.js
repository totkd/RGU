const DEPOTS = {
  SGM: { name: "相模原デポ SGM", color: "#2e7d32" },
  FUJ: { name: "藤沢デポ FUJ", color: "#1e4f8a" },
  YOK: { name: "横浜港北デポ YOK", color: "#b71c1c" },
};

const ZIP_KEYS = ["zip_code", "zipcode", "zip", "postal_code", "郵便番号"];
const AREA_ID_KEYS = ["area_id", "area_code", "code", "id", "N03_007", ...ZIP_KEYS];
const AREA_NAME_KEYS = [
  "area_name",
  "name",
  "名称",
  "municipality",
  "市区町村",
  "市区",
  "対応エリア",
  "N03_004",
  "N03_003",
];
const MUNICIPALITY_KEYS = ["municipality", "city", "ward", "自治体", "市区町村", "市区", "対応エリア", "N03_004"];
const AREA_HEADER_KEYS = ["area_id", "area_code", "id", "code", "N03_007", ...ZIP_KEYS];
const AREA_NAME_HEADER_KEYS = ["area_name", "name", "名称", "municipality", "市区町村", "市区", "対応エリア"];
const DEPOT_HEADER_KEYS = ["depot_code", "depot", "担当デポ", "管轄デポ"];

const state = {
  map: null,
  geoLayer: null,
  areaToLayers: new Map(),
  areaMeta: new Map(),
  nameIndex: new Map(),
  assignments: new Map(),
  selected: new Set(),
  currentFilterMunicipality: "",
};

const el = {
  geoInput: document.getElementById("geojson-input"),
  csvInput: document.getElementById("csv-input"),
  loadSample: document.getElementById("load-sample"),
  municipalityFilter: document.getElementById("municipality-filter"),
  areaSearch: document.getElementById("zip-search"),
  jumpArea: document.getElementById("jump-zip"),
  clearSelection: document.getElementById("clear-selection"),
  clearAssignment: document.getElementById("clear-assignment"),
  exportCsv: document.getElementById("export-csv"),
  selectedCount: document.getElementById("selected-count"),
  selectedAreas: document.getElementById("selected-zips"),
  stats: document.getElementById("stats"),
};

init();

function init() {
  state.map = L.map("map", { zoomControl: true }).setView([35.45, 139.55], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(state.map);

  el.geoInput.addEventListener("change", handleGeoJsonFile);
  el.csvInput.addEventListener("change", handleCsvFile);
  el.loadSample.addEventListener("click", loadSampleGeoJson);
  el.municipalityFilter.addEventListener("change", () => {
    state.currentFilterMunicipality = el.municipalityFilter.value;
    refreshAllStyles();
  });
  el.jumpArea.addEventListener("click", handleAreaJump);
  el.areaSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAreaJump();
    }
  });
  el.clearSelection.addEventListener("click", clearSelection);
  el.clearAssignment.addEventListener("click", clearAssignmentForSelected);
  el.exportCsv.addEventListener("click", exportAssignmentsCsv);

  document.querySelectorAll(".depot-btn").forEach((btn) => {
    btn.addEventListener("click", () => assignSelected(btn.dataset.depot));
  });

  renderSelected();
  renderStats();
}

async function loadSampleGeoJson() {
  const candidates = ["./data/sample-admin-areas.geojson", "./data/sample-postal-areas.geojson"];
  let lastError = "";
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        lastError = `${path}: ${res.status}`;
        continue;
      }
      const data = await res.json();
      loadGeoJson(data);
      return;
    } catch (err) {
      lastError = err.message;
    }
  }
  alert(`サンプル読込に失敗しました。${lastError}`);
}

function handleGeoJsonFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      loadGeoJson(data);
    } catch (_err) {
      alert("GeoJSONの読み込みに失敗しました。JSON形式を確認してください。");
    }
  };
  reader.readAsText(file, "utf-8");
}

function handleCsvFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    applyAssignmentsCsv(String(reader.result));
  };
  reader.readAsText(file, "utf-8");
}

function loadGeoJson(data) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    alert("FeatureCollection形式のGeoJSONを指定してください。");
    return;
  }

  if (state.geoLayer) {
    state.map.removeLayer(state.geoLayer);
  }

  state.geoLayer = null;
  state.areaToLayers.clear();
  state.areaMeta.clear();
  state.nameIndex.clear();
  state.assignments.clear();
  state.selected.clear();
  state.currentFilterMunicipality = "";

  let fallbackCounter = 0;

  state.geoLayer = L.geoJSON(data, {
    style: (feature) => {
      const areaId = getAreaId(feature?.properties || {});
      return styleForArea(areaId);
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      let areaId = getAreaId(props);
      const areaName = getAreaName(props);
      const municipality = getMunicipality(props, areaName);
      if (!areaId) {
        fallbackCounter += 1;
        areaId = areaName ? `name:${areaName}` : `feature:${String(fallbackCounter).padStart(5, "0")}`;
      }

      if (!state.areaToLayers.has(areaId)) {
        state.areaToLayers.set(areaId, []);
      }
      state.areaToLayers.get(areaId).push(layer);

      if (!state.areaMeta.has(areaId)) {
        state.areaMeta.set(areaId, { name: areaName || areaId, municipality, raw: props });
      }

      const currentDepot = state.assignments.get(areaId) || "";
      const initialDepot = extractDepot(props);
      state.assignments.set(areaId, initialDepot || currentDepot);

      layer.on("click", () => toggleAreaSelection(areaId));
      layer.bindTooltip(tooltipText(areaId), { sticky: true });
    },
  }).addTo(state.map);

  rebuildNameIndex();

  const bounds = state.geoLayer.getBounds();
  if (bounds.isValid()) {
    state.map.fitBounds(bounds.pad(0.15));
  }

  populateMunicipalityFilter();
  refreshAllStyles();
  renderSelected();
  renderStats();
}

function getAreaId(props) {
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

function getAreaName(props) {
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

function getMunicipality(props, fallbackName = "") {
  const n03Name = composeN03Name(props);
  if (n03Name) {
    return n03Name;
  }
  for (const key of MUNICIPALITY_KEYS) {
    if (props[key]) {
      return String(props[key]).trim();
    }
  }
  return fallbackName;
}

function composeN03Name(props) {
  const city = String(props.N03_004 || "").trim();
  const ward = String(props.N03_005 || "").trim();
  if (city && ward) {
    return `${city}${ward}`;
  }
  return city || "";
}

function normalizeZip(value) {
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.length >= 7) {
    return digits.slice(0, 7);
  }
  return digits;
}

function extractDepot(props) {
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

function normalizeDepotCode(value) {
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

function tooltipText(areaId) {
  const meta = state.areaMeta.get(areaId);
  if (!meta) {
    return areaId;
  }
  const parts = [meta.name || "", areaId, meta.municipality || ""].filter(Boolean);
  return parts.join(" / ");
}

function styleForArea(areaId) {
  const selected = state.selected.has(areaId);
  const assignment = state.assignments.get(areaId);
  const depot = DEPOTS[assignment];
  const baseColor = depot ? depot.color : "#aeb8c3";
  const isFilteredOut = isFilteredOutByMunicipality(areaId);

  return {
    color: selected ? "#101114" : "#4e5967",
    weight: selected ? 3 : 1,
    dashArray: selected ? "5 4" : "",
    fillColor: baseColor,
    fillOpacity: isFilteredOut ? 0.08 : selected ? 0.78 : 0.55,
    opacity: isFilteredOut ? 0.25 : 0.9,
  };
}

function isFilteredOutByMunicipality(areaId) {
  const current = state.currentFilterMunicipality;
  if (!current) {
    return false;
  }
  const municipality = state.areaMeta.get(areaId)?.municipality || "";
  return municipality !== current;
}

function refreshAllStyles() {
  state.areaToLayers.forEach((layers, areaId) => {
    layers.forEach((layer) => layer.setStyle(styleForArea(areaId)));
  });
  renderStats();
}

function toggleAreaSelection(areaId) {
  if (!state.areaToLayers.has(areaId)) {
    return;
  }
  if (state.selected.has(areaId)) {
    state.selected.delete(areaId);
  } else {
    state.selected.add(areaId);
  }
  state.areaToLayers.get(areaId).forEach((layer) => layer.setStyle(styleForArea(areaId)));
  renderSelected();
}

function clearSelection() {
  if (state.selected.size === 0) {
    return;
  }
  const selectedNow = [...state.selected];
  state.selected.clear();
  selectedNow.forEach((areaId) => {
    state.areaToLayers.get(areaId)?.forEach((layer) => layer.setStyle(styleForArea(areaId)));
  });
  renderSelected();
}

function assignSelected(depotCode) {
  if (!DEPOTS[depotCode]) {
    return;
  }
  if (state.selected.size === 0) {
    alert("先にエリアを選択してください。");
    return;
  }
  state.selected.forEach((areaId) => {
    state.assignments.set(areaId, depotCode);
  });
  refreshAllStyles();
  renderStats();
}

function clearAssignmentForSelected() {
  if (state.selected.size === 0) {
    alert("先にエリアを選択してください。");
    return;
  }
  state.selected.forEach((areaId) => state.assignments.set(areaId, ""));
  refreshAllStyles();
  renderStats();
}

function populateMunicipalityFilter() {
  const values = [...new Set([...state.areaMeta.values()].map((v) => v.municipality).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );

  el.municipalityFilter.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "すべて";
  el.municipalityFilter.append(allOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    el.municipalityFilter.append(option);
  });
}

function handleAreaJump() {
  const query = String(el.areaSearch.value || "").trim();
  if (!query) {
    return;
  }
  const candidates = findAreaCandidates(query);
  if (candidates.length === 0) {
    alert(`"${query}" に一致するエリアが見つかりません。`);
    return;
  }

  const bounds = L.latLngBounds();
  candidates.forEach((areaId) => {
    state.selected.add(areaId);
    state.areaToLayers.get(areaId)?.forEach((layer) => {
      layer.setStyle(styleForArea(areaId));
      bounds.extend(layer.getBounds());
    });
  });

  if (bounds.isValid()) {
    state.map.fitBounds(bounds.pad(0.4), { maxZoom: 13 });
  }
  const firstLayer = state.areaToLayers.get(candidates[0])?.[0];
  firstLayer?.openTooltip();
  renderSelected();
}

function findAreaCandidates(query) {
  const direct = resolveAreaIdsByKey(query);
  if (direct.length > 0) {
    return direct;
  }

  const lowered = query.toLowerCase();
  const out = [];
  state.areaMeta.forEach((meta, areaId) => {
    const haystack = `${areaId} ${meta.name} ${meta.municipality}`.toLowerCase();
    if (haystack.includes(lowered)) {
      out.push(areaId);
    }
  });
  return out.slice(0, 40);
}

function resolveAreaIdsByKey(value) {
  const out = new Set();
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }
  if (state.areaToLayers.has(raw)) {
    out.add(raw);
  }

  const zipped = normalizeZip(raw);
  if (zipped && state.areaToLayers.has(zipped)) {
    out.add(zipped);
  }

  const key1 = normalizeMatchKey(raw);
  const key2 = normalizeMatchKey(canonicalAreaName(raw));
  [key1, key2].forEach((key) => {
    if (state.nameIndex.has(key)) {
      state.nameIndex.get(key).forEach((areaId) => out.add(areaId));
    }
  });
  return [...out];
}

function rebuildNameIndex() {
  state.nameIndex.clear();
  state.areaMeta.forEach((meta, areaId) => {
    const names = [areaId, meta.name, meta.municipality];
    names.forEach((name) => {
      if (!name) {
        return;
      }
      const raw = String(name);
      addNameIndex(normalizeMatchKey(raw), areaId);
      addNameIndex(normalizeMatchKey(canonicalAreaName(raw)), areaId);
    });
  });
}

function addNameIndex(key, areaId) {
  if (!key) {
    return;
  }
  if (!state.nameIndex.has(key)) {
    state.nameIndex.set(key, new Set());
  }
  state.nameIndex.get(key).add(areaId);
}

function normalizeMatchKey(value) {
  return String(value || "")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

function canonicalAreaName(value) {
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

function applyAssignmentsCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    alert("CSVにデータ行がありません。");
    return;
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const areaIdIndexes = headers
    .map((h, idx) => (AREA_HEADER_KEYS.some((key) => normalizeHeader(key) === h) ? idx : -1))
    .filter((idx) => idx !== -1);
  const areaNameIndexes = headers
    .map((h, idx) => (AREA_NAME_HEADER_KEYS.some((key) => normalizeHeader(key) === h) ? idx : -1))
    .filter((idx) => idx !== -1);
  const depotIndex = headers.findIndex((h) => DEPOT_HEADER_KEYS.some((key) => normalizeHeader(key) === h));

  if ((areaIdIndexes.length === 0 && areaNameIndexes.length === 0) || depotIndex === -1) {
    alert("CSVヘッダに area_id（または area_name 系）と depot_code（または同等列）が必要です。");
    return;
  }

  const csvDepotByArea = new Map();
  const conflicts = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const depot = normalizeDepotCode(cols[depotIndex] || "");
    if (!depot) {
      continue;
    }

    const candidates = new Set();
    areaIdIndexes.forEach((idx) => {
      resolveAreaIdsByKey(cols[idx] || "").forEach((areaId) => candidates.add(areaId));
    });
    areaNameIndexes.forEach((idx) => {
      resolveAreaIdsByKey(cols[idx] || "").forEach((areaId) => candidates.add(areaId));
    });

    candidates.forEach((areaId) => {
      if (!state.assignments.has(areaId)) {
        return;
      }
      if (!csvDepotByArea.has(areaId)) {
        csvDepotByArea.set(areaId, depot);
        return;
      }
      const prev = csvDepotByArea.get(areaId);
      if (prev !== depot) {
        if (!conflicts.has(areaId)) {
          conflicts.set(areaId, new Set([prev]));
        }
        conflicts.get(areaId).add(depot);
      }
    });
  }

  let applied = 0;
  const conflicted = [];
  csvDepotByArea.forEach((depot, areaId) => {
    if (conflicts.has(areaId)) {
      state.assignments.set(areaId, "");
      conflicted.push(areaId);
      return;
    }
    state.assignments.set(areaId, depot);
    applied += 1;
  });

  refreshAllStyles();
  renderStats();
  if (conflicted.length === 0) {
    alert(`${applied}件のエリア割当をCSVから反映しました。`);
    return;
  }

  const preview = conflicted
    .slice(0, 8)
    .map((areaId) => state.areaMeta.get(areaId)?.name || areaId)
    .join("、");
  alert(
    `${applied}件を反映しました。${conflicted.length}件は複数デポが混在していたため未割当にしています。` +
      `（例: ${preview}${conflicted.length > 8 ? " ほか" : ""}）`
  );
}

function splitCsvLine(line) {
  const out = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function exportAssignmentsCsv() {
  if (state.areaMeta.size === 0) {
    alert("先にGeoJSONを読み込んでください。");
    return;
  }

  const rows = [["area_id", "area_name", "municipality", "depot_code", "depot_name"]];
  const areaIds = [...state.areaMeta.keys()].sort((a, b) => {
    const am = state.areaMeta.get(a);
    const bm = state.areaMeta.get(b);
    const keyA = `${am?.municipality || ""} ${am?.name || ""} ${a}`;
    const keyB = `${bm?.municipality || ""} ${bm?.name || ""} ${b}`;
    return keyA.localeCompare(keyB, "ja");
  });

  areaIds.forEach((areaId) => {
    const meta = state.areaMeta.get(areaId);
    const depotCode = state.assignments.get(areaId) || "";
    const depotName = DEPOTS[depotCode]?.name || "";
    rows.push([areaId, meta?.name || "", meta?.municipality || "", depotCode, depotName]);
  });

  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `depot_assignments_admin_${getDateStamp()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function renderSelected() {
  const areaIds = [...state.selected].sort((a, b) => a.localeCompare(b, "ja"));
  el.selectedCount.textContent = `選択中: ${areaIds.length}件`;
  el.selectedAreas.innerHTML = "";
  if (areaIds.length === 0) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = "地図でエリアをクリック";
    el.selectedAreas.append(span);
    return;
  }
  areaIds.forEach((areaId) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = formatAreaLabel(areaId);
    chip.addEventListener("click", () => toggleAreaSelection(areaId));
    el.selectedAreas.append(chip);
  });
}

function formatAreaLabel(areaId) {
  const meta = state.areaMeta.get(areaId);
  if (!meta || !meta.name || meta.name === areaId) {
    return areaId;
  }
  return `${meta.name} [${areaId}]`;
}

function renderStats() {
  const total = state.assignments.size;
  let assigned = 0;
  const byDepot = { SGM: 0, FUJ: 0, YOK: 0 };

  state.assignments.forEach((depotCode) => {
    if (!depotCode) {
      return;
    }
    assigned += 1;
    if (byDepot[depotCode] !== undefined) {
      byDepot[depotCode] += 1;
    }
  });

  el.stats.innerHTML = "";
  appendStat(`総エリア数: ${total}`);
  appendStat(`割当済み: ${assigned}`);
  appendStat(`未割当: ${Math.max(total - assigned, 0)}`);
  appendStat(`SGM: ${byDepot.SGM}`);
  appendStat(`FUJ: ${byDepot.FUJ}`);
  appendStat(`YOK: ${byDepot.YOK}`);
}

function appendStat(text) {
  const li = document.createElement("li");
  li.textContent = text;
  el.stats.append(li);
}
