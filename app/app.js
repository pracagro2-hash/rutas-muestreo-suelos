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
  let filtroDia = "todos", filtroEstado = "todos", seleccionado = null, editando = false;

  const usuarioActual = () => (Sync.sesion && Sync.sesion.user && Sync.sesion.user.email) || localStorage.getItem("rutas_responsable") || "";
  const reg = (id) => REG[id] || Logica.registroInicial(PUNTO[id], ING);
  const estadoDe = (id) => reg(id).estado || "pendiente";

  // ---------------- Encabezado ----------------
  document.title = `Rutas de muestreo de suelos — Ingenio ${META.nombre}`;
  $("#tituloApp").innerHTML = `Rutas de muestreo de suelos<span class="oculto"> — Ingenio ${esc(META.nombre)}</span>`;
  $("#selDia").innerHTML = `<option value="todos">Todos los días</option>` +
    RUTAS.map((r) => `<option value="${r.dia}">Día ${r.dia} · ${r.n_puntos} puntos</option>`).join("");
  $("#selEstado").innerHTML = `<option value="todos">Todos los estados</option>` +
    Object.entries(E).map(([k, v]) => `<option value="${k}">${v.etiqueta}</option>`).join("");

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, 2600);
  }

  // ---------------- Mapa ----------------
  const mapa = L.map("mapa", { zoomControl: false, attributionControl: true, preferCanvas: false });
  L.control.zoom({ position: "bottomleft" }).addTo(mapa);
  const capaSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Imagen © Esri" });
  const capaCalles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
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
    (filtroEstado === "todos" || estadoDe(p.id) === filtroEstado);

  function pintarMapa(encuadrar) {
    RUTAS.forEach((r) => {
      const ver = filtroDia === "todos" || String(r.dia) === String(filtroDia);
      ver ? capaRutas[r.dia].addTo(mapa) : mapa.removeLayer(capaRutas[r.dia]);
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
    el.classList.remove("sin-rumbo"); el.style.transform = `translate(-50%, -50%) rotate(${rumbo}deg)`;
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
      if (seguir) mapa.setView(ll, Math.max(mapa.getZoom(), 16), { animate: true });
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

  // ---------------- Botones flotantes ----------------
  $("#btnCapa").onclick = () => {
    if (enSatelite) { mapa.removeLayer(capaSat); capaCalles.addTo(mapa); } else { mapa.removeLayer(capaCalles); capaSat.addTo(mapa); }
    enSatelite = !enSatelite; $("#btnCapa").title = enSatelite ? "Cambiar a mapa de calles" : "Cambiar a imagen satelital";
  };
  $("#btnTodo").onclick = () => { filtroDia = "todos"; filtroEstado = "todos"; $("#selDia").value = "todos"; $("#selEstado").value = "todos"; seguir = false; pintarBotonGps(); pintarTodo(true); };
  $("#btnSiguiente").onclick = () => {
    const p = Logica.siguientePendiente(PUNTOS, REG, filtroDia);
    if (!p) { toast(filtroDia === "todos" ? "¡Todos los puntos están realizados!" : `El día ${filtroDia} está completo`); return; }
    mostrarVista("mapa"); mapa.setView([p.lat, p.lon], 16); abrirFicha(p.id);
  };
  $("#selDia").onchange = (e) => { filtroDia = e.target.value; pintarTodo(true); };
  $("#selEstado").onchange = (e) => { filtroEstado = e.target.value; pintarTodo(false); };

  // ---------------- Avance general ----------------
  function pintarAvance() {
    const st = Logica.estadisticas(PUNTOS, REG, RUTAS);
    const dia = filtroDia === "todos" ? null : st.dias.find((d) => String(d.dia) === String(filtroDia));
    const base = dia || { total: st.total, realizado: st.porEstado.realizado, avance: st.avance };
    $("#barraAvance").innerHTML = `${dia ? `Día ${dia.dia}` : "Avance general"}: <b>${base.realizado}/${base.total}</b> realizados (${Math.round(base.avance * 100)} %)` +
      `<div class="barra"><i style="width:${base.avance * 100}%"></i></div>`;
    $("#subtitulo").textContent = `Ingenio ${META.nombre} · ${st.porEstado.realizado}/${st.total} realizados · ${coma(st.km_total, 0)} km`;
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
        <div><span>Suerte</span>${esc(p.suerte)}</div>
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
      <div class="botones-dobles">
        <a class="btn morado" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving">➜ Navegar a este punto</a>
        <button class="btn borde" id="bCentrar">◎ Centrar en el mapa</button></div>
      <h3 style="font-size:14px;margin:14px 0 6px">Historial de cambios</h3>
      <div class="historial" id="historial">${historialHtml(r.historial)}</div>
      <p class="nota">${r.pendiente_sync && Sync.configurado ? "⏳ Cambios pendientes de sincronizar." : ""}
        ${r.actualizado_en ? `Última modificación: ${fechaHora(r.actualizado_en)}${r.actualizado_por ? " por " + esc(r.actualizado_por) : ""}.` : ""}</p>`;
    $("#cerrarFicha").onclick = cerrarFicha;
    $("#bCentrar").onclick = () => { cerrarFicha(); mostrarVista("mapa"); seguir = false; pintarBotonGps(); mapa.setView([p.lat, p.lon], 17); };
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
    const q = ($("#buscar") && $("#buscar").value.trim().toLowerCase()) || "";
    const html = RUTAS.filter((r) => filtroDia === "todos" || String(r.dia) === String(filtroDia)).map((r) => {
      const pts = PUNTOS.filter((p) => p.dia === r.dia && visible(p) && (!q || p.id.toLowerCase().includes(q) || String(p.suerte).toLowerCase().includes(q)))
        .sort((a, b) => a.orden - b.orden);
      if (!pts.length) return "";
      const hechos = PUNTOS.filter((p) => p.dia === r.dia && estadoDe(p.id) === "realizado").length;
      const totalDia = PUNTOS.filter((p) => p.dia === r.dia).length;
      return `<section class="grupo-dia"><header><span class="sw" style="background:${COLORES[r.dia]}"></span><b>Día ${r.dia}</b>
          <span class="det">${coma(r.km)} km · viaje ${coma(r.horas_viaje)} h · muestreo ${coma(r.horas_muestreo)} h · regreso ${esc(r.regreso)}</span>
          <span>${hechos === totalDia ? "✅" : `${hechos}/${totalDia}`}</span></header>
        ${pts.map((p) => { const e = estadoDe(p.id); return `<button class="fila-punto" data-id="${esc(p.id)}">
          ${circuloEstado(e, 36)}<span class="txt"><span class="id">${p.orden}. ${esc(p.id)}</span>
          <span class="meta">Suerte ${esc(p.suerte)} · ${coma(p.edad_meses)} meses</span>
          <span class="meta">${esc(p.hora_llegada)}–${esc(p.hora_salida)} · ${coma(p.km_desde_anterior)} km desde la parada anterior</span></span>
          ${pildoraEstado(e)}<span class="flecha">›</span></button>`; }).join("")}
      </section>`;
    }).join("");
    $("#listaPuntos").innerHTML = html || "<p class='nota'>No hay puntos con los filtros seleccionados.</p>";
    $("#listaPuntos").querySelectorAll(".fila-punto").forEach((b) => {
      b.onclick = () => { const p = PUNTO[b.dataset.id]; mostrarVista("mapa"); mapa.setView([p.lat, p.lon], 16); abrirFicha(p.id); };
    });
  }

  // ---------------- Estadísticas ----------------
  function pintarEstadisticas() {
    const st = Logica.estadisticas(PUNTOS, REG, RUTAS), pe = st.porEstado, pc = (x) => `${Math.round(x * 100)} %`;
    const tarjeta = (n, t, k) => `<div class="tarjeta" data-estado="${k}" style="background:${E[k].suave}">${circuloEstado(k, 30)}<b>${n}</b><span>${t}</span></div>`;
    const ang = Math.round(st.avance * 360);
    $("#vistaEstadisticas .contenido").innerHTML = `<h2>Estadísticas del muestreo</h2>
      <div class="avance-total">
        <span>Avance total</span>
        <div class="anillo" style="background:conic-gradient(var(--verde) ${ang}deg, #ECECEF ${ang}deg)"><i>${coma(st.avance * 100)} %</i></div>
        <div><b>${pe.realizado} de ${st.total}</b><span>puntos realizados</span></div>
      </div>
      <div class="tarjetas">
        ${tarjeta(pe.realizado, "Realizados", "realizado")}${tarjeta(pe.pendiente, "Pendientes", "pendiente")}
        ${tarjeta(pe.en_camino, "En camino", "en_camino")}${tarjeta(pe.inconveniente, "Inconvenientes", "inconveniente")}
      </div>
      <h3>Plan por día</h3>
      <div class="plan-dias">${st.dias.map((d) => `<button class="plan-dia" data-dia="${d.dia}"><span class="sw" style="background:${COLORES[d.dia]}"></span>
          <span class="pd-txt"><span>Día ${d.dia}</span><small>${coma(d.km)} km · ${coma(d.horas_totales)} h · regreso ${esc(d.regreso || "—")}</small></span>
          <span class="pd-barra"><i style="width:${d.avance * 100}%;background:${COLORES[d.dia]}"></i></span>
          <span class="pd-n">${d.realizado}/${d.total}</span><span class="flecha">›</span></button>`).join("")}</div>
      <h3>Detalle por día</h3>
      <div class="tabla-env"><table class="tabla"><thead><tr><th>Día</th><th>Realizados</th><th>Avance</th><th>Pend.</th><th>Inconv.</th><th>Km</th><th>H. viaje</th><th>H. muestreo</th><th>H. total</th><th>Regreso</th></tr></thead><tbody>
        ${st.dias.map((d) => `<tr><td><span class="pto" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COLORES[d.dia]}"></span> ${d.dia}</td>
          <td>${d.realizado}/${d.total}</td><td>${pc(d.avance)}</td><td>${d.pendiente + d.en_camino}</td><td>${d.inconveniente}</td>
          <td>${coma(d.km)}</td><td>${coma(d.horas_viaje)}</td><td>${coma(d.horas_muestreo)}</td><td>${coma(d.horas_totales)}</td><td>${esc(d.regreso || "—")}</td></tr>`).join("")}
        <tr class="total"><td>Total</td><td>${pe.realizado}/${st.total}</td><td>${pc(st.avance)}</td><td>${pe.pendiente + pe.en_camino}</td><td>${pe.inconveniente}</td>
          <td>${coma(st.km_total)}</td><td>${coma(st.horas_viaje)}</td><td>${coma(st.horas_muestreo)}</td><td>${coma(st.horas_totales)}</td><td></td></tr>
      </tbody></table></div>
      <p class="nota">Las distancias y los tiempos son los del plan de rutas (${esc(META.metodo_rutas)}), con salida a las ${esc(META.hora_salida)}
        y jornada máxima de ${coma(META.jornada_h, 0)} h; incluyen factores de riesgo de transporte y de campo. Los estados se calculan con los registros
        guardados${Sync.configurado ? " y sincronizados" : " en este celular"}. Plan generado el ${esc(META.generado)}.</p>`;
    document.querySelectorAll(".plan-dia").forEach((b) => {
      b.onclick = () => { filtroDia = b.dataset.dia; $("#selDia").value = filtroDia; mostrarVista("mapa"); pintarTodo(true); };
    });
  }

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
      </div>
      <h3>Mi recorrido GPS</h3>
      <p class="nota" id="resumenRecorrido">Calculando…</p>
      <button class="opcion" id="bRecorrido"><span>⬇️ Exportar recorrido (GeoJSON)<small>Tramos con hora, velocidad y precisión de cada ubicación, para calibrar los tiempos del modelo de rutas</small></span></button>
      <button class="opcion" id="bBorrarRecorrido"><span style="color:var(--magenta)">Borrar el recorrido guardado de este ingenio</span></button>
      <h3>Base de datos y sincronización</h3>
      <div class="aviso info" id="estadoSyncTexto">${esc($("#chipSync").textContent)}</div>
      ${!Sync.configurado ? `<p class="nota">La base de datos central aún no está configurada: los registros se guardan solo en este celular.
          Para compartirlos entre el equipo siga la <a href="https://github.com/pracagro2-hash/rutas-muestreo-suelos/blob/main/docs/CONFIGURACION_SUPABASE.md" target="_blank" rel="noopener">guía de configuración</a>.</p>`
        : sesion ? `<p class="nota">Sesión iniciada: ${esc(sesion.user.email)}${Sync.autorizado ? "" : " — este correo no está autorizado; solicite acceso al coordinador."}</p>
          <button class="opcion" id="bSync"><span>🔄 Sincronizar ahora</span></button><button class="opcion" id="bSalir"><span>Cerrar sesión</span></button>`
        : `<div class="campo"><label for="correo">Correo autorizado</label><input id="correo" type="email" inputmode="email" autocomplete="email" placeholder="nombre@empresa.com"></div>
          <button class="btn morado" id="bEntrar">Enviar enlace de acceso</button>`}
      <h3>Datos</h3>
      <button class="opcion" id="bCsv"><span>⬇️ Exportar registros (CSV)<small>Estado, responsable, profundidad, humedad y observaciones de cada punto</small></span></button>
      <button class="opcion" id="bGeojson"><span>⬇️ Exportar puntos con estado (GeoJSON)<small>Para QGIS / QField</small></span></button>
      <a class="opcion" href="rutas_${ING.toLowerCase()}.kml" download><span>⬇️ Descargar KML del plan<small>Sede, rutas por día y puntos (QField / Google Earth)</small></span></a>
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
      try { await Sync.iniciarSesion(correo); toast("Revise su correo y abra el enlace de acceso"); } catch (e) { toast(e.message); }
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
  $("#buscar").oninput = pintarLista;

  function pintarTodo(encuadrar) {
    pintarMapa(encuadrar); pintarAvance();
    const activa = document.querySelector(".vista.activa");
    if (activa && activa.id === "vistaLista") pintarLista();
    if (activa && activa.id === "vistaEstadisticas") pintarEstadisticas();
  }

  // ---------------- Sincronización e inicio ----------------
  function pintarEstadoSync(est) {
    const chip = $("#chipSync");
    chip.className = est.codigo; chip.textContent = est.texto;
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
    }
  }
  iniciar();
})();
