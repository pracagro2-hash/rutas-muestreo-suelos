/*
 * Sincronización con la base de datos central (Supabase). Inactiva mientras
 * CONFIG_APP.SUPABASE_URL / SUPABASE_ANON_KEY estén vacíos (modo solo local).
 *
 * - Los cambios se guardan primero en el celular (IndexedDB) y se suben por una cola.
 * - Control de concurrencia optimista: cada registro tiene una versión; si otro usuario
 *   lo modificó, la base de datos responde CONFLICTO y se conservan ambas versiones
 *   para que el usuario decida (nunca se sobrescribe en silencio).
 * - Las fotos se suben al bucket privado y en el registro se guarda solo su ruta.
 */
(function (global) {
  "use strict";
  const C = global.CONFIG_APP || {};
  const configurado = Boolean(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  let cliente = null, ingenio = null, alCambiar = () => {}, alEstado = () => {};
  let sincronizando = false, autorizado = false, sesion = null, ultimoError = "";

  function cargarLibreria() {
    if (global.supabase) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar la librería de Supabase"));
      document.head.appendChild(s);
    });
  }

  async function estadoActual() {
    if (!configurado) return { codigo: "local", texto: "Solo en este celular" };
    if (!navigator.onLine) {
      const n = (await Almacen.leerCola()).filter((o) => o.ingenio === ingenio).length;
      return { codigo: "sin_conexion", texto: n ? `Sin conexión · ${n} por subir` : "Sin conexión" };
    }
    if (!sesion) return { codigo: "sin_sesion", texto: "Inicie sesión para sincronizar" };
    if (!autorizado) return { codigo: "no_autorizado", texto: "Correo no autorizado" };
    if (ultimoError) return { codigo: "error", texto: "Error de sincronización" };
    const n = (await Almacen.leerCola()).filter((o) => o.ingenio === ingenio).length;
    return n ? { codigo: "pendiente", texto: `${n} cambio(s) por subir` } : { codigo: "sincronizado", texto: "Sincronizado" };
  }
  const avisarEstado = async () => alEstado(await estadoActual());

  const datosRegistro = (r) => ({
    estado: r.estado, borrador: !!r.borrador, fecha_hora_muestreo: r.fecha_hora_muestreo || null,
    responsable: r.responsable || "", profundidad: r.profundidad || "",
    humedad_suelo: r.humedad_suelo === null || r.humedad_suelo === undefined ? null : r.humedad_suelo,
    observaciones: r.observaciones || "",
    fotos: (r.fotos || []).map((f) => ({ id: f.id, nombre: f.nombre, ruta_remota: f.ruta_remota || null, creado: f.creado })),
  });

  async function subirFoto(op) {
    const foto = await Almacen.obtenerFoto(op.foto_id);
    if (!foto) return true; // ya no existe localmente
    if (!foto.ruta_remota) {
      const ruta = `${foto.ingenio}/${foto.punto_id}/${foto.id}.jpg`;
      const { error } = await cliente.storage.from(C.BUCKET_FOTOS).upload(ruta, foto.blob, { contentType: "image/jpeg", upsert: false });
      if (error && !/exists|Duplicate/i.test(error.message)) throw error;
      foto.ruta_remota = ruta;
      await Almacen.guardarFoto(foto);
    }
    // Actualiza la referencia en el registro (y deja el registro en cola para subir esa referencia)
    const regs = await Almacen.registrosDe(foto.ingenio);
    const reg = regs.find((r) => r.punto_id === foto.punto_id);
    if (reg) {
      const fotos = (reg.fotos || []).map((f) => (f.id === foto.id ? Object.assign({}, f, { ruta_remota: foto.ruta_remota }) : f));
      await Almacen.guardarRegistro(Object.assign({}, reg, { fotos, pendiente_sync: true }));
    }
    return true;
  }

  async function subirRegistro(op) {
    const regs = await Almacen.registrosDe(op.ingenio);
    const reg = regs.find((r) => r.punto_id === op.punto_id);
    if (!reg || !reg.pendiente_sync || reg.conflicto) return true;
    if ((reg.fotos || []).some((f) => !f.ruta_remota)) return false; // espera a que suban las fotos
    const marca = reg.actualizado_en;
    const { data, error } = await cliente.rpc("guardar_registro", {
      p_punto_id: reg.punto_id, p_ingenio: reg.ingenio, p_version_esperada: reg.version_remota || 0, p_datos: datosRegistro(reg),
    });
    if (error) {
      if (/CONFLICTO/.test(error.message || "")) {
        const { data: remoto } = await cliente.from("registros_muestreo").select("*").eq("punto_id", reg.punto_id).single();
        await Almacen.guardarSinCola(Object.assign({}, reg, { conflicto: remoto ? Object.assign({}, remoto, { actualizado_por: remoto.actualizado_por_email }) : null }));
        alCambiar();
        return true; // sale de la cola; queda esperando la decisión del usuario
      }
      throw error;
    }
    const fila = Array.isArray(data) ? data[0] : data;
    const actual = (await Almacen.registrosDe(op.ingenio)).find((r) => r.punto_id === op.punto_id);
    if (actual && actual.actualizado_en !== marca) {
      // El usuario editó el punto durante la subida: se actualiza la versión y la operación sigue en cola
      await Almacen.guardarSinCola(Object.assign({}, actual, { version_remota: fila.version }));
      return false;
    }
    await Almacen.guardarSinCola(Object.assign({}, actual || reg, { version_remota: fila.version, pendiente_sync: false }));
    return true;
  }

  async function bajarCambios() {
    const { data, error } = await cliente.from("registros_muestreo").select("*").eq("ingenio", ingenio);
    if (error) throw error;
    const locales = {};
    for (const r of await Almacen.registrosDe(ingenio)) locales[r.punto_id] = r;
    let hubo = false;
    for (const fila of data || []) {
      const remoto = Object.assign({}, fila, { actualizado_por: fila.actualizado_por_email || "" });
      const combinado = Logica.combinarRemoto(locales[fila.punto_id], remoto);
      if (combinado !== locales[fila.punto_id]) { await Almacen.guardarSinCola(combinado); hubo = true; }
    }
    if (hubo) alCambiar();
  }

  async function sincronizar() {
    if (!configurado || !cliente || !sesion || !autorizado || !navigator.onLine || sincronizando) { await avisarEstado(); return; }
    sincronizando = true;
    alEstado({ codigo: "sincronizando", texto: "Sincronizando…" });
    try {
      const cola = (await Almacen.leerCola()).filter((o) => o.ingenio === ingenio)
        .sort((a, b) => (a.tipo === "foto" ? 0 : 1) - (b.tipo === "foto" ? 0 : 1) || a.id - b.id);
      for (const op of cola) {
        const listo = op.tipo === "foto" ? await subirFoto(op) : await subirRegistro(op);
        if (listo) await Almacen.quitarDeCola(op.id);
      }
      await bajarCambios();
      ultimoError = "";
    } catch (e) {
      ultimoError = e.message || String(e);
      console.warn("Sincronización:", ultimoError);
    } finally {
      sincronizando = false;
      await avisarEstado();
    }
  }

  async function verificarAutorizacion() {
    autorizado = false;
    if (!sesion) return;
    const { data, error } = await cliente.rpc("es_autorizado");
    autorizado = !error && data === true;
  }

  const Sync = {
    configurado,
    get sesion() { return sesion; },
    get autorizado() { return autorizado; },
    get ultimoError() { return ultimoError; },

    async iniciar(ing, onCambios, onEstado) {
      ingenio = ing; alCambiar = onCambios || alCambiar; alEstado = onEstado || alEstado;
      global.addEventListener("online", () => sincronizar());
      global.addEventListener("offline", () => avisarEstado());
      if (!configurado) { await avisarEstado(); return; }
      try {
        await cargarLibreria();
        cliente = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        const { data } = await cliente.auth.getSession();
        sesion = data.session;
        await verificarAutorizacion();
        cliente.auth.onAuthStateChange(async (_e, s) => { sesion = s; await verificarAutorizacion(); sincronizar(); });
        setInterval(sincronizar, C.INTERVALO_SYNC_MS || 60000);
        await sincronizar();
      } catch (e) {
        ultimoError = e.message || String(e);
        await avisarEstado();
      }
    },

    async iniciarSesion(correo) {
      if (!cliente) throw new Error("La base de datos no está configurada");
      const destino = location.href.split("#")[0].split("?")[0];
      const { error } = await cliente.auth.signInWithOtp({ email: correo, options: { emailRedirectTo: destino, shouldCreateUser: false } });
      if (error) throw error;
    },

    async cerrarSesion() { if (cliente) await cliente.auth.signOut(); sesion = null; autorizado = false; await avisarEstado(); },

    sincronizar,
    avisarEstado,

    async urlFoto(ruta) {
      if (!cliente || !ruta) return null;
      const { data } = await cliente.storage.from(C.BUCKET_FOTOS).createSignedUrl(ruta, 3600);
      return data ? data.signedUrl : null;
    },

    async historialRemoto(punto_id) {
      if (!cliente || !sesion || !autorizado || !navigator.onLine) return null;
      const { data, error } = await cliente.from("historial_registros").select("*").eq("punto_id", punto_id)
        .order("fecha", { ascending: false }).limit(50);
      return error ? null : data;
    },
  };
  global.Sync = Sync;
})(window);
