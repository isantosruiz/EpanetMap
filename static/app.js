const map = L.map("map", { zoomControl: true }).setView([20, 0], 2);

const basemapLayers = {
  satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      crossOrigin: "anonymous",
      attribution:
        "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }
  ),
  streets: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      crossOrigin: "anonymous",
      attribution:
        "Tiles &copy; Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NGA, USGS",
    }
  ),
};

let activeBasemapLayer = null;

function setBasemap(style) {
  const selectedStyle = basemapLayers[style] ? style : "satellite";
  const nextLayer = basemapLayers[selectedStyle];
  if (activeBasemapLayer === nextLayer) return;
  if (activeBasemapLayer) {
    map.removeLayer(activeBasemapLayer);
  }
  activeBasemapLayer = nextLayer;
  activeBasemapLayer.addTo(map);
}

const pipesLayer = L.layerGroup().addTo(map);
const nodesLayer = L.layerGroup().addTo(map);

const form = document.getElementById("networkForm");
const fileInput = document.getElementById("fileInput");
const fileInputName = document.getElementById("fileInputName");
const centerLatInput = document.getElementById("centerLat");
const centerLonInput = document.getElementById("centerLon");
const metersPerUnitInput = document.getElementById("metersPerUnit");
const coordinateModeInput = document.getElementById("coordinateMode");
const basemapStyleInput = document.getElementById("basemapStyle");
const localSettings = document.getElementById("localSettings");
const utmSettings = document.getElementById("utmSettings");
const utmZoneInput = document.getElementById("utmZone");
const showNodesInput = document.getElementById("showNodes");
const showStorageInput = document.getElementById("showStorage");
const pipeColorInput = document.getElementById("pipeColor");
const pipeWidthInput = document.getElementById("pipeWidth");
const nodeColorInput = document.getElementById("nodeColor");
const nodeRadiusInput = document.getElementById("nodeRadius");
const storageColorInput = document.getElementById("storageColor");
const reservoirSizeInput = document.getElementById("reservoirSize");
const locateBtn = document.getElementById("locateBtn");
const statusBox = document.getElementById("status");
const summaryContentBox = document.getElementById("summaryContent");

let latestPayload = null;
setBasemap((basemapStyleInput && basemapStyleInput.value) || "satellite");

function updateFileNameLabel() {
  const selected = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0].name : "";
  fileInputName.textContent = selected || "Sin archivo seleccionado";
  fileInputName.classList.toggle("has-file", Boolean(selected));
}

function setStatus(text, isError = false) {
  statusBox.textContent = text;
  statusBox.style.color = isError ? "#b3261e" : "#4b5f70";
}

function clearLayers() {
  pipesLayer.clearLayers();
  nodesLayer.clearLayers();
}

function isStorageNode(nodeType) {
  return nodeType === "tank" || nodeType === "reservoir";
}

function clampNumber(value, minValue, maxValue, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minValue), maxValue);
}

function buildReservoirIcon(color, size) {
  const side = Math.round(size);
  return L.divIcon({
    className: "reservoir-marker-wrapper",
    html: `<div class="reservoir-marker-square" style="width:${side}px;height:${side}px;background:${color};"></div>`,
    iconSize: [side, side],
    iconAnchor: [side / 2, side / 2],
    popupAnchor: [0, -Math.ceil(side / 2)],
  });
}

function updateModeUI() {
  const mode = coordinateModeInput.value;
  const usesLocal = mode === "local";
  const usesUtm = mode === "utm";

  localSettings.classList.toggle("hidden", !usesLocal);
  utmSettings.classList.toggle("hidden", !usesUtm);

  locateBtn.disabled = !usesLocal;
  locateBtn.style.opacity = usesLocal ? "1" : "0.55";

  utmZoneInput.required = usesUtm;
}

