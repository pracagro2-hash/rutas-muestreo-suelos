/*
 * Configuración de la aplicación de rutas de muestreo.
 *
 * SUPABASE_URL y SUPABASE_ANON_KEY son valores PÚBLICOS del proyecto de Supabase
 * (Project Settings → API → "Project URL" y la clave "anon"/"publishable").
 * La seguridad de los datos la dan las políticas RLS definidas en
 * supabase/migrations/001_esquema_muestreo.sql — NUNCA coloque aquí la clave
 * "service_role" ni ninguna otra clave secreta.
 *
 * Si se dejan vacíos, la aplicación funciona en modo local: los registros se
 * guardan solo en el celular (IndexedDB) y no se comparten entre usuarios.
 */
window.CONFIG_APP = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  BUCKET_FOTOS: "fotos-muestreo",

  // Nombres del equipo de campo para el selector de responsable (también se puede escribir otro).
  RESPONSABLES: [],

  // Profundidades de muestreo disponibles en el formulario.
  PROFUNDIDADES: ["0–15 cm", "15–30 cm", "0–15 y 15–30 cm"],

  // Fotografías: se reducen en el celular antes de guardarlas para ahorrar espacio y datos.
  FOTO_MAX_PX: 1280,
  FOTO_CALIDAD_JPEG: 0.7,
  FOTOS_MAX_POR_PUNTO: 6,

  // Intervalo de consulta de cambios de otros usuarios cuando hay conexión (milisegundos).
  INTERVALO_SYNC_MS: 60000,
};
