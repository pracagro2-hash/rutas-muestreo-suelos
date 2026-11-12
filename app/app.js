/*
 * Rutas de muestreo de suelos — aplicación de campo (Leaflet).
 * Datos: window.DATOS_RUTAS[<ingenio>] (data/<ingenio>.js, generado por PLANIFICACION_RUTAS_MUESTREO.ipynb).
 * Depende de: Leaflet, app/config.js, app/logica.js, app/almacen.js, app/sync.js.
 */
(function () {
  "use strict";
  const C = window.CONFIG_APP || {};
  const ING = window.APP_INGENIO;
  const DATOS = (window.DATOS_RUTAS || {})[ING];
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const coma = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? "—"
    : Number(v).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fechaHora = (iso) => iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";
  const ahora = () => new Date().toISOString();
  const E = Logica.ESTADOS;
  const icoEstado = (e, tam = 16) => `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true"><path fill="#fff" d="${E[e].svg}"/></svg>`;
  const circuloEstado = (e, tam = 34) => `<span class="circ-estado" style="width:${tam}px;height:${tam}px;background:${E[e].color}">${icoEstado(e, Math.round(tam * .55))}</span>`;
  const pildoraEstado = (e) => `<span class="pildora" style="background:${E[e].suave};color:${E[e].color === "#9E9E9E" ? "#4A4A4A" : E[e].color}">${E[e].etiqueta}</span>`;

  if (!DATOS) { document.body.innerHTML = "<p style='padding:20px'>No se encontraron los datos de este ingenio.</p>"; return; }

  // ---------------- Datos (GeoJSON → objetos) ----------------
  const META = DATOS.meta;
  const COLORES = DATOS.colores;
  const PUNTOS = DATOS.puntos.features.map((f) => Object.assign({}, f.properties,
    { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  const RUTAS = DATOS.rutas.features.map((f) => Object.assign({}, f.properties,
    { coords: f.geometry.coordinates.map((c) => [c[1], c[0]]) }));
  const PUNTO = Object.fromEntries(PUNTOS.map((p) => [p.id, p]));
  let REG = {};                               // punto_id → registro
  let filtroDia = "todos", filtroEstado = "todos", filtroSector = "todos", seleccionado = null, editando = false;

  const usuarioActual = () => (Sync.sesion && Sync.sesion.user && Sync.sesion.user.email) || localStorage.getItem("rutas_responsable") || "";
  const reg = (id) => REG[id] || Logica.registroInicial(PUNTO[id], ING);
  const estadoDe = (id) => reg(id).estado || "pendiente";

  // ---------------- Encabezado ----------------
  document.title = `Rutas de muestreo de suelos — Ingenio ${META.nombre}`;
  $("#tituloApp").innerHTML = `Planificador de Muestreo de Suelos<span class="oculto"> — Ingenio ${esc(META.nombre)}</span>`;
  $("#subtitulo").textContent = `Ingenio ${META.nombre}`;
  // Logo del ingenio (app/logos/<ingenio>.png, fondo transparente) sobre placa blanca; sin logo queda el símbolo de Cenicaña
  const LOGO_ING = { INCAUCA: "incauca", MANUELITA: "manuelita", CASTILLA: "castilla" }[ING];
  if (LOGO_ING) $(".cab-logo").outerHTML = `<span class="cab-logo placa"><img src="app/logos/${LOGO_ING}.png" alt="${esc(META.nombre)}"></span>`;
  // Sector = hacienda de la suerte (nombre_suerte «Hacienda – Suerte N» de la cédula catastral)
  const sectorDe = (p) => String(p.nombre_suerte || "").split(" – ")[0].trim() || "Sin sector";
  const SECTORES = Array.from(new Set(PUNTOS.map(sectorDe))).sort((a, b) => a.localeCompare(b, "es"));
  $("#selSector").innerHTML = `<option value="todos">Todos los sectores</option>` +
    SECTORES.map((s) => `<option value="${esc(s)}">${esc(s)} (${PUNTOS.filter((p) => sectorDe(p) === s).length})</option>`).join("");
  $("#selDia").innerHTML = `<option value="todos">Todos los días</option>` +
    RUTAS.map((r) => `<option value="${r.dia}">Día ${r.dia} · ${r.n_puntos} puntos</option>`).join("");
  const fijarSel = (sel, v) => { const el = $(sel); if (el) el.value = v; };
  if ($("#selEstado")) $("#selEstado").innerHTML = `<option value="todos">Todos los estados</option>` +
    Object.entries(E).map(([k, v]) => `<option value="${k}">${v.etiqueta}</option>`).join("");

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, 2600);
  }

  // ---------------- Mapa ----------------
  const mapa = L.map("mapa", { zoomControl: false, attributionControl: true, preferCanvas: false,
    rotate: true, touchRotate: true, bearing: 0, rotateControl: false });   // giro: leaflet-rotate (si no carga, el mapa funciona sin giro)
  const rumboMapa = () => (mapa.getBearing ? mapa.getBearing() : 0);
  L.control.zoom({ position: "bottomleft" }).addTo(mapa);
  const capaSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Imagen © Esri" });
  const capaCalles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  // Mapa base sin internet: mosaico Sentinel-2 (mapa_base_sentinel2.py), siempre debajo; Esri/OSM encima cuando hay señal
  const limitesBase = (() => {
    const la = [META.sede.lat], lo = [META.sede.lon];
    PUNTOS.forEach((p) => { la.push(p.lat); lo.push(p.lon); });
    RUTAS.forEach((r) => r.coords.forEach(([a, b]) => { la.push(a); lo.push(b); }));
    return L.latLngBounds([Math.min(...la) - .03, Math.min(...lo) - .03], [Math.max(...la) + .03, Math.max(...lo) + .03]);
  })();
  L.tileLayer("mapa_base/s2/{z}/{x}/{y}.jpg", { minNativeZoom: 10, maxNativeZoom: 14, maxZoom: 19, bounds: limitesBase, zIndex: 0,
    attribution: "Sentinel-2: Copernicus (sin señal)" }).addTo(mapa);
  capaSat.setZIndex(1); capaCalles.setZIndex(1);
  capaSat.addTo(mapa);
  let enSatelite = true;

  const ICONO_SEDE = "<div class='sede-ico'><svg viewBox='0 0 24 24' aria-hidden='true'><path fill='#fff' d='M2 21V11l5 3.2V11l5 3.2V11l3 1.9V4h2.2v9.3H18V6h2.2v15z'/>" +
    "<path fill='#5E2D91' d='M5 16.5h2v2H5zm4.5 0h2v2h-2zm4.5 0h2v2h-2z'/></svg></div>";
  L.marker([META.sede.lat, META.sede.lon], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: ICONO_SEDE }), zIndexOffset: 500 })
    .bindPopup(`<b>Sede — ${esc(META.sede.nombre)}</b><br>Salida ${esc(META.hora_salida)}`).addTo(mapa);

  const capaRutas = {}, marcadores = {};
  RUTAS.forEach((r) => {
    capaRutas[r.dia] = L.polyline(r.coords, { color: COLORES[r.dia], weight: 5, opacity: .85 })
      .bindPopup(`<b>Día ${r.dia}</b><br>${esc(r.ids)}<br>${coma(r.km)} km · viaje ${coma(r.horas_viaje)} h · muestreo ${coma(r.horas_muestreo)} h<br>Regreso estimado ${esc(r.regreso)}`);
  });
  // Peajes de la zona del ingenio: resaltados los que cruzan las rutas del plan (mismo criterio del costo)
  const ICONO_PEAJE = "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M15 4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zM3 12c0-2.61 1.67-4.83 4-5.65V4.26C3.55 5.15 1 8.27 1 12s2.55 6.85 6 7.74v-2.09c-2.33-.82-4-3.04-4-5.65z'/></svg>";
  const htmlPeaje = (cruza) => `<div class="peaje-ico${cruza ? " cruza" : ""}">${ICONO_PEAJE}</div>`;
  const pesos = (v) => "$" + Number(v || 0).toLocaleString("es-CO");
  const PEAJES = ((DATOS.peajes || {}).features || []).map((f) => Object.assign({}, f.properties,
    { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  const marcasPeaje = PEAJES.map((pj) => L.marker([pj.lat, pj.lon], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: htmlPeaje(pj.dias.length > 0) }),
    zIndexOffset: pj.dias.length ? 300 : 0, title: `Peaje ${pj.nombre}` })
    .bindPopup(`<b>Peaje ${esc(pj.nombre)}</b><br>Vía ${esc(pj.via || "—")} · ${esc(pj.administra || "—")}${pj.sentido ? `<br>${pj.sentido === "Ambos" ? "Cobra en ambos sentidos" : `Cobra en sentido ${esc(pj.sentido)}`}` : ""}` +
      `<br>${pj.dias.length ? `Lo cruzan las rutas de ${pj.dias.length === 1 ? "el día" : "los días"} ${pj.dias.join(", ")}` : "Ninguna ruta del plan pasa por este peaje"}` +
      `<br>Tarifa usada en el plan: ${pesos(pj.tarifa_cop)} por paso`));
  function icono(p) {
    const e = estadoDe(p.id);
    const sel = seleccionado === p.id ? " sel" : "";
    return L.divIcon({ className: "", iconSize: [0, 0],
      html: `<div class="etq${sel}" data-estado="${e}"><span class="mk-ico" style="background:${E[e].color}">${icoEstado(e, 15)}</span>` +
        `<span class="mk-id" style="border-left-color:${COLORES[p.dia]}">${esc(p.id)}</span></div>` });
  }
  PUNTOS.forEach((p) => {
    marcadores[p.id] = L.marker([p.lat, p.lon], { icon: icono(p), riseOnHover: true, keyboard: true, title: p.id })
      .on("click", () => abrirFicha(p.id));
  });
  const visible = (p) => (filtroDia === "todos" || String(p.dia) === String(filtroDia)) &&
    (filtroEstado === "todos" || estadoDe(p.id) === filtroEstado) && (filtroSector === "todos" || sectorDe(p) === filtroSector);

  // Brújula: aparece cuando el mapa está girado; al tocarla vuelve el norte arriba
  const btnNorte = document.createElement("button");
  btnNorte.className = "fab"; btnNorte.id = "btnNorte"; btnNorte.title = "Orientar el mapa al norte"; btnNorte.setAttribute("aria-label", "Orientar al norte");
  btnNorte.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2.5 16.5 12h-9z" fill="#EC3D96"/><path d="M12 21.5 7.5 12h9z" fill="#9E9E9E"/><text x="12" y="10.6" font-size="5" text-anchor="middle" fill="#fff" font-family="Tahoma">N</text></svg>`;
  $(".fabs").appendChild(btnNorte);
  btnNorte.onclick = () => { if (mapa.setBearing) mapa.setBearing(0); };
  function pintarNorte() {
    const b = rumboMapa(), girado = Math.abs(((b % 360) + 360) % 360) > 0.5 && Math.abs(((b % 360) + 360) % 360 - 360) > 0.5;
    btnNorte.style.display = girado ? "flex" : "none";
    btnNorte.firstChild.style.transform = `rotate(${b}deg)`;
  }
  mapa.on("rotate", () => { pintarNorte(); girarFlecha(); }); pintarNorte();

  function pintarMapa(encuadrar) {
    RUTAS.forEach((r) => {
      const ver = filtroDia === "todos" || String(r.dia) === String(filtroDia);
      ver ? capaRutas[r.dia].addTo(mapa) : mapa.removeLayer(capaRutas[r.dia]);
    });
    PEAJES.forEach((pj, i) => {
      const ver = filtroDia === "todos" || pj.dias.includes(Number(filtroDia));
      ver ? marcasPeaje[i].addTo(mapa) : mapa.removeLayer(marcasPeaje[i]);
    });
    PUNTOS.forEach((p) => {
      const m = marcadores[p.id];
      m.setIcon(icono(p));
      visible(p) ? m.addTo(mapa) : mapa.removeLayer(m);
    });
    if (encuadrar) encuadre();
  }
  function encuadre() {
    const pts = PUNTOS.filter(visible).map((p) => [p.lat, p.lon]);
    if (filtroDia !== "todos") RUTAS.filter((r) => String(r.dia) === String(filtroDia)).forEach((r) => pts.push(...r.coords));
    if (!pts.length) PUNTOS.forEach((p) => pts.push([p.lat, p.lon]));
    pts.push([META.sede.lat, META.sede.lon]);
    mapa.fitBounds(pts, { paddingTopLeft: [16, 70], paddingBottomRight: [70, 20] });
  }

  // ---------------- GPS en tiempo real ----------------
  // La ubicación se dibuja como un triángulo que apunta hacia donde se avanza (rumbo del GPS o, si el celular no lo
  // entrega, el rumbo entre las dos últimas posiciones separadas al menos 8 m). Mientras el GPS está activo, el
  // recorrido se guarda en el celular (IndexedDB) para comparar tiempos reales con los del plan.
  const FLECHA_GPS = "<div class='gps-flecha sin-rumbo'><svg viewBox='0 0 40 40' aria-hidden='true'><path d='M20 3 35 36 20 28 5 36z'/></svg></div>";
  const PRECISION_MAX_M = C.GPS_PRECISION_MAX_M || 50, PASO_MIN_M = 10, PASO_MAX_S = 30;
  let rumbo = null, baseRumbo = null, tramo = null, ultimoGuardado = null, bloqueoPantalla = null, lineaActual = null;
  const capaRecorrido = L.layerGroup().addTo(mapa);
  const estiloRecorrido = (l) => [L.polyline(l, { color: "#4A4A4A", weight: 7, opacity: .55, interactive: false }),
    L.polyline(l, { color: "#FFFFFF", weight: 3.5, dashArray: "7 6", opacity: 1, interactive: false })];
  function dibujarTramo(coords) {
    const [fondo, linea] = estiloRecorrido(coords);
    capaRecorrido.addLayer(fondo); capaRecorrido.addLayer(linea);
    return { agregar: (ll) => { fondo.addLatLng(ll); linea.addLatLng(ll); } };
  }
  function rumboEntre(a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function girarFlecha() {
    const el = marcaGps && marcaGps.getElement() && marcaGps.getElement().querySelector(".gps-flecha");
    if (!el || rumbo === null) return;
    el.classList.remove("sin-rumbo"); el.style.transform = `translate(-50%, -50%) rotate(${rumbo + rumboMapa()}deg)`;
  }
  async function guardarUbicacion(pos) {
    if (pos.coords.accuracy > PRECISION_MAX_M) return;
    const t = Date.now(), p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (ultimoGuardado && distanciaM(ultimoGuardado, p) < PASO_MIN_M && t - ultimoGuardado.t < PASO_MAX_S * 1000) return;
    ultimoGuardado = Object.assign({ t }, p);
    const v = pos.coords.speed;
    try {
      await Almacen.agregarUbicacion({ ingenio: ING, tramo, t: new Date(t).toISOString(), lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7),
        precision_m: Math.round(pos.coords.accuracy), velocidad_ms: typeof v === "number" && !isNaN(v) ? +v.toFixed(2) : null,
        rumbo: rumbo === null ? null : Math.round(rumbo), responsable: localStorage.getItem("rutas_responsable") || "" });
      if (!lineaActual) lineaActual = dibujarTramo([[p.lat, p.lon]]); else lineaActual.agregar([p.lat, p.lon]);
    } catch (e) { /* sin espacio o almacenamiento bloqueado: la ubicación se sigue mostrando */ }
  }
  async function mantenerPantalla() {
    try { if (gpsId !== null && "wakeLock" in navigator && document.visibilityState === "visible") bloqueoPantalla = await navigator.wakeLock.request("screen"); }
    catch (e) { bloqueoPantalla = null; }
  }
  document.addEventListener("visibilitychange", mantenerPantalla);
  async function cargarRecorridoDeHoy() {
    const hoy = new Date().toDateString();
    const tramos = {};
    (await Almacen.recorridoDe(ING)).filter((u) => new Date(u.t).toDateString() === hoy)
      .forEach((u) => { (tramos[u.tramo] = tramos[u.tramo] || []).push([u.lat, u.lon]); });
    Object.values(tramos).forEach((c) => dibujarTramo(c));
  }
  let gpsId = null, seguir = false, miPos = null, marcaGps = null, circuloGps = null;
  function pintarBotonGps() {
    const b = $("#btnGps");
    b.classList.toggle("activo", gpsId !== null && !seguir);
    b.classList.toggle("siguiendo", gpsId !== null && seguir);
    b.title = gpsId === null ? "Mostrar mi ubicación" : seguir ? "Siguiendo mi ubicación (tocar para apagar)" : "Centrar en mi ubicación";
  }
  function iniciarGps() {
    if (!("geolocation" in navigator)) { toast("Este dispositivo no permite obtener la ubicación"); return; }
    seguir = true;
    tramo = `${ING}-${new Date().toISOString()}`; ultimoGuardado = null; lineaActual = null; baseRumbo = null;
    mantenerPantalla();
    gpsId = navigator.geolocation.watchPosition((pos) => {
      miPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy };
      const ll = [miPos.lat, miPos.lon], h = pos.coords.heading, v = pos.coords.speed;
      if (typeof h === "number" && !isNaN(h) && (v === null || v > 0.5)) rumbo = h;
      else if (!baseRumbo) baseRumbo = miPos;
      else if (distanciaM(baseRumbo, miPos) >= Math.max(8, miPos.precision / 2)) { rumbo = rumboEntre(baseRumbo, miPos); baseRumbo = miPos; }
      if (!marcaGps) {
        circuloGps = L.circle(ll, { radius: miPos.precision, color: "#5E2D91", weight: 1, fillColor: "#59CBE8", fillOpacity: .18, interactive: false }).addTo(mapa);
        marcaGps = L.marker(ll, { icon: L.divIcon({ className: "", iconSize: [0, 0], html: FLECHA_GPS }), zIndexOffset: 1000 })
          .bindPopup("Mi ubicación").addTo(mapa);
      } else { marcaGps.setLatLng(ll); circuloGps.setLatLng(ll).setRadius(miPos.precision); }
      girarFlecha();
      guardarUbicacion(pos);
      if (nav) actualizarNav();
      if (seguir) mapa.setView(ll, Math.max(mapa.getZoom(), nav ? 17 : 16), { animate: true });
      if (seleccionado) pintarDistancia();
    }, (err) => {
      // Solo se apaga si se negó el permiso; una pérdida momentánea de señal no detiene la ubicación ni el recorrido
      if (err.code === 1) { toast("Permiso de ubicación denegado: actívelo en el navegador"); detenerGps(); }
      else if (!miPos) toast("Buscando señal GPS…");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    pintarBotonGps();
  }
  function detenerGps() {
    if (gpsId !== null) navigator.geolocation.clearWatch(gpsId);
    gpsId = null; seguir = false; lineaActual = null; rumbo = null;
    if (bloqueoPantalla) { bloqueoPantalla.release().catch(() => {}); bloqueoPantalla = null; }
    if (marcaGps) { mapa.removeLayer(marcaGps); mapa.removeLayer(circuloGps); marcaGps = circuloGps = null; }
    pintarBotonGps();
  }
  $("#btnGps").onclick = () => {
    if (gpsId === null) iniciarGps();
    else if (!seguir) { seguir = true; if (miPos) mapa.setView([miPos.lat, miPos.lon], Math.max(mapa.getZoom(), 16)); pintarBotonGps(); }
    else detenerGps();
  };
  mapa.on("dragstart", () => { if (seguir) { seguir = false; pintarBotonGps(); } });
  function distanciaM(a, b) {
    const R = 6371008.8, r = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function pintarDistancia() {
    const el = $("#distanciaPunto");
    if (!el || !seleccionado) return;
    if (!miPos) { el.textContent = "Active 📍 para ver la distancia"; return; }
    const d = distanciaM(miPos, PUNTO[seleccionado]);
    el.textContent = (d < 1000 ? `${Math.round(d)} m` : `${coma(d / 1000)} km`) + " en línea recta";
  }

  // ---------------- Navegación tipo Waze (ruta desde mi ubicación, calculada en el celular) ----------------
  // La red vial del plan (con callejones) se descarga una vez (data/red_<ingenio>.js) y queda disponible sin internet.
  let red = null, cargandoRed = null, nav = null, capaNav = null;
  let voz = localStorage.getItem("rutas_voz") !== "no";
  const ICONOS_MANIOBRA = {
    recto: "M11 6.83 9.41 8.41 8 7l4-4 4 4-1.41 1.41L13 6.83V21h-2z",
    derecha: "M17.17 11l-1.59 1.59L17 14l4-4-4-4-1.41 1.41L17.17 9H9c-1.1 0-2 .9-2 2v9h2v-9h8.17z",
    "leve-derecha": "M6 6v2h8.59L5 17.59 6.41 19 16 9.41V18h2V6z",
    retorno: "M18 9v12h-2V9c0-2.21-1.79-4-4-4S8 6.79 8 9v4.17l1.59-1.59L11 13l-4 4-4-4 1.41-1.41L6 13.17V9c0-3.31 2.69-6 6-6s6 2.69 6 6z",
    llegada: E.en_camino.svg,
  };
  function iconoManiobra(tipo) {
    const espejo = tipo === "izquierda" || tipo === "leve-izquierda";
    const d = ICONOS_MANIOBRA[(tipo || "recto").replace("izquierda", "derecha")] || ICONOS_MANIOBRA.recto;
    return `<svg viewBox="0 0 24 24" style="${espejo ? "transform:scaleX(-1)" : ""}"><path fill="#fff" d="${d}"/></svg>`;
  }
  const textoVoz = (t) => t.replace(/(\d+(?:,\d+)?) km/g, "$1 kilómetros").replace(/(\d+) m\b/g, "$1 metros");
  function hablar(texto) {
    if (!voz || !("speechSynthesis" in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(textoVoz(texto)); u.lang = "es-CO"; speechSynthesis.speak(u); } catch (e) { /* sin voz */ }
  }
  function cargarRedVial() {
    if (red) return Promise.resolve(red);
    if (cargandoRed) return cargandoRed;
    cargandoRed = new Promise((ok, mal) => {
      const listo = () => {
        const d = (window.RED_VIAL || {})[ING];
        if (!d) { cargandoRed = null; return mal(new Error("No se encontró la red vial de este ingenio")); }
        red = Navegacion.cargarRed(d); window.RED_VIAL[ING] = null; ok(red);
      };
      if ((window.RED_VIAL || {})[ING]) return listo();
      const s = document.createElement("script");
      s.src = `data/red_${ING.toLowerCase()}.js`; s.onload = listo;
      s.onerror = () => { cargandoRed = null; mal(new Error("No se pudo cargar la red vial: abra la aplicación una vez con internet")); };
      document.head.appendChild(s);
    });
    return cargandoRed;
  }
  const destinoCoord = (d) => d.tipo === "sede" ? [META.sede.lat, META.sede.lon] : [PUNTO[d.id].lat, PUNTO[d.id].lon];
  const nombreDestino = (d) => d.tipo === "sede" ? "la sede" : d.id;
  function siguienteDestino(dia) {
    const p = Logica.siguientePendiente(PUNTOS, REG, dia === undefined ? filtroDia : dia);
    return p ? { tipo: "punto", id: p.id } : { tipo: "sede" };
  }
  function enlaceGoogleMaps(destino) {
    // Desde la ubicación actual: destino y luego los demás pendientes del mismo día, terminando en la sede
    if (destino.tipo === "sede") return `https://www.google.com/maps/dir/?api=1&destination=${META.sede.lat},${META.sede.lon}&travelmode=driving`;
    const p = PUNTO[destino.id];
    const resto = PUNTOS.filter((q) => q.dia === p.dia && q.orden > p.orden && estadoDe(q.id) !== "realizado").sort((a, b) => a.orden - b.orden);
    const paradas = [p, ...resto].map((q) => `${q.lat},${q.lon}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${META.sede.lat},${META.sede.lon}&waypoints=${encodeURIComponent(paradas.join("|"))}&travelmode=driving`;
  }
  async function cambiarEstadoDe(id, estado) {
    try {
      const nuevo = Logica.aplicarCambios(reg(id), { estado }, usuarioActual(), ahora());
      if (nuevo === reg(id)) return;
      REG[id] = nuevo; await Almacen.guardarRegistro(nuevo); pintarTodo(false); Sync.sincronizar();
    } catch (e) { /* el estado se puede cambiar a mano */ }
  }
  async function iniciarNavegacion(destino) {
    if (typeof Navegacion === "undefined") { toast("La navegación funciona en la versión publicada de la aplicación"); return; }
    destino = destino || siguienteDestino();
    cerrarFicha(); mostrarVista("mapa");
    nav = { destino, ruta: null, s: null, avisos: new Set(), fuera: 0, ultimoCalculo: 0, llegado: false };
    document.body.classList.add("navegando");
    Object.values(capaRutas).forEach((c) => c.setStyle({ opacity: .3 }));
    hablar("Calculando la ruta");              // dentro del toque: habilita la voz en el iPhone
    pintarNav();
    if (gpsId === null) iniciarGps();
    seguir = true; pintarBotonGps();
    try { await cargarRedVial(); } catch (e) { toast(e.message); terminarNavegacion(); return; }
    if (destino.tipo === "punto" && estadoDe(destino.id) === "pendiente") cambiarEstadoDe(destino.id, "en_camino");
    if (miPos) recalcular(); else pintarNav();
  }
  function terminarNavegacion() {
    nav = null;
    if (capaNav) { mapa.removeLayer(capaNav); capaNav = null; }
    Object.values(capaRutas).forEach((c) => c.setStyle({ opacity: .85 }));
    document.body.classList.remove("navegando");
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  function recalcular(motivo) {
    if (!nav || !miPos || !red) return;
    nav.ultimoCalculo = Date.now(); nav.fuera = 0; nav.avisos = new Set(); nav.llegado = false;
    const r = Navegacion.calcularRuta(red, [miPos.lat, miPos.lon], destinoCoord(nav.destino));
    if (capaNav) { mapa.removeLayer(capaNav); capaNav = null; }
    if (!r) { nav.ruta = null; pintarNav(); toast("No se encontró una ruta por la red vial desde aquí: use Google Maps"); return; }
    nav.ruta = r; nav.s = 0;
    const pts = r.coords, fin = destinoCoord(nav.destino);
    capaNav = L.layerGroup([
      L.polyline(pts, { color: "#FFFFFF", weight: 11, opacity: .95, interactive: false }),
      L.polyline(pts, { color: "#2F80ED", weight: 7, opacity: 1, interactive: false }),
      L.polyline([r.fin, fin], { color: "#2F80ED", weight: 3, dashArray: "4 6", interactive: false }),   // tramo a pie
    ]).addTo(mapa);
    const min = Math.max(1, Math.round(r.segundos / 60));
    hablar(motivo === "desvio" ? "Recalculando la ruta" : `Ruta a ${nombreDestino(nav.destino)}: ${Navegacion.textoDistancia(r.metros)}, ${min} minutos`);
    actualizarNav();
  }
  function actualizarNav() {
    if (!nav || !miPos) return;
    if (!nav.ruta) { if (red && Date.now() - nav.ultimoCalculo > 5000) recalcular(); return; }
    const p = [miPos.lat, miPos.lon];
    const u = Navegacion.ubicarEnRuta(nav.ruta, p, nav.s);
    // Desvío: lejos de la ruta en dos lecturas seguidas (con margen según la precisión del GPS) → se recalcula desde aquí
    const umbral = Math.max(35, Math.min(miPos.precision || 0, 60) * 1.2);
    if (!nav.llegado && u.d > umbral) {
      nav.fuera++;
      if (nav.fuera >= 2 && Date.now() - nav.ultimoCalculo > 4000) { recalcular("desvio"); return; }
    } else { nav.fuera = 0; nav.s = u.s; }
    const st = Navegacion.estadoEn(nav.ruta, nav.s);
    if (!nav.llegado && (st.metrosRestantes < 30 || Navegacion.distancia(p, nav.ruta.fin) < 25)) { llegar(); return; }
    const m = st.maniobra;
    if (m && !nav.llegado) {
      const k = m.s.toFixed(0), txt = Navegacion.textoManiobra(m);
      if (st.distanciaManiobra <= 60 && !nav.avisos.has(k + "c")) { nav.avisos.add(k + "c"); nav.avisos.add(k + "l"); hablar(txt); }
      else if (st.distanciaManiobra <= 400 && st.distanciaManiobra > 120 && !nav.avisos.has(k + "l")) {
        nav.avisos.add(k + "l"); hablar(`En ${Navegacion.textoDistancia(st.distanciaManiobra)}, ${txt.charAt(0).toLowerCase() + txt.slice(1)}`);
      }
    }
    pintarNav(st);
  }
  function llegar() {
    nav.llegado = true;
    if (nav.destino.tipo === "sede") hablar("Llegó a la sede.");
    else {
      const p = PUNTO[nav.destino.id], pie = Math.round((p.acceso_pie_m || 0) / 10) * 10;
      hablar(`Llegó cerca de ${p.id}.` + (pie >= 20 ? ` Camine unos ${pie} metros hasta el punto.` : ""));
    }
    pintarNav();
  }
  function pintarNav(st) {
    const b = $("#navBanner"), pn = $("#navPanel");
    if (!nav) return;
    const d = nav.destino, p = d.tipo === "punto" ? PUNTO[d.id] : null;
    const titulo = d.tipo === "sede" ? "Regreso a la sede" : `Hacia ${p.id} · día ${p.dia}, parada ${p.orden}`;
    let ico = "recto", dist = "", inst = "";
    if (nav.llegado) {
      ico = "llegada";
      dist = d.tipo === "sede" ? "Llegó a la sede" : `Llegó a ${p.id}`;
      inst = d.tipo === "sede" ? "Fin del recorrido" : (p.acceso_pie_m >= 20 ? `Camine ≈ ${Math.round(p.acceso_pie_m / 10) * 10} m hasta el punto (línea punteada)` : "El punto está junto a la vía");
    } else if (!nav.ruta) {
      dist = miPos ? "Calculando la ruta…" : "Buscando señal GPS…"; inst = "La ruta se calcula desde su ubicación";
    } else if (nav.fuera > 0) {
      dist = "Fuera de la ruta"; inst = "Recalculando desde su ubicación…";
    } else if (st) {
      ico = st.maniobra ? st.maniobra.tipo : "llegada";
      dist = Navegacion.textoDistancia(st.distanciaManiobra);
      inst = st.maniobra ? Navegacion.textoManiobra(st.maniobra) : `Llegada a ${nombreDestino(d)}`;
    }
    b.innerHTML = `<div class="nb-ico">${iconoManiobra(ico)}</div><div class="nb-txt"><span class="nb-dist">${esc(dist)}</span><span class="nb-inst">${esc(inst)}</span></div>`;
    const res = st || (nav.ruta ? Navegacion.estadoEn(nav.ruta, nav.s || 0) : null);
    const llegadaHora = res ? new Date(Date.now() + res.segundosRestantes * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—";
    pn.innerHTML = `<div class="np-dest">${esc(titulo)}</div>
      ${nav.llegado && d.tipo === "punto"
        ? `<div class="np-botones"><button class="btn primario" id="npFicha">Abrir ficha de ${esc(p.id)}</button>
           <button class="btn borde" id="npSiguiente">Siguiente punto</button></div>`
        : `<div class="np-datos"><span><b>${res ? Math.max(1, Math.round(res.segundosRestantes / 60)) + " min" : "—"}</b>tiempo</span>
           <span><b>${res ? Navegacion.textoDistancia(res.metrosRestantes) : "—"}</b>distancia</span><span><b>${llegadaHora}</b>llegada</span></div>`}
      <div class="np-acciones"><button id="npVoz" aria-label="Voz">${voz ? "🔊 Voz" : "🔇 Sin voz"}</button>
        <a id="npGmaps" target="_blank" rel="noopener" href="${enlaceGoogleMaps(d)}">Google Maps</a>
        <button id="npTerminar">Terminar</button></div>`;
    $("#npVoz").onclick = () => { voz = !voz; localStorage.setItem("rutas_voz", voz ? "si" : "no"); if (!voz) speechSynthesis.cancel(); pintarNav(st); };
    $("#npTerminar").onclick = terminarNavegacion;
    if ($("#npFicha")) $("#npFicha").onclick = () => abrirFicha(p.id);
    if ($("#npSiguiente")) $("#npSiguiente").onclick = () => iniciarNavegacion(siguienteDestinoTras(p));
  }
  function siguienteDestinoTras(p) {
    const resto = PUNTOS.filter((q) => q.dia === p.dia && q.id !== p.id && estadoDe(q.id) !== "realizado").sort((a, b) => a.orden - b.orden);
    const desp = resto.find((q) => q.orden > p.orden) || resto[0];
    return desp ? { tipo: "punto", id: desp.id } : { tipo: "sede" };
  }
  $("#btnIniciar").onclick = () => iniciarNavegacion();
  window.APP_PRUEBAS = { nav: () => nav };   // solo lectura, para las pruebas automáticas

  // ---------------- Mapa base sin internet: descarga y estado ----------------
  // Las teselas Sentinel-2 del ingenio se guardan en una caché propia (no se borra al actualizar la aplicación).
  const CACHE_BASE = "mapa-base-s2-v1", claveBase = `rutas_mapa_base_${ING}`;
  let descargaBase = null;
  const estadoBase = () => { try { return JSON.parse(localStorage.getItem(claveBase)); } catch (e) { return null; } };
  function pintarEstadoBase() {
    const el = $("#estadoMapaBase"); if (!el) return;
    const est = estadoBase();
    el.textContent = !est ? "Aún no se ha descargado. Se descarga sola al abrir la aplicación con internet (o con el botón)."
      : est.version && est.listas === est.total ? `Listo: imagen de toda la zona del ingenio guardada en este celular (${est.total} mosaicos, ${coma(est.mb)} MB). Sin señal verá esta imagen; con señal, la imagen detallada.`
      : `Descargando: ${est.listas} de ${est.total} mosaicos…`;
  }
  function descargarMapaBase(forzar) {
    if (descargaBase) return descargaBase;
    if (!("caches" in window) || !location.protocol.startsWith("http")) return Promise.resolve(null);
    descargaBase = (async () => {
      const man = await (await fetch(`mapa_base/s2/${ING.toLowerCase()}.json`, { cache: "no-cache" })).json();
      const version = `${man.fechas.join("_")}_${man.escenas}`, previo = estadoBase();
      if (!forzar && previo && previo.version === version && previo.listas === man.teselas.length) return previo;
      const c = await caches.open(CACHE_BASE), renovar = !!(previo && previo.version && previo.version !== version);
      const urls = man.teselas.map(([z, x, y]) => `mapa_base/s2/${z}/${x}/${y}.jpg`);
      let i = 0, listas = 0, fallas = 0;
      const guardarEstado = (v) => { localStorage.setItem(claveBase, JSON.stringify({ version: v, listas, total: urls.length, mb: man.megabytes })); pintarEstadoBase(); };
      const trabajador = async () => {
        while (i < urls.length) {
          const u = urls[i++];
          try {
            if (!renovar && await c.match(u)) { listas++; continue; }
            const r = await fetch(u, { cache: "no-cache" });
            if (r.ok) { await c.put(u, r); listas++; } else fallas++;
          } catch (e) { fallas++; }
          if ((listas + fallas) % 25 === 0) guardarEstado(null);
        }
      };
      await Promise.all(Array.from({ length: 6 }, trabajador));
      guardarEstado(fallas ? null : version);
      return estadoBase();
    })().catch(() => null).finally(() => { descargaBase = null; });
    return descargaBase;
  }

  // ---------------- Botones flotantes ----------------
  $("#btnCapa").onclick = () => {
    if (sinSenal) { toast("Sin señal: se muestra el mapa guardado (Sentinel-2)"); return; }
    mapa.removeLayer(capaActiva()); enSatelite = !enSatelite; capaActiva().addTo(mapa);
    $("#btnCapa").title = enSatelite ? "Cambiar a mapa de calles" : "Cambiar a imagen satelital";
  };
  // Sin señal: se quita la capa en línea (si no, el mapa deja encima mosaicos viejos y borrosos) y queda el mapa
  // guardado Sentinel-2; cada 45 s se revisa si volvió la señal para mostrar otra vez la imagen detallada.
  let sinSenal = false, erroresTesela = 0;
  function capaActiva() { return enSatelite ? capaSat : capaCalles; }
  function modoSinSenal(activar) {
    if (activar === sinSenal) return;
    sinSenal = activar;
    // Sentinel-2 tiene píxeles de 10 m: sin señal se limita el acercamiento a un nivel donde la imagen se ve nítida
    if (activar) { mapa.removeLayer(capaActiva()); mapa.setMaxZoom(16); toast("Sin señal: se muestra el mapa guardado (Sentinel-2)"); }
    else { erroresTesela = 0; mapa.setMaxZoom(19); capaActiva().addTo(mapa); }
  }
  async function probarSenal() {
    try {
      await fetch("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json", { mode: "no-cors", cache: "no-store" });
      modoSinSenal(false);
    } catch (e) { /* sigue sin señal */ }
  }
  [capaSat, capaCalles].forEach((c) => {
    c.on("tileerror", () => { if (++erroresTesela >= 3) modoSinSenal(true); });
    c.on("tileload", () => { erroresTesela = 0; });
  });
  window.addEventListener("offline", () => modoSinSenal(true));
  window.addEventListener("online", probarSenal);
  setInterval(() => { if (sinSenal) probarSenal(); }, 45000);
  if (navigator.onLine === false) modoSinSenal(true);
  $("#btnTodo").onclick = () => { filtroDia = "todos"; filtroEstado = "todos"; filtroSector = "todos"; $("#selDia").value = "todos"; fijarSel("#selEstado", "todos"); $("#selSector").value = "todos"; seguir = false; pintarBotonGps(); pintarTodo(true); };
  $("#btnSiguiente").onclick = () => {
    const p = Logica.siguientePendiente(PUNTOS, REG, filtroDia);
    if (!p) { toast(filtroDia === "todos" ? "¡Todos los puntos están realizados!" : `El día ${filtroDia} está completo`); return; }
    mostrarVista("mapa"); mapa.setView([p.lat, p.lon], 16); abrirFicha(p.id);
  };
  $("#selDia").onchange = (e) => { filtroDia = e.target.value; pintarTodo(true); };
  if ($("#selEstado")) $("#selEstado").onchange = (e) => { filtroEstado = e.target.value; pintarTodo(false); };
  $("#selSector").onchange = (e) => { filtroSector = e.target.value; pintarTodo(true); };

  // ---------------- Avance general ----------------
  function pintarAvance() {
    const st = Logica.estadisticas(PUNTOS, REG, RUTAS);
    const dia = filtroDia === "todos" ? null : st.dias.find((d) => String(d.dia) === String(filtroDia));
    const base = dia || { total: st.total, realizado: st.porEstado.realizado, avance: st.avance };
    $("#barraAvance").innerHTML = `${dia ? `Día ${dia.dia}` : "Avance general"}: <b>${base.realizado}/${base.total}</b> realizados (${Math.round(base.avance * 100)} %)` +
      `<div class="barra"><i style="width:${base.avance * 100}%"></i></div>`;
  }

  // ---------------- Ficha del punto ----------------
  async function abrirFicha(id) {
    const anterior = seleccionado;
    seleccionado = id; editando = false;
    if (anterior && marcadores[anterior]) marcadores[anterior].setIcon(icono(PUNTO[anterior]));
    marcadores[id].setIcon(icono(PUNTO[id]));
    pintarFicha();
    $("#ficha").classList.add("visible"); $("#velo").classList.add("visible");
    $("#ficha").scrollTop = 0;
  }
  function cerrarFicha() {
    const id = seleccionado; seleccionado = null; editando = false;
    if (id) marcadores[id].setIcon(icono(PUNTO[id]));
    $("#ficha").classList.remove("visible"); $("#velo").classList.remove("visible");
  }
  $("#velo").onclick = cerrarFicha;

  function pintarFicha() {
    const p = PUNTO[seleccionado], r = reg(seleccionado), e = r.estado;
    // Horario en orden cronológico: de dónde sale el vehículo, a qué hora llega y a qué hora termina en el punto
    const previo = PUNTOS.find((q) => q.dia === p.dia && q.orden === p.orden - 1);
    const origen = previo ? { lugar: previo.id, hora: previo.hora_salida } : { lugar: "la sede", hora: META.hora_salida };
    const rutaDia = RUTAS.find((q) => q.dia === p.dia) || {};
    const [hh, mm] = String(META.hora_salida).split(":").map(Number);
    const minFin = hh * 60 + mm + Math.round(META.jornada_h * 60);
    const finJornada = `${String(Math.floor(minFin / 60) % 24).padStart(2, "0")}:${String(minFin % 60).padStart(2, "0")}`;
    const bloqueado = e === "realizado" && !editando;
    const responsables = Array.from(new Set((C.RESPONSABLES || []).concat(localStorage.getItem("rutas_responsable") || []).filter(Boolean)));
    const fechaLocal = r.fecha_hora_muestreo ? new Date(new Date(r.fecha_hora_muestreo).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    const conflicto = r.conflicto ? `<div class="aviso conflicto"><b>Otro usuario modificó este punto</b> (${esc(r.conflicto.actualizado_por || "")}, ${fechaHora(r.conflicto.actualizado_en)}):
        estado <b>${esc((E[r.conflicto.estado] || {}).etiqueta || r.conflicto.estado)}</b>${r.conflicto.observaciones ? `, «${esc(r.conflicto.observaciones)}»` : ""}.
        Sus cambios en este celular se conservan hasta que decida:
        <div class="botones-dobles" style="margin-top:8px"><button class="btn morado" id="usarMios">Usar mis datos</button>
        <button class="btn borde" id="usarServidor">Usar los del servidor</button></div></div>` : "";
    $("#ficha").innerHTML = `
      <div class="ficha-cab"><h2>${esc(p.id)}</h2><span class="chip-estado" style="background:${E[e].suave};color:${e === "pendiente" ? "#4A4A4A" : E[e].color}">${E[e].etiqueta}${r.borrador ? " · borrador" : ""}</span>
        <button class="cerrar" id="cerrarFicha" aria-label="Cerrar">×</button></div>
      ${conflicto}
      <div class="datos">
        <div><span>Día · parada</span>${p.dia} · ${p.orden}</div>
        <div style="grid-column:1/-1"><span>Horario estimado</span>Sale de ${esc(origen.lugar)} ${esc(origen.hora)} → llega al punto ${esc(p.hora_llegada)} → termina el muestreo ${esc(p.hora_salida)}</div>
        <div style="grid-column:1/-1"><span>Jornada del día ${p.dia}</span>Salida de la sede ${esc(META.hora_salida)} · regreso estimado ${esc(rutaDia.regreso || "—")} (máximo ${esc(finJornada)}, ${coma(META.jornada_h, 0)} h)</div>
        <div style="grid-column:1/-1"><span>Suerte</span>${esc(p.nombre_suerte || p.suerte)}${p.nombre_suerte ? ` <small style="color:#6B6B6B">(${esc(p.suerte)})</small>` : ""}</div>
        <div><span>Orden de suelo</span>${esc(p.orden_suelo || "—")}</div>
        <div><span>Edad del cultivo</span>${coma(p.edad_meses)} meses</div>
        <div><span>Acceso a pie desde la vía</span>≈ ${coma(p.acceso_pie_m, 0)} m</div>
        <div><span>Distancia desde mi ubicación</span><span id="distanciaPunto" style="color:#4A4A4A;font-size:inherit"></span></div>
        <div style="grid-column:1/-1"><span>Coordenadas (WGS84)</span>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
      </div>
      <div class="estados" role="group" aria-label="Estado">
        ${Object.entries(E).map(([k, v]) => `<button data-estado="${k}" class="${e === k ? "on" : ""}" style="background:${v.suave};border-color:${e === k ? v.color : "transparent"};color:${k === "pendiente" ? "#4A4A4A" : v.color}" title="${bloqueado && k !== e ? "Cambiar el estado (se pedirá confirmación)" : v.etiqueta}">${circuloEstado(k, 28)}<span>${v.etiqueta}</span></button>`).join("")}
      </div>
      <fieldset id="formPunto" ${bloqueado ? "disabled" : ""}>
        <div class="campo"><label for="fFecha">Fecha y hora del muestreo</label><input id="fFecha" type="datetime-local" value="${fechaLocal}"></div>
        <div class="campo"><label for="fResp">Responsable</label><input id="fResp" list="listaResp" value="${esc(r.responsable || usuarioActual())}" placeholder="Nombre de quien muestrea">
          <datalist id="listaResp">${responsables.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
        <div class="botones-dobles">
          <div class="campo"><label for="fProf">Profundidad</label><select id="fProf"><option value="">—</option>
            ${(C.PROFUNDIDADES || []).map((x) => `<option ${r.profundidad === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
          <div class="campo"><label for="fHum">Humedad del suelo (%)</label><input id="fHum" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${r.humedad_suelo ?? ""}"></div>
        </div>
        <div class="campo"><label for="fObs">Observaciones</label><textarea id="fObs" placeholder="Condiciones del sitio, novedades…">${esc(r.observaciones)}</textarea></div>
        <div class="campo"><label for="fFotos">Fotografías (${(r.fotos || []).length}/${C.FOTOS_MAX_POR_PUNTO || 6})</label>
          <input id="fFotos" type="file" accept="image/*" capture="environment" multiple>
          <div class="fotos" id="fotosPunto"></div></div>
      </fieldset>
      ${bloqueado
        ? `<button class="btn borde" id="bEditar">✎ Editar información</button>`
        : `<button class="btn primario" id="bRealizado">✓ Marcar como realizado</button>
           <div class="botones-dobles"><button class="btn borde" id="bBorrador">Guardar borrador</button>
           <button class="btn alerta" id="bInconv">! Reportar inconveniente</button></div>`}
      <button class="btn morado" id="bNavegar">${iconoManiobra("leve-derecha")} Navegar a este punto desde mi ubicación</button>
      <div class="botones-dobles">
        <a class="btn borde" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving">Google Maps</a>
        <a class="btn borde" target="_blank" rel="noopener" href="https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes">Waze</a></div>
      <button class="btn borde" id="bCentrar">◎ Centrar en el mapa</button>
      <h3 style="font-size:14px;margin:14px 0 6px">Historial de cambios</h3>
      <div class="historial" id="historial">${historialHtml(r.historial)}</div>
      <p class="nota">${r.pendiente_sync && Sync.configurado ? "⏳ Cambios pendientes de sincronizar." : ""}
        ${r.actualizado_en ? `Última modificación: ${fechaHora(r.actualizado_en)}${r.actualizado_por ? " por " + esc(r.actualizado_por) : ""}.` : ""}</p>`;
    $("#cerrarFicha").onclick = cerrarFicha;
    $("#bNavegar").onclick = () => iniciarNavegacion({ tipo: "punto", id: p.id });
    $("#bCentrar").onclick =() => { cerrarFicha(); mostrarVista("mapa"); seguir = false; pintarBotonGps(); mapa.setView([p.lat, p.lon], 17); };
    $("#ficha").querySelectorAll(".estados button").forEach((b) => { b.onclick = () => cambiarEstado(b.dataset.estado); });
    if ($("#bEditar")) $("#bEditar").onclick = () => { editando = true; pintarFicha(); };
    if ($("#bRealizado")) $("#bRealizado").onclick = marcarRealizado;
    if ($("#bBorrador")) $("#bBorrador").onclick = () => guardar(Object.assign(leerFormulario(), { borrador: true }), "Borrador guardado");
    if ($("#bInconv")) $("#bInconv").onclick = () => {
      const datos = leerFormulario();
      if (!datos.observaciones) { toast("Describa el inconveniente en Observaciones"); $("#fObs").focus(); return; }
      guardar(Object.assign(datos, { estado: "inconveniente", borrador: false }), "Inconveniente registrado");
    };
    $("#fFotos").onchange = (ev) => agregarFotos(ev.target.files);
    if ($("#usarMios")) $("#usarMios").onclick = () => resolverConflicto("mios");
    if ($("#usarServidor")) $("#usarServidor").onclick = () => resolverConflicto("servidor");
    pintarFotos(r); pintarDistancia(); cargarHistorialRemoto(seleccionado);
  }
  function historialHtml(hist) {
    if (!hist || !hist.length) return "<p class='nota'>Sin cambios registrados.</p>";
    return hist.slice().reverse().map((h) => `<p><b>${fechaHora(h.fecha)}</b> ${esc(h.usuario || "")}<br>` +
      Object.entries(h.cambios || {}).map(([c, [a, b]]) => `${esc(c.replace(/_/g, " "))}: ${esc(textoValor(c, a))} → ${esc(textoValor(c, b))}`).join("<br>") + "</p>").join("");
  }
  function textoValor(campo, v) {
    if (v === null || v === undefined || v === "") return "—";
    if (campo === "estado") return (E[v] || {}).etiqueta || v;
    if (campo === "fotos") return `${v.length} foto(s)`;
    if (campo === "fecha_hora_muestreo") return fechaHora(v);
    if (campo === "borrador") return v ? "sí" : "no";
    return String(v);
  }
  async function cargarHistorialRemoto(id) {
    const remoto = await Sync.historialRemoto(id);
    if (!remoto || seleccionado !== id) return;
    const html = remoto.map((h) => `<p><b>${fechaHora(h.fecha)}</b> ${esc(h.usuario_email || "")} · versión ${h.version} (base de datos)</p>`).join("");
    $("#historial").insertAdjacentHTML("beforeend", html);
  }
  function leerFormulario() {
    const f = $("#fFecha").value;
    const resp = $("#fResp").value.trim();
    if (resp) localStorage.setItem("rutas_responsable", resp);
    return {
      fecha_hora_muestreo: f ? new Date(f).toISOString() : null, responsable: resp,
      profundidad: $("#fProf").value, humedad_suelo: $("#fHum").value === "" ? "" : $("#fHum").value,
      observaciones: $("#fObs").value.trim(),
    };
  }
  async function guardar(cambios, mensaje) {
    const id = seleccionado;
    try {
      const nuevo = Logica.aplicarCambios(reg(id), cambios, usuarioActual(), ahora());
      if (nuevo === reg(id) && REG[id]) { toast("Sin cambios"); return; }
      REG[id] = nuevo;
      await Almacen.guardarRegistro(nuevo);
      editando = false;
      toast(mensaje);
      pintarTodo(false); pintarFicha();
      Sync.sincronizar();
    } catch (err) { toast(err.message || "No se pudo guardar"); }
  }
  // Marcar como realizado y deshacer un "Realizado" siempre piden confirmación; el cambio queda en el historial.
  function marcarRealizado() {
    if (!confirm(`¿Está seguro de que ya tomó la muestra en ${seleccionado}?\n\nEl punto quedará como Realizado.`)) return;
    return guardar(Object.assign(leerFormulario(), { estado: "realizado", borrador: false }), "Punto marcado como realizado");
  }
  function cambiarEstado(estado) {
    const actual = estadoDe(seleccionado);
    if (estado === actual) return;
    if (actual === "realizado") {
      if (!confirm(`¿Está seguro de cambiar ${seleccionado} de "Realizado" a "${E[estado].etiqueta}"?\n\nLos datos registrados se conservan y el cambio queda en el historial.`)) return;
      if (estado === "inconveniente") { editando = true; pintarFicha(); return $("#bInconv").click(); }
      return guardar(Object.assign(leerFormulario(), { estado }), `${seleccionado} ahora está ${E[estado].etiqueta.toLowerCase()}`);
    }
    if (estado === "realizado") return marcarRealizado();
    if (estado === "inconveniente") return $("#bInconv") ? $("#bInconv").click() : null;
    return guardar(Object.assign(leerFormulario(), { estado }), `Estado: ${E[estado].etiqueta}`);
  }
  async function resolverConflicto(opcion) {
    const id = seleccionado, r = reg(id), remoto = r.conflicto;
    let nuevo;
    if (opcion === "servidor") {
      nuevo = Object.assign({}, r, remoto, { version_remota: remoto.version, pendiente_sync: false, conflicto: null, historial: (r.historial || []).concat([
        { fecha: ahora(), usuario: usuarioActual(), cambios: { conflicto: ["datos locales", "se adoptaron los datos del servidor"] } }]) });
      await Almacen.guardarSinCola(nuevo);
    } else {
      nuevo = Object.assign({}, r, { version_remota: remoto.version, conflicto: null, pendiente_sync: true, historial: (r.historial || []).concat([
        { fecha: ahora(), usuario: usuarioActual(), cambios: { conflicto: ["datos del servidor", "se conservaron los datos de este celular"] } }]) });
      await Almacen.guardarRegistro(nuevo);
    }
    REG[id] = nuevo; toast("Conflicto resuelto"); pintarTodo(false); pintarFicha(); Sync.sincronizar();
  }

  // ---------------- Fotografías ----------------
  function reducirImagen(archivo) {
    return new Promise((ok, mal) => {
      const img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = () => {
        const max = C.FOTO_MAX_PX || 1280, k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo procesar la foto"))), "image/jpeg", C.FOTO_CALIDAD_JPEG || .7);
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("Archivo de imagen no válido")); };
      img.src = url;
    });
  }
  async function agregarFotos(archivos) {
    const id = seleccionado, r = reg(id), max = C.FOTOS_MAX_POR_PUNTO || 6;
    const lista = Array.from(archivos || []).slice(0, Math.max(0, max - (r.fotos || []).length));
    if (!lista.length) { toast(`Máximo ${max} fotos por punto`); return; }
    const nuevas = [];
    for (const a of lista) {
      try {
        const blob = await reducirImagen(a);
        const foto = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-z0-9-]/gi, ""),
          punto_id: id, ingenio: ING, blob, nombre: a.name, creado: ahora(), ruta_remota: null };
        await Almacen.guardarFoto(foto);
        if (Sync.configurado) await Almacen.encolar({ tipo: "foto", foto_id: foto.id, punto_id: id, ingenio: ING });
        nuevas.push({ id: foto.id, nombre: foto.nombre, creado: foto.creado, ruta_remota: null });
      } catch (err) { toast(err.message); }
    }
    if (nuevas.length) await guardar(Object.assign(leerFormulario(), { fotos: (r.fotos || []).concat(nuevas) }), `${nuevas.length} foto(s) guardada(s)`);
  }
  async function pintarFotos(r) {
    const cont = $("#fotosPunto");
    if (!cont) return;
    cont.innerHTML = "";
    for (const f of r.fotos || []) {
      const fig = document.createElement("figure");
      let src = null;
      const local = await Almacen.obtenerFoto(f.id);
      if (local && local.blob) src = URL.createObjectURL(local.blob);
      else if (f.ruta_remota) src = await Sync.urlFoto(f.ruta_remota);
      fig.innerHTML = src ? `<img src="${src}" alt="Foto ${esc(f.nombre)}">` : "";
      fig.insertAdjacentHTML("beforeend", `<small>${f.ruta_remota ? "en la nube" : Sync.configurado ? "por subir" : "en el celular"}</small>`);
      if (src) fig.onclick = () => window.open(src, "_blank");
      cont.appendChild(fig);
    }
  }

  // ---------------- Lista ----------------
  function pintarLista() {
    if (!$("#listaPuntos")) return;
    const q = ($("#buscar") && $("#buscar").value.trim().toLowerCase()) || "";
    const html = RUTAS.filter((r) => filtroDia === "todos" || String(r.dia) === String(filtroDia)).map((r) => {
      const pts = PUNTOS.filter((p) => p.dia === r.dia && visible(p) && (!q || p.id.toLowerCase().includes(q) || String(p.suerte).toLowerCase().includes(q) || String(p.nombre_suerte || "").toLowerCase().includes(q)))
        .sort((a, b) => a.orden - b.orden);
      if (!pts.length) return "";
      const hechos = PUNTOS.filter((p) => p.dia === r.dia && estadoDe(p.id) === "realizado").length;
      const totalDia = PUNTOS.filter((p) => p.dia === r.dia).length;
      return `<section class="grupo-dia"><header><span class="sw" style="background:${COLORES[r.dia]}"></span><b>Día ${r.dia}</b>
          <span class="det">${coma(r.km)} km · viaje ${coma(r.horas_viaje)} h · muestreo ${coma(r.horas_muestreo)} h · regreso ${esc(r.regreso)}</span>
          <span>${hechos === totalDia ? "✅" : `${hechos}/${totalDia}`}</span></header>
        ${pts.map((p) => { const e = estadoDe(p.id); return `<button class="fila-punto" data-id="${esc(p.id)}">
          ${circuloEstado(e, 36)}<span class="txt"><span class="id">${p.orden}. ${esc(p.id)}</span>
          <span class="meta">${esc(p.nombre_suerte || "Suerte " + p.suerte)}${p.orden_suelo ? " · " + esc(p.orden_suelo) : ""} · ${coma(p.edad_meses)} meses</span>
          <span class="meta">${esc(p.hora_llegada)}–${esc(p.hora_salida)} · ${coma(p.km_desde_anterior)} km desde la parada anterior</span></span>
          ${pildoraEstado(e)}<span class="flecha">›</span></button>`; }).join("")}
      </section>`;
    }).join("");
    $("#listaPuntos").innerHTML = html || "<p class='nota'>No hay puntos con los filtros seleccionados.</p>";
    $("#listaPuntos").querySelectorAll(".fila-punto").forEach((b) => {
      b.onclick = () => { const p = PUNTO[b.dataset.id]; mostrarVista("mapa"); mapa.setView([p.lat, p.lon], 16); abrirFicha(p.id); };
    });
  }

  // ---------------- Inicio: tablero de operación ----------------
  // Todo se calcula con los registros reales (este celular + base de datos sincronizada); filtros de día y sector del encabezado.
  const INK = "#1E293B", MUTED = "#7A7A7A", MORADO = "#5E2D91", LILA_PLAN = "#E4D7F2";
  const svgIco = (d, extra = "") => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICO = {
    meta: svgIco('<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="1.8"/>'),
    capas: svgIco('<path d="M12 3 2.5 8 12 13l9.5-5z M2.5 12.2 12 17.2l9.5-5M2.5 16.2 12 21.2l9.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
    cal: svgIco('<rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.6"/><path d="M7 12.5h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM7 16h2v2H7zm4 0h2v2h-2z" fill="currentColor"/>'),
    barras: svgIco('<path d="M4 20V12h3.4v8zm6.3 0V7h3.4v13zm6.3 0V3.5H20V20z" fill="currentColor"/>'),
    torta: svgIco('<path d="M11 3.1A9 9 0 1 0 20.9 13H11z" fill="currentColor"/><path d="M13 1.5V11h9.5A9.5 9.5 0 0 0 13 1.5z" fill="currentColor"/>'),
    alerta: svgIco('<path d="M12 2.5 1.5 21h21z" fill="currentColor"/><path d="M11 9h2v6h-2zm0 7.6h2v2h-2z" fill="#fff"/>'),
    plan: svgIco('<rect x="4.5" y="4" width="15" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 2.8h6v3H9z" fill="currentColor"/><path d="m8 13 2.5 2.5L16 10" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
    pin: svgIco('<path d="M12 2.5a7 7 0 0 0-7 7c0 5.2 7 12 7 12s7-6.8 7-12a7 7 0 0 0-7-7z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="9.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
    reloj: svgIco('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.4l3.6 2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
    play: svgIco('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  };
  // Causas de inconvenientes: se reconocen en el texto de Observaciones; solo se muestran las que aparecen en los registros
  const CAUSAS = [
    { k: "acceso", t: "Acceso restringido", re: /acceso|porter|permiso|no (nos )?(dejar|permit)|cerrad|candado|vigilan|restring|prohib/i,
      ico: '<path d="M4 4v16M20 4v16M4 8h16M4 16h16M8.5 8v8M12 8v8M15.5 8v8" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "inundado", t: "Lote inundado", re: /inund|anegad|agua en el lote|encharc/i,
      ico: '<path d="M2.5 15c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M2.5 19.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M12 3v8M8.5 7.5 12 11l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "humedad", t: "Exceso de humedad", re: /h[uú]med|mojad|barr(o|iz)|pantan|saturad/i,
      ico: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "clima", t: "Lluvia o clima", re: /lluvi|llov|aguacer|torment|clima|tempestad|rayo/i,
      ico: '<path d="M7 15.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.7 1.4A3.3 3.3 0 0 1 17 15.5z M8 18.5l-1 2.5M12 18.5l-1 2.5M16 18.5l-1 2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "cosecha", t: "Cosecha en ejecución", re: /cosech|corte|quema|alce|zafra/i,
      ico: '<path d="M12 21V8M12 12c-3 0-5-2-5-5 3 0 5 2 5 5zm0 4c3 0 5-2 5-5-3 0-5 2-5 5zM12 8c-1.5-1.5-1.5-3.5 0-5 1.5 1.5 1.5 3.5 0 5z" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "maquinaria", t: "Maquinaria trabajando", re: /maquin|tractor|cami[oó]n|vag[oó]n|alzadora|retro/i,
      ico: '<circle cx="7" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 14V8h7l2 5h6v5M8 8V5h3" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "labores", t: "Labores agrícolas", re: /riego|regad|regando|fertiliz|aplicaci|fumig|labor|siembra|resiembra|preparaci|herbicid|madurante|cultivo/i,
      ico: '<path d="M4 20h16M7 20v-6M12 20v-9M17 20v-4M7 14c-2 0-3-1.5-3-3 2 0 3 1.5 3 3zm5-3c0-2 1.5-3.5 3.5-3.5 0 2-1.5 3.5-3.5 3.5z" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "vias", t: "Vías en mal estado", re: /\bv[ií]as?\b|carretera|puente|trocha|callej|derrumb|hueco|pasar con el carro/i,
      ico: '<path d="M5 21 9.5 3M19 21 14.5 3M12 5v2.5M12 10.5V13M12 16v3" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
    { k: "otros", t: "Otros motivos", re: null, ico: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>' },
    { k: "sin", t: "Sin motivo descrito", re: null, ico: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.8M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
  ];
  function causaDe(texto) {
    const s = String(texto || "").trim();
    if (!s) return "sin";
    const c = CAUSAS.find((x) => x.re && x.re.test(s));
    return c ? c.k : "otros";
  }
  const pct1 = (n, d) => `${coma(d ? n / d * 100 : 0)} %`;
  const barraArriba = (x, y, w, h, r) => {   // barra con esquinas superiores redondeadas, apoyada en la base
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };

  function graficoDias(dias, W) {
    const H = 176, ml = 24, mr = 4, mt = 20, mb = 24, iw = W - ml - mr, ih = H - mt - mb;
    const max = Math.max(1, ...dias.map((d) => d.total));
    const paso = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 4);
    const tope = Math.ceil(max / paso) * paso;
    const y = (v) => mt + ih - (v / tope) * ih;
    const n = Math.max(1, dias.length), sx = iw / n, bw = Math.max(6, Math.min(30, sx * 0.66));
    const cadaEtq = Math.max(1, Math.ceil(26 / sx));
    let s = "";
    for (let v = 0; v <= tope; v += paso) {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? "#ECE8F2" : "#B9B3C4"}" stroke-width="1"/>` +
        `<text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${MUTED}">${v}</text>`;
    }
    dias.forEach((d, i) => {
      const cx = ml + sx * (i + 0.5), x = cx - bw / 2;
      const tip = `Día ${d.dia}: ${d.realizado} de ${d.total} muestras ejecutadas`;
      s += `<g class="g-barra" data-dia="${d.dia}"><title>${tip}</title>` +
        `<rect x="${cx - sx / 2}" y="${mt}" width="${sx}" height="${ih}" fill="transparent"/>` +
        `<path d="${barraArriba(x, y(d.total), bw, mt + ih - y(d.total), 4)}" fill="${LILA_PLAN}"/>` +
        `<path d="${barraArriba(x, y(d.realizado), bw, mt + ih - y(d.realizado), 4)}" fill="${MORADO}"/>` +
        `<text x="${cx}" y="${y(Math.max(d.realizado, 0)) - 5}" text-anchor="middle" font-size="${sx < 15 ? 9 : sx < 20 ? 10.5 : 12.5}" fill="${d.realizado ? MORADO : MUTED}">${d.realizado}</text>` +
        (i % cadaEtq === 0 ? `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="11" fill="${INK}">D${d.dia}</text>` : "") + `</g>`;
    });
    return `<svg class="graf" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Muestras ejecutadas y planificadas por día">${s}</svg>`;
  }

  function graficoDona(pe, total) {
    const orden = ["realizado", "pendiente", "en_camino", "inconveniente"];
    const R = 44, G = 15, C = 2 * Math.PI * R, hay = orden.filter((k) => pe[k] > 0).length;
    let acum = 0, s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="#EEEEF1" stroke-width="${G}"/>`;
    orden.forEach((k) => {
      if (!pe[k] || !total) return;
      const largo = (pe[k] / total) * C, hueco = hay > 1 ? Math.min(2, largo / 2) : 0;
      s += `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${E[k].color}" stroke-width="${G}" stroke-dasharray="${largo - hueco} ${C - largo + hueco}"
        stroke-dashoffset="${-acum}" transform="rotate(-90 60 60)"><title>${E[k].etiqueta}: ${pe[k]} (${pct1(pe[k], total)})</title></circle>`;
      acum += largo;
    });
    s += `<text x="60" y="62" text-anchor="middle" font-size="26" font-weight="bold" fill="${INK}">${total}</text>` +
      `<text x="60" y="80" text-anchor="middle" font-size="12" fill="${MUTED}">Total</text>`;
    return `<svg class="dona" viewBox="0 0 120 120" role="img" aria-label="Distribución de las muestras por estado">${s}</svg>`;
  }

  // Muestras realizadas agrupadas por fecha de campo (fecha y hora del muestreo; si falta, la del último registro)
  function realizadasPorFecha(sub) {
    const g = {}; let sinFecha = 0;
    sub.forEach((p) => {
      const r = reg(p.id); if ((r.estado || "pendiente") !== "realizado") return;
      const iso = r.fecha_hora_muestreo || r.actualizado_en; if (!iso) { sinFecha++; return; }
      const d = new Date(iso), k = d.toLocaleDateString("en-CA");
      (g[k] = g[k] || []).push({ p, r, d });
    });
    return { fechas: Object.keys(g).sort().map((k) => ({ k, items: g[k].sort((a, b) => a.d - b.d) })), sinFecha };
  }
  const fechaCorta = (k) => new Date(k + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "").replace(" de ", " ");
  const fechaLarga = (k) => { const s = new Date(k + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" }); return s[0].toUpperCase() + s.slice(1); };
  const horaDe = (d) => d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
  function graficoFechas(fechas, W) {
    const H = 190, ml = 26, mr = 6, mt = 22, mb = 26, iw = W - ml - mr, ih = H - mt - mb, VERDE = "#00B574";
    const max = Math.max(1, ...fechas.map((f) => f.items.length));
    const paso = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 4), tope = Math.ceil(max / paso) * paso;
    const y = (v) => mt + ih - (v / tope) * ih;
    const n = Math.max(1, fechas.length), sx = iw / n, bw = Math.max(6, Math.min(40, sx * 0.62));
    const cadaEtq = Math.max(1, Math.ceil(34 / sx));
    let s = "";
    for (let v = 0; v <= tope; v += paso) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? "#ECE8F2" : "#B9B3C4"}"/>` +
      `<text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${MUTED}">${v}</text>`;
    fechas.forEach((f, i) => {
      const cx = ml + sx * (i + 0.5), v = f.items.length;
      s += `<g class="g-fecha" data-k="${f.k}"><title>${fechaLarga(f.k)}: ${v} muestra${v === 1 ? "" : "s"}</title>` +
        `<rect x="${cx - sx / 2}" y="${mt}" width="${sx}" height="${ih}" fill="transparent"/>` +
        `<path d="${barraArriba(cx - bw / 2, y(v), bw, mt + ih - y(v), 4)}" fill="${VERDE}"/>` +
        `<text x="${cx}" y="${y(v) - 6}" text-anchor="middle" font-size="${sx < 18 ? 10 : 13}" fill="${INK}">${v}</text>` +
        (i % cadaEtq === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${INK}">${fechaCorta(f.k)}</text>` : "") + `</g>`;
    });
    return `<svg class="graf" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Muestras realizadas por fecha">${s}</svg>`;
  }

  function pintarTablero() {
    const cont = $("#vistaEstadisticas .contenido"); if (!cont) return;
    const sub = PUNTOS.filter((p) => (filtroDia === "todos" || String(p.dia) === String(filtroDia)) &&
      (filtroSector === "todos" || sectorDe(p) === filtroSector));
    const st = Logica.estadisticas(sub, REG, RUTAS), pe = st.porEstado, tot = st.total;
    const dias = st.dias, jornHechas = dias.filter((d) => d.realizado > 0).length;
    const kpi = (k, t) => `<button class="kpi" data-estado="${k}" style="background:${E[k].suave}" title="Ver los puntos «${E[k].etiqueta}» en el mapa">
        ${circuloEstado(k, 36)}<b>${pe[k]}</b><span>${t}</span></button>`;

    // Productividad: mayor y menor jornada ejecutada
    const ejec = dias.filter((d) => d.realizado > 0);
    const mayor = ejec.length ? ejec.reduce((a, b) => (b.realizado > a.realizado ? b : a)) : null;
    const menor = ejec.length > 1 ? ejec.reduce((a, b) => (b.realizado < a.realizado ? b : a)) : null;

    // Cuellos de botella: puntos con inconvenientes (todos) y puntos no realizados cuya observación describe una causa
    const casos = {};
    sub.forEach((p) => {
      const r = reg(p.id), e = r.estado || "pendiente";
      if (e === "realizado") return;
      const c = causaDe(r.observaciones);
      if (e === "inconveniente" || (c !== "sin" && c !== "otros")) casos[c] = (casos[c] || 0) + 1;
    });
    const totalCasos = Object.values(casos).reduce((a, b) => a + b, 0);
    const filasCausa = CAUSAS.filter((c) => casos[c.k]).sort((a, b) => casos[b.k] - casos[a.k]);
    const maxCaso = Math.max(1, ...filasCausa.map((c) => casos[c.k]));

    // Próxima jornada: primer día del plan con muestras sin realizar
    const prox = RUTAS.map((r) => ({ r, pend: PUNTOS.filter((p) => p.dia === r.dia && estadoDe(p.id) !== "realizado") }))
      .find((x) => x.pend.length);

    const anchoCont = cont.clientWidth || Math.min(window.innerWidth - 24, 1000);
    const pf = realizadasPorFecha(sub), nReal = pf.fechas.reduce((a, f) => a + f.items.length, 0);
    const dosCol = anchoCont >= 340;
    const anchoGraf = Math.max(150, Math.floor((dosCol ? (anchoCont - 12) / 2 : anchoCont) - 30));

    cont.innerHTML = `<h2>Estadísticas del muestreo</h2>
      <div class="kpis">${kpi("realizado", "Realizadas")}${kpi("pendiente", "Pendientes")}${kpi("en_camino", "En camino")}${kpi("inconveniente", "Inconvenientes")}</div>

      <section class="tarj">
        <div class="tarj-cab"><h3><span class="t-ico">${ICO.meta}</span>Cumplimiento del plan</h3><span class="pct-pill">${pct1(pe.realizado, tot)}</span></div>
        <div class="barra-cumpl"><i style="width:${tot ? (pe.realizado / tot) * 100 : 0}%"></i></div>
        <div class="cumpl-pie"><span><span class="m-ico">${ICO.capas}</span>${pe.realizado} / ${tot} muestras</span>
          <span><span class="m-ico">${ICO.cal}</span>Jornadas: ${jornHechas} / ${dias.length}</span></div>
      </section>

      <section class="tarj">
        <h3><span class="t-ico">${ICO.cal}</span>Muestras realizadas por fecha</h3>
        ${pf.fechas.length ? `<p class="resumen-f">${nReal} muestra${nReal === 1 ? "" : "s"} en ${pf.fechas.length} fecha${pf.fechas.length === 1 ? "" : "s"} de campo ·
            promedio ${coma(nReal / pf.fechas.length)} por fecha${filtroSector !== "todos" ? ` · sector ${esc(filtroSector)}` : ""}</p>
          ${graficoFechas(pf.fechas, Math.max(240, Math.floor(anchoCont - 30)))}
          <p class="nota-tarj">Toque una barra o una fecha para ver las muestras de ese día.</p>
          <div class="fechas">${pf.fechas.slice().reverse().map((f, i) => `<details class="fecha" id="f-${f.k}"${i === 0 ? " open" : ""}>
            <summary><span class="f-tit">${fechaLarga(f.k)}</span><span class="f-n">${f.items.length} muestra${f.items.length === 1 ? "" : "s"}</span>
              <small>${horaDe(f.items[0].d)} – ${horaDe(f.items[f.items.length - 1].d)}</small></summary>
            <ol class="f-pts">${f.items.map((x) => `<li><button data-id="${esc(x.p.id)}"><span class="f-h">${horaDe(x.d)}</span>
              <span class="f-txt"><b>${esc(x.p.id)}</b><small>${esc(x.p.nombre_suerte || "Suerte " + x.p.suerte)}${x.p.orden_suelo ? " · " + esc(x.p.orden_suelo) : ""}${x.r.responsable ? " · " + esc(x.r.responsable) : ""}</small></span>
              <span class="flecha">›</span></button></li>`).join("")}</ol></details>`).join("")}</div>
          ${pf.sinFecha ? `<p class="nota-tarj">${pf.sinFecha} muestra(s) realizada(s) sin fecha registrada.</p>` : ""}`
        : `<p class="vacio">Aún no hay muestras realizadas${filtroSector !== "todos" || filtroDia !== "todos" ? " con los filtros seleccionados" : ""}.</p>`}
      </section>

      <div class="dash-2${dosCol ? "" : " una"}">
        <section class="tarj">
          <h3><span class="t-ico">${ICO.barras}</span>Muestras por día del plan</h3>
          ${dias.length ? graficoDias(dias, anchoGraf) : `<p class="vacio">Sin jornadas con los filtros seleccionados.</p>`}
          <div class="ley-graf"><span><i style="background:${MORADO}"></i>Ejecutadas</span><span><i style="background:${LILA_PLAN}"></i>Planificadas</span></div>
          <p class="prod">${mayor ? `<span class="pr-max">▲</span> Mayor: <b>Día ${mayor.dia}</b> (${mayor.realizado})` : "Aún no hay jornadas ejecutadas"}${menor && menor !== mayor ? `<br><span class="pr-min">▼</span> Menor: <b>Día ${menor.dia}</b> (${menor.realizado})` : ""}</p>
        </section>
        <section class="tarj">
          <h3><span class="t-ico">${ICO.torta}</span>Estado de las muestras</h3>
          <div class="dona-env">${graficoDona(pe, tot)}
            <ul class="ley-dona">${["realizado", "pendiente", "en_camino", "inconveniente"].map((k) =>
              `<li><i style="background:${E[k].color}"></i><span>${{ realizado: "Realizadas", pendiente: "Pendientes", en_camino: "En camino", inconveniente: "Inconvenientes" }[k]}<small>${pe[k]} (${pct1(pe[k], tot)})</small></span></li>`).join("")}</ul>
          </div>
        </section>
      </div>

      <section class="tarj">
        <h3><span class="t-ico">${ICO.alerta}</span>Principales cuellos de botella</h3>
        ${filasCausa.length ? `<div class="causas">${filasCausa.map((c, i) => `<div class="causa">
            <span class="c-ico">${svgIco(c.ico)}</span><span class="c-txt">${c.t}</span>
            <span class="c-barra"><i style="width:${(casos[c.k] / maxCaso) * 100}%;opacity:${Math.max(0.45, 1 - i * 0.14)}"></i></span>
            <span class="c-n">${casos[c.k]} (${pct1(casos[c.k], totalCasos)})</span></div>`).join("")}</div>
            <p class="nota-tarj">Causas tomadas de las observaciones de ${totalCasos} punto(s) no realizado(s) con inconvenientes.</p>`
          : `<p class="vacio">Sin inconvenientes registrados${filtroDia !== "todos" || filtroSector !== "todos" ? " con los filtros seleccionados" : ""}. Cuando un punto se marque
             «Con inconvenientes», la causa escrita en Observaciones (acceso, humedad, lluvia, cosecha, labores, vías…) aparecerá aquí.</p>`}
      </section>

      <div class="dash-2${dosCol ? "" : " una"}">
        <section class="tarj">
          <h3><span class="t-ico">${ICO.plan}</span>Plan de ejecución</h3>
          <ol class="linea-t">${dias.map((d) => {
            const est = d.realizado >= d.total ? "ok" : d.realizado > 0 ? "parcial" : "pend";
            const actual = prox && prox.r.dia === d.dia;
            return `<li class="${est}${actual ? " actual" : ""}"><button data-dia="${d.dia}" title="Ver los puntos del día ${d.dia}">
              <span class="lt-ico">${est === "ok" ? icoEstado("realizado", 16) : ""}</span><span class="lt-dia">Día ${d.dia}</span><span class="lt-n">${d.realizado} / ${d.total}</span></button></li>`;
          }).join("")}</ol>
        </section>
        <section class="tarj">
          <h3><span class="t-ico">${ICO.cal}</span>Próxima jornada</h3>
          ${prox ? `<div class="prox-dia"><span>${ICO.cal}</span>Día ${prox.r.dia}</div>
            <ul class="prox-datos">
              <li><span>${ICO.capas}</span>${prox.pend.length} muestra${prox.pend.length === 1 ? "" : "s"} planificada${prox.pend.length === 1 ? "" : "s"}</li>
              <li><span>${ICO.pin}</span>Distancia estimada: ${coma(prox.r.km)} km</li>
              <li><span>${ICO.reloj}</span>Tiempo estimado: ${coma(prox.r.horas_totales)} h</li>
            </ul>
            <button class="btn-jornada" id="btnJornada">${ICO.play}Iniciar jornada</button>`
          : `<div class="prox-dia ok">${icoEstado("realizado", 22)}Plan completado</div><p class="vacio">Todas las muestras del plan están realizadas.</p>`}
        </section>
      </div>
      <p class="nota">Indicadores calculados con los registros de campo${Sync.configurado ? " guardados en este celular y sincronizados con la base de datos" : " guardados en este celular"};
        se actualizan con cada cambio. Distancias y tiempos del plan de rutas (salida ${esc(META.hora_salida)}, jornada máxima ${coma(META.jornada_h, 0)} h).</p>`;

    cont.querySelectorAll(".kpi").forEach((b) => {
      b.onclick = () => {
        filtroEstado = b.dataset.estado; fijarSel("#selEstado", filtroEstado); mostrarVista("mapa"); pintarTodo(true);
        toast(`Mapa: solo puntos «${E[filtroEstado].etiqueta}» · toque ⤢ para ver todos`);
      };
    });
    const verDia = (dia) => { filtroDia = String(dia); $("#selDia").value = filtroDia; mostrarVista("mapa"); pintarTodo(true); };
    cont.querySelectorAll(".linea-t button, .g-barra").forEach((b) => { b.onclick = () => verDia(b.dataset.dia); });
    cont.querySelectorAll(".g-fecha").forEach((g) => {
      g.onclick = () => { const d = $("#f-" + g.dataset.k); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } };
    });
    cont.querySelectorAll(".f-pts button").forEach((b) => {
      b.onclick = () => { const q = PUNTO[b.dataset.id]; mostrarVista("mapa"); mapa.setView([q.lat, q.lon], 16); abrirFicha(q.id); };
    });
    const bj = $("#btnJornada");
    if (bj) bj.onclick = () => {
      filtroDia = String(prox.r.dia); filtroEstado = "todos"; $("#selDia").value = filtroDia; fijarSel("#selEstado", "todos");
      pintarTodo(true); iniciarNavegacion(siguienteDestino(prox.r.dia));
    };
  }
  let anchoInicio = 0;
  window.addEventListener("resize", () => {
    const w = window.innerWidth; if (Math.abs(w - anchoInicio) < 30) return; anchoInicio = w;
    if ($("#vistaEstadisticas.activa")) pintarEstadisticas();
  });

  // ---------------- Estadísticas ----------------
  function pintarEstadisticas() { pintarTablero(); }

  // ---------------- Más ----------------
  let eventoInstalar = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); eventoInstalar = e; pintarMas(); });
  async function pintarMas() {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const sesion = Sync.sesion;
    const ej = PUNTOS[0].id.split("-")[0] + "-000";
    $("#vistaMas .contenido").innerHTML = `<h2>Más opciones</h2>
      <h3>Leyenda</h3>
      <div class="leyenda">
        ${Object.keys(E).map((k) => `<div><span class="ley-ico">${circuloEstado(k, 28)}</span>${E[k].etiqueta}</div>`).join("")}
        <div><span class="ley-ico"><span class="mk-id" style="border-left-color:${COLORES[RUTAS[0].dia]};position:static">${ej}</span></span>El color del borde de la etiqueta indica el día</div>
        ${RUTAS.map((r) => `<div><span class="linea" style="background:${COLORES[r.dia]}"></span>Ruta del día ${r.dia}</div>`).join("")}
        <div><span class="ley-ico">${ICONO_SEDE}</span>Sede del ingenio (salida y regreso)</div>
        <div><span class="ley-ico">${FLECHA_GPS.replace(" sin-rumbo", "")}</span>Mi ubicación: el triángulo apunta hacia donde avanzo</div>
        <div><span class="ley-ico"><span class="linea" style="background:repeating-linear-gradient(90deg,#fff 0 7px,transparent 7px 12px);outline:2px solid #4A4A4A"></span></span>Mi recorrido de hoy (GPS)</div>
        ${PEAJES.length ? `<div><span class="ley-ico">${htmlPeaje(true)}</span>Peaje por el que pasa alguna ruta (al tocarlo muestra los días)</div>
        <div><span class="ley-ico">${htmlPeaje(false)}</span>Peaje cercano por el que no pasa ninguna ruta</div>` : ""}
      </div>
      <h3>Mi recorrido GPS</h3>
      <p class="nota" id="resumenRecorrido">Calculando…</p>
      <h3>Mapa sin señal</h3>
      <p class="nota" id="estadoMapaBase"></p>
      <button class="opcion" id="bMapaBase"><span>⬇️ Descargar o actualizar el mapa sin señal<small>Imagen satelital Sentinel-2 de toda la zona del ingenio (sin nubes, 2025–2026), para ver el mapa sin internet</small></span></button>
      <button class="opcion" id="bBorrarRecorrido"><span style="color:var(--magenta)">Borrar el recorrido guardado de este ingenio</span></button>
      <h3>Base de datos y sincronización</h3>
      <div class="aviso info" id="estadoSyncTexto">${esc($("#chipSync").textContent)}</div>
      ${!Sync.configurado ? `<p class="nota">La base de datos central aún no está configurada: los registros se guardan solo en este celular.
          Para compartirlos entre el equipo siga la <a href="https://github.com/pracagro2-hash/rutas-muestreo-suelos/blob/main/docs/CONFIGURACION_SUPABASE.md" target="_blank" rel="noopener">guía de configuración</a>.</p>`
        : sesion ? `<p class="nota">Sesión iniciada: ${esc(sesion.user.email)}${Sync.autorizado ? "" : " — este correo no está autorizado; solicite acceso al coordinador."}</p>
          <button class="opcion" id="bSync"><span>🔄 Sincronizar ahora</span></button><button class="opcion" id="bSalir"><span>Cerrar sesión</span></button>`
        : `<div class="campo"><label for="correo">Correo autorizado</label><input id="correo" type="email" inputmode="email" autocomplete="email" placeholder="nombre@empresa.com"></div>
          <div class="campo"><label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" placeholder="Contraseña de su usuario"></div>
          <button class="btn morado" id="bClave">Entrar con contraseña</button>
          <p class="nota" style="text-align:center;margin:4px 0 10px">o, sin contraseña:</p>
          <button class="btn borde" id="bEntrar">Enviarme un código al correo</button>
          <div class="campo"><label for="codigo">Código del correo</label><input id="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Escriba aquí el código"></div>
          <button class="btn borde" id="bCodigo">Entrar con el código</button>`}
      <h3>Aplicación</h3>
      ${eventoInstalar ? `<button class="opcion" id="bInstalar"><span>📲 Instalar la aplicación en este celular</span></button>` : ""}
      <a class="opcion" href="index.html"><span>🏠 Volver a la portada<small>Otros ingenios</small></span></a>
      <h3>Almacenamiento en este celular</h3>
      <p class="nota">${est ? `En uso: ${coma(est.usage / 1048576, 1)} MB de ${coma(est.quota / 1048576, 0)} MB disponibles.` : ""}
        Los registros y las fotos se guardan en el navegador y se conservan al cerrar la aplicación o reiniciar el celular.</p>
      <button class="opcion" id="bBorrar"><span style="color:var(--magenta)">Borrar los registros de este ingenio en este celular</span></button>
      <p class="nota">Plan: ${esc(META.metodo_rutas)} · generado el ${esc(META.generado)} · ${RUTAS.length} días · ${PUNTOS.length} puntos.</p>`;
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    on("#bSync", () => Sync.sincronizar());
    on("#bSalir", async () => { await Sync.cerrarSesion(); pintarMas(); });
    on("#bEntrar", async () => {
      const correo = $("#correo").value.trim();
      if (!correo) return toast("Escriba su correo");
      try { await Sync.iniciarSesion(correo); toast("Le enviamos un código al correo: escríbalo abajo, sin salir de esta página"); $("#codigo").focus(); }
      catch (e) { toast(/rate|limit|seconds/i.test(e.message) ? "Ya se enviaron varios correos: espere unos minutos o entre con contraseña" : e.message); }
    });
    const tras_entrar = async () => { toast("Sesión iniciada: sincronizando…"); setTimeout(pintarMas, 1500); };
    on("#bClave", async () => {
      const correo = $("#correo").value.trim(), clave = $("#clave").value;
      if (!correo || !clave) return toast("Escriba su correo y su contraseña");
      try { await Sync.entrarConContrasena(correo, clave); await tras_entrar(); } catch (e) { toast(e.message); }
    });
    on("#bCodigo", async () => {
      const correo = $("#correo").value.trim(), codigo = $("#codigo").value.replace(/\D/g, "");
      if (!correo || codigo.length < 6) return toast("Escriba su correo y el código que le llegó");
      try { await Sync.verificarCodigo(correo, codigo); await tras_entrar(); } catch (e) { toast(e.message); }
    });
    pintarEstadoBase();
    on("#bMapaBase", async () => {
      if (!navigator.onLine) { toast("Necesita internet para descargar el mapa"); return; }
      toast("Descargando el mapa sin señal…");
      const est = await descargarMapaBase(true);
      toast(est && est.version ? "Mapa sin señal listo" : "La descarga quedó incompleta: intente de nuevo con internet");
    });
    on("#bCsv", exportarCsv); on("#bGeojson", exportarGeojson); on("#bRecorrido", exportarRecorrido);
    on("#bBorrarRecorrido", async () => {
      if (!confirm(`¿Borrar el recorrido GPS de ${META.nombre} guardado en este celular? Exporte primero si lo necesita.`)) return;
      await Almacen.borrarRecorrido(ING); capaRecorrido.clearLayers(); lineaActual = null; toast("Recorrido borrado"); pintarMas();
    });
    tramosRecorrido().then((ts) => {
      const el = $("#resumenRecorrido"); if (!el) return;
      const n = ts.reduce((s, t) => s + t.u.length, 0), km = ts.reduce((s, t) => s + t.km, 0);
      el.textContent = n ? `${ts.length} tramo(s) · ${n} ubicaciones · ${coma(km)} km recorridos, guardados en este celular. El recorrido se graba automáticamente mientras la ubicación (triángulo) está activa y la pantalla encendida.`
        : "Aún no hay recorrido guardado. Se graba automáticamente al activar la ubicación con el botón del triángulo.";
    });
    on("#bInstalar", async () => { eventoInstalar.prompt(); eventoInstalar = null; pintarMas(); });
    on("#bBorrar", async () => {
      const pendientes = Object.values(REG).filter((r) => r.pendiente_sync).length;
      if (!confirm(`¿Borrar todos los registros de ${META.nombre} guardados en este celular?` + (pendientes && Sync.configurado ? `\n${pendientes} registro(s) aún no se han sincronizado y se perderán.` : ""))) return;
      await Almacen.borrarIngenio(ING); REG = {}; pintarTodo(false); toast("Registros locales borrados");
    });
  }
  function descargar(nombre, texto, tipo) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: tipo })); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportarCsv() {
    const cols = ["punto_id", "ingenio", "dia", "orden", "suerte", "estado", "borrador", "fecha_hora_muestreo", "responsable", "profundidad",
      "humedad_suelo", "observaciones", "n_fotos", "latitud", "longitud", "actualizado_en", "actualizado_por", "pendiente_sync"];
    const filas = PUNTOS.map((p) => { const r = reg(p.id); return [p.id, META.nombre, p.dia, p.orden, p.suerte, r.estado, r.borrador, r.fecha_hora_muestreo, r.responsable,
      r.profundidad, r.humedad_suelo, r.observaciones, (r.fotos || []).length, p.lat, p.lon, r.actualizado_en, r.actualizado_por, r.pendiente_sync]; });
    const csv = [cols].concat(filas).map((f) => f.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    descargar(`registros_muestreo_${ING.toLowerCase()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
  }
  async function tramosRecorrido() {
    const grupos = {};
    (await Almacen.recorridoDe(ING)).forEach((u) => { (grupos[u.tramo] = grupos[u.tramo] || []).push(u); });
    return Object.entries(grupos).map(([id, u]) => {
      u.sort((a, b) => a.t.localeCompare(b.t));
      let km = 0; for (let i = 1; i < u.length; i++) km += distanciaM(u[i - 1], u[i]) / 1000;
      return { id, u, km };
    });
  }
  async function exportarRecorrido() {
    const ts = await tramosRecorrido();
    if (!ts.length) { toast("Aún no hay recorrido guardado"); return; }
    const features = [];
    ts.forEach((tr) => {
      const ini = tr.u[0].t, fin = tr.u[tr.u.length - 1].t;
      if (tr.u.length > 1) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: tr.u.map((x) => [x.lon, x.lat]) },
        properties: { tipo: "tramo", tramo: tr.id, ingenio: META.nombre, inicio: ini, fin, n_ubicaciones: tr.u.length,
          km: +tr.km.toFixed(3), duracion_min: +((new Date(fin) - new Date(ini)) / 60000).toFixed(1), responsable: tr.u[0].responsable } });
      tr.u.forEach((x) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] },
        properties: { tipo: "ubicacion", tramo: tr.id, ingenio: META.nombre, fecha_hora: x.t, precision_m: x.precision_m,
          velocidad_kmh: x.velocidad_ms === null ? null : +(x.velocidad_ms * 3.6).toFixed(1), rumbo: x.rumbo, responsable: x.responsable } }));
    });
    descargar(`recorrido_gps_${ING.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.geojson`,
      JSON.stringify({ type: "FeatureCollection", features }), "application/geo+json");
  }
  function exportarGeojson() {
    const fc = { type: "FeatureCollection", features: PUNTOS.map((p) => { const r = reg(p.id); return { type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { id: p.id, ingenio: META.nombre, dia: p.dia, orden: p.orden, suerte: p.suerte, estado: r.estado,
        fecha_hora_muestreo: r.fecha_hora_muestreo, responsable: r.responsable, profundidad: r.profundidad, humedad_suelo: r.humedad_suelo,
        observaciones: r.observaciones, n_fotos: (r.fotos || []).length } }; }) };
    descargar(`puntos_estado_${ING.toLowerCase()}.geojson`, JSON.stringify(fc), "application/geo+json");
  }

  // ---------------- Navegación entre vistas ----------------
  function mostrarVista(v) {
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("activo", b.dataset.vista === v));
    document.querySelectorAll(".vista").forEach((s) => s.classList.toggle("activa", s.id === "vista" + v[0].toUpperCase() + v.slice(1)));
    if (v === "lista") pintarLista();
    if (v === "estadisticas") pintarEstadisticas();
    if (v === "mas") pintarMas();
    if (v === "mapa") setTimeout(() => mapa.invalidateSize(), 50);
  }
  document.querySelectorAll("#nav button").forEach((b) => { b.onclick = () => mostrarVista(b.dataset.vista); });
  if ($("#buscar")) $("#buscar").oninput = pintarLista;

  function pintarTodo(encuadrar) {
    pintarMapa(encuadrar); pintarAvance();
    const activa = document.querySelector(".vista.activa");
    if (activa && activa.id === "vistaLista") pintarLista();
    if (activa && activa.id === "vistaEstadisticas") pintarEstadisticas();
  }

  // ---------------- Sincronización e inicio ----------------
  function pintarEstadoSync(est) {
    const chip = $("#chipSync");
    chip.className = est.codigo; chip.textContent = est.texto; chip.title = est.texto; chip.setAttribute("aria-label", est.texto);
    const t = $("#estadoSyncTexto"); if (t) t.textContent = est.texto;
  }
  $("#chipSync").onclick = () => mostrarVista("mas");
  async function recargarRegistros() {
    REG = {};
    for (const r of await Almacen.registrosDe(ING)) REG[r.punto_id] = r;
    pintarTodo(false);
    if (seleccionado) pintarFicha();
  }

  async function iniciar() {
    try { await recargarRegistros(); } catch (e) { toast("No se pudo abrir el almacenamiento local: " + e.message); }
    pintarMapa(true); pintarAvance(); pintarBotonGps();
    cargarRecorridoDeHoy().catch(() => {});
    Sync.iniciar(ING, recargarRegistros, pintarEstadoSync);
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker:", e));
      // La red vial para navegar se descarga en segundo plano: así queda guardada para usarla sin señal en campo
      setTimeout(() => fetch(`data/red_${ING.toLowerCase()}.js`).catch(() => {}), 6000);
      // y la imagen Sentinel-2 de la zona del ingenio (mapa base sin internet), salvo en modo ahorro de datos
      if (!(navigator.connection && navigator.connection.saveData)) setTimeout(() => descargarMapaBase(), 9000);
    }
  }
  iniciar();
})();