function drawNetwork(payload, options = {}) {
  const fitToBounds = options.fitToBounds !== false;
  const pipeColor = pipeColorInput.value;
  const pipeWidth = clampNumber(pipeWidthInput.value, 1, 20, 3);
  const nodeColor = nodeColorInput.value;
  const nodeRadius = clampNumber(nodeRadiusInput.value, 1, 20, 4);
  const nodeOutlineColor = "#202020";
  const nodeOutlineWeight = 0.3;
  const storageColor = storageColorInput.value;
  const reservoirSize = clampNumber(reservoirSizeInput.value, 4, 40, 12);

  clearLayers();

  payload.pipes.forEach((pipe) => {
    const polyline = L.polyline(pipe.coordinates, {
      color: pipeColor,
      weight: pipeWidth,
      opacity: 0.85,
    });
    const details = [
      `<strong>Tubería:</strong> ${pipe.id}`,
      `<strong>Desde:</strong> ${pipe.start_node}`,
      `<strong>Hasta:</strong> ${pipe.end_node}`,
    ];
    if (pipe.length != null) details.push(`<strong>Longitud:</strong> ${pipe.length}`);
    if (pipe.diameter != null) details.push(`<strong>Diámetro:</strong> ${pipe.diameter}`);
    if (pipe.status) details.push(`<strong>Estado:</strong> ${pipe.status}`);
    polyline.bindPopup(details.join("<br/>"));
    polyline.addTo(pipesLayer);
  });

  payload.nodes.forEach((node) => {
    const storage = isStorageNode(node.type);
    if (storage && !showStorageInput.checked) return;
    if (!storage && !showNodesInput.checked) return;

    const popupText = `<strong>Nodo:</strong> ${node.id}<br/><strong>Tipo:</strong> ${node.type}`;

    if (node.type === "reservoir") {
      const marker = L.marker([node.lat, node.lon], {
        icon: buildReservoirIcon(storageColor, reservoirSize),
      });
      marker.bindPopup(popupText);
      marker.addTo(nodesLayer);
      return;
    }

    const marker = L.circleMarker([node.lat, node.lon], {
      radius: storage ? nodeRadius + 1 : nodeRadius,
      weight: storage ? 1 : nodeOutlineWeight,
      color: storage ? storageColor : nodeOutlineColor,
      fillColor: storage ? storageColor : nodeColor,
      fillOpacity: 0.9,
    });
    marker.bindPopup(popupText);
    marker.addTo(nodesLayer);
  });

  if (fitToBounds) {
    const bounds = payload.bounds;
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [20, 20] }
    );
  }
}

function setSummary(payload) {
  let modeText = "Modo de coordenadas no reconocido.";
  if (payload.meta.projection_mode === "local") {
    modeText = "Las coordenadas se interpretaron como locales y se proyectaron usando lat/lon base.";
  } else if (payload.meta.projection_mode === "utm") {
    modeText = `Las coordenadas se interpretaron como UTM en la zona ${payload.meta.utm_zone}.`;
  }

  const nodeCount = payload.nodes.filter((node) => !isStorageNode(node.type)).length;
  const storageCount = payload.nodes.filter((node) => isStorageNode(node.type)).length;

  summaryContentBox.innerHTML = `
    <p><strong>Nodos:</strong> ${nodeCount}</p>
    <p><strong>Almacenamiento:</strong> ${storageCount}</p>
    <p><strong>Tuberías:</strong> ${payload.meta.pipe_count}</p>
    <p>${modeText}</p>
  `;
}

function rerenderFromState() {
  if (!latestPayload) return;
  drawNetwork(latestPayload, { fitToBounds: false });
}

locateBtn.addEventListener("click", () => {
  if (locateBtn.disabled) {
    return;
  }

  if (!navigator.geolocation) {
    setStatus("Tu navegador no soporta geolocalización.", true);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      centerLatInput.value = position.coords.latitude.toFixed(6);
      centerLonInput.value = position.coords.longitude.toFixed(6);
      setStatus("Ubicación detectada y aplicada como referencia.");
    },
    () => setStatus("No se pudo leer la ubicación del dispositivo.", true),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

coordinateModeInput.addEventListener("change", () => {
  updateModeUI();
});

basemapStyleInput.addEventListener("change", () => {
  setBasemap(basemapStyleInput.value);
});

utmZoneInput.addEventListener("input", () => {
  utmZoneInput.value = utmZoneInput.value.toUpperCase().replace(/\s+/g, "");
});

fileInput.addEventListener("change", () => {
  updateFileNameLabel();
});

showNodesInput.addEventListener("change", rerenderFromState);
showStorageInput.addEventListener("change", rerenderFromState);
pipeColorInput.addEventListener("input", rerenderFromState);
pipeWidthInput.addEventListener("input", rerenderFromState);
nodeColorInput.addEventListener("input", rerenderFromState);
nodeRadiusInput.addEventListener("input", rerenderFromState);
storageColorInput.addEventListener("input", rerenderFromState);
reservoirSizeInput.addEventListener("input", rerenderFromState);

updateFileNameLabel();
updateModeUI();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];
  if (!file) {
    setStatus("Selecciona un archivo .NET o .INP primero.", true);
    return;
  }

  if (coordinateModeInput.value === "utm" && !utmZoneInput.value.trim()) {
    setStatus("Debes indicar la zona UTM (por ejemplo 14Q o 30T).", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("center_lat", centerLatInput.value || "0");
  formData.append("center_lon", centerLonInput.value || "0");
  formData.append("meters_per_unit", metersPerUnitInput.value || "1");
  formData.append("coordinate_mode", coordinateModeInput.value || "utm");
  formData.append("utm_zone", utmZoneInput.value.trim());

  setStatus("Procesando archivo...");

  try {
    const response = await fetch("/api/parse-network", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Error al parsear la red EPANET.");
    }

    latestPayload = payload;
    drawNetwork(payload, { fitToBounds: true });
    setSummary(payload);
    setStatus("Red cargada correctamente.");
  } catch (error) {
    latestPayload = null;
    clearLayers();
    summaryContentBox.innerHTML = "";
    setStatus(error.message, true);
  }
});
