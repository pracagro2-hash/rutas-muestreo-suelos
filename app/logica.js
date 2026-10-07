/*
 * Lógica pura de la aplicación (sin interfaz ni almacenamiento): estados, registros,
 * historial, estadísticas y siguiente punto pendiente. Se prueba en tests/pruebas.html.
 */
(function (global) {
  "use strict";

  const ESTADOS = {
    // color: círculo del marcador; suave: fondo de etiquetas y tarjetas; svg: ícono blanco (viewBox 0 0 24 24)
    pendiente: { etiqueta: "Pendiente", color: "#9E9E9E", suave: "#F1F1F3", icono: "○",
      svg: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z" },
    en_camino: { etiqueta: "En camino", color: "#2F80ED", suave: "#E6F0FD", icono: "➜",
      svg: "M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" },
    realizado: { etiqueta: "Realizado", color: "#00B574", suave: "#E2F7EE", icono: "✓", svg: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" },
    inconveniente: { etiqueta: "Con inconvenientes", color: "#EC3D96", suave: "#FDE7F1", icono: "!", svg: "M10.6 5h2.8l-.4 9.5h-2zM10.5 16.5h3v3h-3z" },
  };
  const CAMPOS_EDITABLES = ["estado", "borrador", "fecha_hora_muestreo", "responsable", "profundidad",
    "humedad_suelo", "observaciones", "fotos"];

  /** Registro vacío (pendiente) para un punto. */
  function registroInicial(punto, ingenio) {
    return {
      punto_id: punto.id, ingenio: ingenio, estado: "pendiente", borrador: false,
      fecha_hora_muestreo: null, responsable: "", profundidad: "", humedad_suelo: null,
      observaciones: "", fotos: [], historial: [],
      version_remota: 0,        // versión confirmada por la base de datos central (0 = nunca sincronizado)
      pendiente_sync: false,    // hay cambios locales sin subir
      conflicto: null,          // copia remota cuando otro usuario modificó el mismo punto
      actualizado_en: null, actualizado_por: "",
    };
  }

  function iguales(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  /**
   * Aplica cambios a un registro y devuelve un registro NUEVO (no muta el anterior),
   * agregando una entrada al historial con los valores anteriores y nuevos.
   * Si no hay cambios reales, devuelve el mismo registro (no se duplica el historial).
   */
  function aplicarCambios(registro, cambios, usuario, ahoraISO) {
    if (cambios.estado && !ESTADOS[cambios.estado]) throw new Error("Estado no válido: " + cambios.estado);
    if (cambios.humedad_suelo !== undefined && cambios.humedad_suelo !== null && cambios.humedad_suelo !== "") {
      const h = Number(cambios.humedad_suelo);
      if (!Number.isFinite(h) || h < 0 || h > 100) throw new Error("La humedad del suelo debe estar entre 0 y 100 %");
      cambios = Object.assign({}, cambios, { humedad_suelo: h });
    } else if (cambios.humedad_suelo === "") {
      cambios = Object.assign({}, cambios, { humedad_suelo: null });
    }
    const difs = {};
    for (const c of CAMPOS_EDITABLES) {
      if (c in cambios && !iguales(registro[c], cambios[c])) difs[c] = [registro[c] ?? null, cambios[c]];
    }
    if (!Object.keys(difs).length) return registro;
    const nuevo = Object.assign({}, registro);
    for (const c of Object.keys(difs)) nuevo[c] = cambios[c];
    // Al marcar como realizado se registra la fecha y hora si no se indicó otra
    if (difs.estado && cambios.estado === "realizado" && !nuevo.fecha_hora_muestreo) {
      nuevo.fecha_hora_muestreo = ahoraISO;
      difs.fecha_hora_muestreo = [null, ahoraISO];
    }
    nuevo.actualizado_en = ahoraISO;
    nuevo.actualizado_por = usuario || "";
    nuevo.pendiente_sync = true;
    nuevo.historial = (registro.historial || []).concat([{ fecha: ahoraISO, usuario: usuario || "", cambios: difs }]);
    return nuevo;
  }

  /** Estadísticas reales a partir de los puntos, los registros y las rutas. */
  function estadisticas(puntos, registrosPorId, rutas) {
    const porEstado = { pendiente: 0, en_camino: 0, realizado: 0, inconveniente: 0 };
    const porDia = {};
    const vistos = new Set();
    for (const p of puntos) {
      if (vistos.has(p.id)) continue;            // un punto nunca se cuenta dos veces
      vistos.add(p.id);
      const est = (registrosPorId[p.id] && registrosPorId[p.id].estado) || "pendiente";
      porEstado[est] += 1;
      const d = (porDia[p.dia] = porDia[p.dia] || { dia: p.dia, total: 0, pendiente: 0, en_camino: 0, realizado: 0, inconveniente: 0 });
      d.total += 1;
      d[est] += 1;
    }
    const total = vistos.size;
    const rutasPorDia = {};
    for (const r of rutas || []) rutasPorDia[r.dia] = r;
    const dias = Object.values(porDia).sort((a, b) => a.dia - b.dia).map((d) => {
      const r = rutasPorDia[d.dia];
      return Object.assign(d, {
        avance: d.total ? d.realizado / d.total : 0,
        km: r && Number.isFinite(r.km) ? r.km : null,
        horas_viaje: r && Number.isFinite(r.horas_viaje) ? r.horas_viaje : null,
        horas_muestreo: r && Number.isFinite(r.horas_muestreo) ? r.horas_muestreo : null,
        horas_totales: r && Number.isFinite(r.horas_totales) ? r.horas_totales : null,
        regreso: r ? r.regreso : null,
      });
    });
    const suma = (k) => (dias.every((d) => d[k] !== null) ? dias.reduce((s, d) => s + d[k], 0) : null);
    return {
      total, porEstado, avance: total ? porEstado.realizado / total : 0, dias,
      km_total: suma("km"), horas_viaje: suma("horas_viaje"), horas_muestreo: suma("horas_muestreo"),
      horas_totales: suma("horas_totales"),
    };
  }

  /** Siguiente punto no realizado según el orden de visita (opcionalmente de un día). */
  function siguientePendiente(puntos, registrosPorId, dia) {
    return puntos
      .filter((p) => dia === undefined || dia === null || dia === "todos" || String(p.dia) === String(dia))
      .filter((p) => {
        const e = (registrosPorId[p.id] && registrosPorId[p.id].estado) || "pendiente";
        return e !== "realizado";
      })
      .sort((a, b) => a.dia - b.dia || a.orden - b.orden)[0] || null;
  }

  /**
   * Combina un registro local con uno remoto (base de datos central) SIN perder información:
   * - sin cambios locales pendientes → se adopta el remoto;
   * - con cambios locales y el remoto no avanzó → se conserva el local (se subirá);
   * - con cambios locales y el remoto avanzó → conflicto: se conserva el local y se guarda la copia remota.
   */
  function combinarRemoto(local, remoto) {
    const base = local || null;
    if (!base) return Object.assign({ historial: [], pendiente_sync: false, conflicto: null }, remoto, { version_remota: remoto.version });
    if (!base.pendiente_sync) {
      return Object.assign({}, base, remoto, { version_remota: remoto.version, pendiente_sync: false, conflicto: null,
        historial: base.historial || [] });
    }
    if (remoto.version <= (base.version_remota || 0)) return base;
    return Object.assign({}, base, { conflicto: remoto });
  }

  global.Logica = { ESTADOS, CAMPOS_EDITABLES, registroInicial, aplicarCambios, estadisticas, siguientePendiente, combinarRemoto };
})(typeof window !== "undefined" ? window : globalThis);
