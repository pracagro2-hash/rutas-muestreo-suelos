# Configuración de la base de datos central (Supabase)

Sin esta configuración la aplicación funciona en **modo local**: cada celular guarda sus propios registros
(IndexedDB) y no se comparten. Con Supabase, todos los usuarios autorizados ven los mismos estados y los cambios
se sincronizan automáticamente cuando hay internet.

Supabase tiene un plan gratuito suficiente para este proyecto (180 puntos, fotos reducidas a ~200 KB).

## 1. Crear el proyecto
1. Ingresar a <https://supabase.com> con la cuenta institucional → **New project**.
2. Nombre sugerido: `rutas-muestreo-suelos`. Región: la más cercana (por ejemplo, *East US* o *São Paulo*).
3. Guardar la contraseña de la base de datos en un lugar seguro (no se usa en la aplicación).

## 2. Crear las tablas, permisos y almacenamiento de fotos
En **SQL Editor → New query**, ejecutar en este orden (copiar el contenido completo de cada archivo y pulsar *Run*):
1. [`supabase/migrations/001_esquema_muestreo.sql`](../supabase/migrations/001_esquema_muestreo.sql) — tablas, historial,
   control de versiones, políticas de seguridad (RLS) y el bucket privado `fotos-muestreo`.
2. [`supabase/semilla_puntos.sql`](../supabase/semilla_puntos.sql) — los 180 puntos del plan con los mismos
   identificadores del mapa (INC-027, MN-014, …). Se puede volver a ejecutar sin duplicar puntos.

## 3. Autorizar al equipo
Solo los correos de esta tabla pueden leer y escribir. En **SQL Editor**:

```sql
insert into public.usuarios_autorizados (email, nombre, rol) values
  ('correo1@cenicana.org', 'Nombre Apellido', 'coordinador'),
  ('correo2@ejemplo.com',  'Nombre Apellido', 'campo');
```

## 4. Acceso por correo (sin contraseñas)
En **Authentication → URL Configuration**:
- **Site URL:** `https://pracagro2-hash.github.io/rutas-muestreo-suelos/`
- **Redirect URLs:** agregar `https://pracagro2-hash.github.io/rutas-muestreo-suelos/*`

En **Authentication → Sign In / Providers → Email**: dejar *Email* habilitado. Recomendado: desactivar
*Allow new users to sign up* (la aplicación solo admite correos previamente autorizados).

Luego crear a cada usuario en **Authentication → Users → Add user → Send invitation** con el mismo correo
autorizado en el paso 3.

## 5. Conectar la aplicación
En **Project Settings → API** copiar:
- **Project URL** (por ejemplo `https://abcdxyz.supabase.co`)
- La clave **anon** / **publishable** (es pública por diseño; la seguridad la dan las políticas RLS)

y pegarlas en [`app/config.js`](../app/config.js):

```js
SUPABASE_URL: "https://abcdxyz.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

> ⚠️ **Nunca** coloque la clave `service_role` (secreta) en ningún archivo del repositorio.

Después de publicar el cambio, en la aplicación: **Más → Base de datos y sincronización → Enviar enlace de acceso**.
El usuario recibe un correo, abre el enlace en el celular y queda conectado (la sesión se conserva).

## Cómo funciona la sincronización
| Situación | Comportamiento |
|---|---|
| Sin internet | Los cambios y fotos se guardan en el celular y quedan en cola (indicador “Sin conexión · N por subir”). |
| Vuelve internet | La cola se sube automáticamente; luego se descargan los cambios de los demás usuarios. |
| Dos personas editan el mismo punto | La base de datos rechaza la versión desactualizada (**CONFLICTO**). El celular conserva sus datos y muestra ambas versiones para elegir *Usar mis datos* o *Usar los del servidor*. Nada se sobrescribe en silencio. |
| Historial | Cada inserción o modificación queda en `historial_registros` (trigger en la base de datos), con usuario y fecha. |
| Fotos | Se reducen en el celular (máx. 1280 px, JPEG) y se suben al bucket privado `fotos-muestreo`; el registro guarda solo la ruta. |
| Borrado | La aplicación no puede borrar registros de la base de datos (no hay política de DELETE). |

## Tablas
| Tabla | Contenido |
|---|---|
| `puntos_muestreo` | Punto del plan: `punto_id`, ingenio, suerte, día, orden, lat/lon y `geom` (PostGIS, EPSG:4326) |
| `registros_muestreo` | Un registro por punto: estado, borrador, fecha y hora, responsable, profundidad, humedad, observaciones, fotos, versión, último usuario |
| `historial_registros` | Versiones anteriores y nuevas de cada registro, usuario y fecha |
| `usuarios_autorizados` | Correos con acceso y su rol |
