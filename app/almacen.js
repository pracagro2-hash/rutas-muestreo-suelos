/*
 * Almacenamiento local persistente (IndexedDB): registros de los puntos, cola de
 * sincronización y fotografías. Los datos sobreviven al cierre del navegador y al
 * reinicio del celular. Se prueba en tests/pruebas.html.
 */
(function (global) {
  "use strict";
  const NOMBRE_BD = "rutas_muestreo_suelos";
  const VERSION_BD = 2;   // v2: almacén "recorrido" (ubicaciones GPS registradas en campo)
  let bdPromesa = null;

  function abrir() {
    if (bdPromesa) return bdPromesa;
    bdPromesa = new Promise((resolver, rechazar) => {
      const sol = indexedDB.open(NOMBRE_BD, VERSION_BD);
      sol.onupgradeneeded = () => {
        const bd = sol.result;
        if (!bd.objectStoreNames.contains("registros")) {
          bd.createObjectStore("registros", { keyPath: "punto_id" }).createIndex("ingenio", "ingenio");
        }
        if (!bd.objectStoreNames.contains("cola")) {
          bd.createObjectStore("cola", { keyPath: "id", autoIncrement: true }).createIndex("punto_id", "punto_id");
        }
        if (!bd.objectStoreNames.contains("fotos")) {
          bd.createObjectStore("fotos", { keyPath: "id" }).createIndex("punto_id", "punto_id");
        }
        if (!bd.objectStoreNames.contains("recorrido")) {
          bd.createObjectStore("recorrido", { keyPath: "id", autoIncrement: true }).createIndex("ingenio", "ingenio");
        }
      };
      sol.onsuccess = () => resolver(sol.result);
      sol.onerror = () => rechazar(sol.error);
    });
    // Solicita almacenamiento persistente (evita que el navegador borre los datos por falta de espacio)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return bdPromesa;
  }

  function tx(almacenes, modo, trabajo) {
    return abrir().then((bd) => new Promise((resolver, rechazar) => {
      const t = bd.transaction(almacenes, modo);
      let resultado;
      Promise.resolve(trabajo(t)).then((r) => { resultado = r; });
      t.oncomplete = () => resolver(resultado);
      t.onerror = () => rechazar(t.error);
      t.onabort = () => rechazar(t.error);
    }));
  }

  const req = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

  const Almacen = {
    abrir,

    registrosDe(ingenio) {
      return tx(["registros"], "readonly", (t) => req(t.objectStore("registros").index("ingenio").getAll(ingenio)));
    },

    /** Guarda el registro y, si tiene cambios pendientes, deja UNA operación en la cola para ese punto. */
    guardarRegistro(registro) {
      return tx(["registros", "cola"], "readwrite", async (t) => {
        t.objectStore("registros").put(registro);
        if (registro.pendiente_sync) {
          const cola = t.objectStore("cola");
          const existentes = await req(cola.index("punto_id").getAll(registro.punto_id));
          const yaHay = existentes.some((o) => o.tipo === "registro");
          if (!yaHay) cola.add({ tipo: "registro", punto_id: registro.punto_id, ingenio: registro.ingenio, creado: new Date().toISOString() });
        }
        return registro;
      });
    },

    guardarSinCola(registro) {
      return tx(["registros"], "readwrite", (t) => { t.objectStore("registros").put(registro); return registro; });
    },

    leerCola() {
      return tx(["cola"], "readonly", (t) => req(t.objectStore("cola").getAll()));
    },

    encolar(op) {
      return tx(["cola"], "readwrite", (t) => req(t.objectStore("cola").add(Object.assign({ creado: new Date().toISOString() }, op))));
    },

    quitarDeCola(id) {
      return tx(["cola"], "readwrite", (t) => { t.objectStore("cola").delete(id); });
    },

    guardarFoto(foto) { // {id, punto_id, ingenio, blob, nombre, creado, ruta_remota}
      return tx(["fotos"], "readwrite", (t) => { t.objectStore("fotos").put(foto); return foto; });
    },

    obtenerFoto(id) {
      return tx(["fotos"], "readonly", (t) => req(t.objectStore("fotos").get(id)));
    },

    fotosDe(punto_id) {
      return tx(["fotos"], "readonly", (t) => req(t.objectStore("fotos").index("punto_id").getAll(punto_id)));
    },

    /** Recorrido GPS: una ubicación {ingenio, tramo, t, lat, lon, precision_m, velocidad_ms, rumbo, responsable}. */
    agregarUbicacion(u) {
      return tx(["recorrido"], "readwrite", (t) => { t.objectStore("recorrido").add(u); });
    },

    recorridoDe(ingenio) {
      return tx(["recorrido"], "readonly", (t) => req(t.objectStore("recorrido").index("ingenio").getAll(ingenio)));
    },

    borrarRecorrido(ingenio) {
      return tx(["recorrido"], "readwrite", async (t) => {
        const claves = await req(t.objectStore("recorrido").index("ingenio").getAllKeys(ingenio));
        for (const k of claves) t.objectStore("recorrido").delete(k);
      });
    },

    /** Borra los datos locales de un ingenio (solo registros sin sincronizar se pierden; se pide confirmación en la interfaz). */
    borrarIngenio(ingenio) {
      return tx(["registros", "cola", "fotos"], "readwrite", async (t) => {
        const claves = await req(t.objectStore("registros").index("ingenio").getAllKeys(ingenio));
        for (const k of claves) t.objectStore("registros").delete(k);
        for (const almacen of ["fotos", "cola"]) {
          const todos = await req(t.objectStore(almacen).getAll());
          for (const o of todos) if (o.ingenio === ingenio) t.objectStore(almacen).delete(o.id);
        }
      });
    },
  };

  global.Almacen = Almacen;
})(window);
