/*
 * Navegación tipo Waze calculada en el celular, sin internet:
 *  - ruta más rápida desde la ubicación actual hasta un destino sobre la red vial del plan (incluye callejones),
 *    con los mismos tiempos calibrados que se usaron para planear las rutas;
 *  - instrucciones de giro en las intersecciones, seguimiento sobre la ruta y distancia/tiempo restantes.
 * Lógica pura (sin interfaz). Se prueba en tests/pruebas.html.
 * Coordenadas como [lat, lon] (WGS84).
 */
(function (global) {
  "use strict";
  const R = 6371008.8, RAD = Math.PI / 180, CELDA = 0.004;   // celda de la grilla espacial ≈ 440 m

  function distancia(a, b) {
    const h = Math.sin((b[0] - a[0]) * RAD / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin((b[1] - a[1]) * RAD / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function rumbo(a, b) {
    const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
    const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  /** Punto más cercano a p en el segmento a–b (aproximación plana local, precisa a escala de cientos de metros). */
  function proyectar(p, a, b) {
    const k = Math.cos(p[0] * RAD);
    const ax = (a[1] - p[1]) * k, ay = a[0] - p[0], bx = (b[1] - p[1]) * k, by = b[0] - p[0];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { t, q, d: distancia(p, q) };
  }

  // ------------------------------------------------------------------ red vial
  /** Prepara la red exportada por el notebook (data/red_<ingenio>.js) para calcular rutas. */
  function cargarRed(d) {
    const n = d.nodos.length / 2, A = d.aristas.length;
    const lat = new Float64Array(n), lon = new Float64Array(n), grado = new Uint16Array(n);
    for (let i = 0; i < n; i++) { lat[i] = d.nodos[2 * i] / 1e6; lon[i] = d.nodos[2 * i + 1] / 1e6; }
    const ea = new Int32Array(A), eb = new Int32Array(A), sentido = new Uint8Array(A), seg = new Float64Array(A);
    const tipo = new Int16Array(A), nombre = new Int32Array(A), geom = new Array(A), cum = new Array(A);
    const adj = Array.from({ length: n }, () => []), grilla = new Map();
    const f = d.f_cal || 1;
    d.aristas.forEach((x, e) => {
      const [a, b, s, , d10, t, nm, internos] = x;
      ea[e] = a; eb[e] = b; sentido[e] = s; seg[e] = d10 / 10 * f; tipo[e] = t; nombre[e] = nm;
      const g = [[lat[a], lon[a]]];
      let la = d.nodos[2 * a], lo = d.nodos[2 * a + 1];
      for (let i = 0; i < internos.length; i += 2) { la += internos[i]; lo += internos[i + 1]; g.push([la / 1e6, lo / 1e6]); }
      g.push([lat[b], lon[b]]);
      const c = new Float64Array(g.length);
      for (let i = 1; i < g.length; i++) c[i] = c[i - 1] + distancia(g[i - 1], g[i]);
      geom[e] = g; cum[e] = c;
      if (s & 1) adj[a].push(e, b, 1);
      if (s & 2) adj[b].push(e, a, -1);
      grado[a]++; grado[b]++;
      for (let i = 0; i < g.length - 1; i++) {   // cada segmento en las celdas que cubre su recuadro
        const i0 = Math.floor(Math.min(g[i][0], g[i + 1][0]) / CELDA), i1 = Math.floor(Math.max(g[i][0], g[i + 1][0]) / CELDA);
        const j0 = Math.floor(Math.min(g[i][1], g[i + 1][1]) / CELDA), j1 = Math.floor(Math.max(g[i][1], g[i + 1][1]) / CELDA);
        for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
          const k = ci + "," + cj;
          let l = grilla.get(k); if (!l) grilla.set(k, (l = []));
          l.push(e, i);
        }
      }
    });
    return { n, lat, lon, grado, ea, eb, sentido, seg, tipo, nombre, geom, cum, adj, grilla, tipos: d.tipos, nombres: d.nombres };
  }

  /** Lugar de la red más cercano a p (hasta maxM metros): arista, fracción recorrida y punto sobre la vía. */
  function ubicarEnRed(red, p, maxM = 3000) {
    const ci = Math.floor(p[0] / CELDA), cj = Math.floor(p[1] / CELDA);
    let mejor = null;
    const anillos = Math.ceil(maxM / 440) + 1;
    for (let r = 0; r <= anillos; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const l = red.grilla.get((ci + a) + "," + (cj + b));
        if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const e = l[k], i = l[k + 1], g = red.geom[e];
          const pr = proyectar(p, g[i], g[i + 1]);
          if (!mejor || pr.d < mejor.d) {
            const c = red.cum[e], s = c[i] + (c[i + 1] - c[i]) * pr.t;
            mejor = { e, d: pr.d, q: pr.q, f: c[c.length - 1] > 0 ? s / c[c.length - 1] : 0 };
          }
        }
      }
      if (mejor && mejor.d < (r - 0.5) * 440) break;   // ningún anillo más externo puede estar más cerca
    }
    return mejor && mejor.d <= maxM ? mejor : null;
  }

  /** Coordenadas de la arista e entre las fracciones f0 y f1 (en sentido inverso si f0 > f1). */
  function trozo(red, e, f0, f1) {
    const g = red.geom[e], c = red.cum[e], L = c[c.length - 1];
    const punto = (f) => {
      const s = f * L;
      let i = 1; while (i < c.length - 1 && c[i] < s) i++;
      const t = c[i] > c[i - 1] ? (s - c[i - 1]) / (c[i] - c[i - 1]) : 0;
      return [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t];
    };
    const lo = Math.min(f0, f1), hi = Math.max(f0, f1), sal = [punto(lo)];
    for (let i = 1; i < g.length - 1; i++) if (c[i] > lo * L && c[i] < hi * L) sal.push(g[i]);
    sal.push(punto(hi));
    return f0 <= f1 ? sal : sal.reverse();
  }

  // Cola de prioridad (montículo binario) para Dijkstra
  function Monticulo() { this.n = []; this.p = []; }
  Monticulo.prototype.push = function (nodo, prio) {
    const n = this.n, p = this.p; let i = n.length; n.push(nodo); p.push(prio);
    while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= p[i]) break; [n[i], n[j]] = [n[j], n[i]]; [p[i], p[j]] = [p[j], p[i]]; i = j; }
  };
  Monticulo.prototype.pop = function () {
    const n = this.n, p = this.p, top = [n[0], p[0]], ln = n.pop(), lp = p.pop();
    if (n.length) {
      n[0] = ln; p[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < n.length && p[l] < p[m]) m = l;
        if (r < n.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [n[i], n[m]] = [n[m], n[i]]; [p[i], p[m]] = [p[m], p[i]]; i = m;
      }
    }
    return top;
  };
  Object.defineProperty(Monticulo.prototype, "vacio", { get() { return this.n.length === 0; } });

  /**
   * Ruta más rápida desde `origen` hasta `destino` ([lat, lon]) respetando el sentido de circulación.
   * Devuelve la geometría, metros, segundos (calibrados), tramos por vía y maniobras; null si no hay ruta.
   */
  function calcularRuta(red, origen, destino) {
    const so = ubicarEnRed(red, origen), sd = ubicarEnRed(red, destino);
    if (!so || !sd) return null;
    const T = red.seg, dist = new Float64Array(red.n).fill(Infinity);
    const prevE = new Int32Array(red.n).fill(-1), prevDir = new Int8Array(red.n), h = new Monticulo();
    const relajar = (nodo, costo, e, dir) => { if (costo < dist[nodo]) { dist[nodo] = costo; prevE[nodo] = e; prevDir[nodo] = dir; h.push(nodo, costo); } };
    // Desde el punto de partida sobre su vía, hacia los extremos permitidos por el sentido
    if (red.sentido[so.e] & 1) relajar(red.eb[so.e], (1 - so.f) * T[so.e], -2, 1);
    if (red.sentido[so.e] & 2) relajar(red.ea[so.e], so.f * T[so.e], -2, -1);
    let mejor = Infinity, fin = null;
    if (so.e === sd.e) {                                   // mismo tramo
      if ((red.sentido[so.e] & 1) && sd.f >= so.f) { mejor = (sd.f - so.f) * T[so.e]; fin = { directo: 1 }; }
      if ((red.sentido[so.e] & 2) && sd.f <= so.f && (so.f - sd.f) * T[so.e] < mejor) { mejor = (so.f - sd.f) * T[so.e]; fin = { directo: -1 }; }
    }
    while (!h.vacio) {
      const [u, du] = h.pop();
      if (du >= mejor) break;
      if (du > dist[u]) continue;
      if (u === red.ea[sd.e] && (red.sentido[sd.e] & 1) && du + sd.f * T[sd.e] < mejor) { mejor = du + sd.f * T[sd.e]; fin = { nodo: u, dir: 1 }; }
      if (u === red.eb[sd.e] && (red.sentido[sd.e] & 2) && du + (1 - sd.f) * T[sd.e] < mejor) { mejor = du + (1 - sd.f) * T[sd.e]; fin = { nodo: u, dir: -1 }; }
      const a = red.adj[u];
      for (let k = 0; k < a.length; k += 3) relajar(a[k + 1], du + T[a[k]], a[k], a[k + 2]);
    }
    if (!fin) return null;

    // Reconstrucción: lista de piezas {e, f0, f1}
    const piezas = [];
    if (fin.directo) piezas.push({ e: so.e, f0: so.f, f1: sd.f });
    else {
      const medio = [];
      let u = fin.nodo;
      while (prevE[u] !== -2) { const e = prevE[u], dir = prevDir[u]; medio.push({ e, f0: dir === 1 ? 0 : 1, f1: dir === 1 ? 1 : 0 }); u = dir === 1 ? red.ea[e] : red.eb[e]; }
      piezas.push({ e: so.e, f0: so.f, f1: prevDir[u] === 1 ? 1 : 0 });
      piezas.push(...medio.reverse());
      piezas.push({ e: sd.e, f0: fin.dir === 1 ? 0 : 1, f1: sd.f });
    }
    const coords = [], tramos = [];
    let segundos = 0;
    for (const pz of piezas) {
      if (Math.abs(pz.f1 - pz.f0) < 1e-9 && piezas.length > 1) continue;   // pieza vacía (inicio o fin en un nodo)
      const c = trozo(red, pz.e, pz.f0, pz.f1);
      const ini = coords.length ? coords.length - 1 : 0;
      if (coords.length) c.shift();
      coords.push(...c);
      const t = Math.abs(pz.f1 - pz.f0) * T[pz.e];
      tramos.push({ e: pz.e, i0: ini, i1: coords.length - 1, segundos: t, tipo: red.tipos[red.tipo[pz.e]],
        nombre: red.nombre[pz.e] >= 0 ? red.nombres[red.nombre[pz.e]] : "" });
      segundos += t;
    }
    if (coords.length < 2) coords.push(coords[0] || so.q);
    const cum = new Float64Array(coords.length);
    for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distancia(coords[i - 1], coords[i]);
    let acum = 0;
    tramos.forEach((t) => { t.s0 = cum[t.i0]; t.s1 = cum[t.i1]; t.t0 = acum; acum += t.segundos; });
    const ruta = { coords, cum, metros: cum[cum.length - 1], segundos, tramos, inicio: so.q, fin: sd.q,
      distanciaAlInicio: so.d, distanciaDestinoVia: sd.d };
    ruta.maniobras = maniobras(red, ruta);
    return ruta;
  }

  function puntoEn(ruta, s) {
    const c = ruta.cum, g = ruta.coords;
    if (s <= 0) return g[0];
    if (s >= c[c.length - 1]) return g[g.length - 1];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m; else hi = m; }
    const t = c[hi] > c[lo] ? (s - c[lo]) / (c[hi] - c[lo]) : 0;
    return [g[lo][0] + (g[hi][0] - g[lo][0]) * t, g[lo][1] + (g[hi][1] - g[lo][1]) * t];
  }

  /** Giros en las intersecciones donde cambia de vía (no en las curvas de una misma vía). */
  function maniobras(red, ruta) {
    const sal = [];
    for (let k = 1; k < ruta.tramos.length; k++) {
      const a = ruta.tramos[k - 1], b = ruta.tramos[k], s = b.s0;
      const nodo = ruta.coords[b.i0];
      const entra = rumbo(puntoEn(ruta, Math.max(0, s - 20)), nodo), sale = rumbo(nodo, puntoEn(ruta, Math.min(ruta.metros, s + 20)));
      const giro = ((sale - entra + 540) % 360) - 180;          // + derecha, − izquierda
      const ab = Math.abs(giro);
      // ¿hay otras vías en ese cruce? (si no, es solo la continuación de la vía)
      const e = b.e, n = red.geom[e][0][0] === nodo[0] && red.geom[e][0][1] === nodo[1] ? red.ea[e] : red.eb[e];
      const cruce = red.grado[n] > 2;
      let tipo = null;
      if (ab >= 150) tipo = "retorno";
      else if (cruce && ab >= 55) tipo = giro > 0 ? "derecha" : "izquierda";
      else if (cruce && ab >= 25) tipo = giro > 0 ? "leve-derecha" : "leve-izquierda";
      if (!tipo) continue;
      if (sal.length && s - sal[sal.length - 1].s < 8) continue;  // dos giros pegados: se anuncia el primero
      sal.push({ s, tipo, giro: Math.round(giro), nombre: b.nombre, tipoVia: b.tipo, desde: a.nombre });
    }
    return sal;
  }

  /** Posición sobre la ruta: distancia recorrida (s) y separación de la ruta (d), buscando cerca de la anterior. */
  function ubicarEnRuta(ruta, p, sPrevio) {
    const g = ruta.coords, c = ruta.cum;
    const buscar = (sMin, sMax) => {
      let mejor = null;
      for (let i = 0; i < g.length - 1; i++) {
        if (c[i + 1] < sMin || c[i] > sMax) continue;
        const pr = proyectar(p, g[i], g[i + 1]);
        if (!mejor || pr.d < mejor.d) mejor = { d: pr.d, s: c[i] + (c[i + 1] - c[i]) * pr.t, q: pr.q };
      }
      return mejor;
    };
    let r = sPrevio !== undefined && sPrevio !== null ? buscar(sPrevio - 150, sPrevio + 2000) : null;
    if (!r || r.d > 40) { const todo = buscar(-1, Infinity); if (!r || todo.d < r.d) r = todo; }
    return r;
  }

  /** Lo que viene desde la posición s: siguiente maniobra (o la llegada) y su distancia; tiempo restante. */
  function estadoEn(ruta, s) {
    const m = ruta.maniobras.find((x) => x.s > s + 3);
    const restante = Math.max(0, ruta.metros - s);
    let seg = 0;
    for (const t of ruta.tramos) {
      if (t.s1 <= s) continue;
      const largo = t.s1 - t.s0;
      seg += largo > 0 ? t.segundos * (t.s1 - Math.max(s, t.s0)) / largo : 0;
    }
    return { maniobra: m || null, distanciaManiobra: m ? m.s - s : restante, metrosRestantes: restante, segundosRestantes: seg };
  }

  const VIAS = { track: "el callejón", service: "el camino de finca", residential: "la calle", unclassified: "el camino" };
  function textoManiobra(m) {
    if (!m) return "Siga hasta el destino";
    const base = { derecha: "Gire a la derecha", izquierda: "Gire a la izquierda", "leve-derecha": "Gire levemente a la derecha",
      "leve-izquierda": "Gire levemente a la izquierda", retorno: "Dé la vuelta en U" }[m.tipo];
    const por = m.nombre ? ` por ${m.nombre}` : VIAS[m.tipoVia] ? ` por ${VIAS[m.tipoVia]}` : "";
    return base + (m.tipo === "retorno" ? "" : por);
  }
  function textoDistancia(metros) {
    if (metros >= 1000) return (Math.round(metros / 100) / 10).toLocaleString("es-CO") + " km";
    if (metros >= 100) return Math.round(metros / 50) * 50 + " m";
    return Math.max(0, Math.round(metros / 10) * 10) + " m";
  }

  global.Navegacion = { distancia, rumbo, cargarRed, ubicarEnRed, calcularRuta, ubicarEnRuta, estadoEn, puntoEn, textoManiobra, textoDistancia };
})(typeof window !== "undefined" ? window : globalThis);
