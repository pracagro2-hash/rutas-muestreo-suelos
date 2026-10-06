-- =============================================================================
-- Rutas de muestreo de suelos — esquema de la base de datos central (Supabase / PostgreSQL)
-- Ejecutar UNA vez en: Supabase → SQL Editor → New query → pegar y Run.
-- Luego ejecutar supabase/semilla_puntos.sql (puntos del plan) y autorizar los correos del equipo.
-- =============================================================================

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Usuarios autorizados (solo estos correos pueden leer y escribir)
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  email      text primary key check (email = lower(email)),
  nombre     text,
  rol        text not null default 'campo' check (rol in ('campo', 'coordinador')),
  creado_en  timestamptz not null default now()
);

create or replace function public.es_autorizado()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.usuarios_autorizados u
                 where u.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ---------------------------------------------------------------------------
-- Puntos del plan (identificador = ID del mapa, p. ej. INC-027). Coordenadas WGS84 (EPSG:4326).
-- ---------------------------------------------------------------------------
create table if not exists public.puntos_muestreo (
  punto_id  text primary key,
  ingenio   text not null,
  suerte    text,
  dia       smallint not null,
  orden     smallint not null,
  lat       double precision not null check (lat between -90 and 90),
  lon       double precision not null check (lon between -180 and 180),
  geom      extensions.geometry(Point, 4326) generated always as (extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)) stored,
  creado_en timestamptz not null default now()
);
create index if not exists puntos_muestreo_ingenio_idx on public.puntos_muestreo (ingenio);

-- ---------------------------------------------------------------------------
-- Registro del muestreo de cada punto (uno por punto: evita contar dos veces el mismo punto)
-- ---------------------------------------------------------------------------
create table if not exists public.registros_muestreo (
  punto_id              text primary key references public.puntos_muestreo (punto_id),
  ingenio               text not null,
  estado                text not null default 'pendiente'
                        check (estado in ('pendiente', 'en_camino', 'realizado', 'inconveniente')),
  borrador              boolean not null default false,
  fecha_hora_muestreo   timestamptz,
  responsable           text,
  profundidad           text,
  humedad_suelo         numeric(5, 2) check (humedad_suelo between 0 and 100),
  observaciones         text,
  fotos                 jsonb not null default '[]'::jsonb,   -- [{id, nombre, ruta_remota, creado}]
  version               integer not null default 1,
  actualizado_en        timestamptz not null default now(),
  actualizado_por       uuid default auth.uid(),
  actualizado_por_email text
);
create index if not exists registros_muestreo_ingenio_idx on public.registros_muestreo (ingenio);

-- ---------------------------------------------------------------------------
-- Historial de modificaciones (lo escribe un trigger; los usuarios no pueden alterarlo)
-- ---------------------------------------------------------------------------
create table if not exists public.historial_registros (
  id                bigint generated always as identity primary key,
  punto_id          text not null,
  ingenio           text not null,
  version           integer not null,
  datos_anteriores  jsonb,
  datos_nuevos      jsonb not null,
  usuario           uuid,
  usuario_email     text,
  fecha             timestamptz not null default now()
);
create index if not exists historial_registros_punto_idx on public.historial_registros (punto_id, fecha desc);

create or replace function public.registrar_historial()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.historial_registros (punto_id, ingenio, version, datos_anteriores, datos_nuevos, usuario, usuario_email)
  values (new.punto_id, new.ingenio, new.version,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new),
          auth.uid(), lower(auth.jwt() ->> 'email'));
  return new;
end;
$$;

drop trigger if exists registros_muestreo_historial on public.registros_muestreo;
create trigger registros_muestreo_historial
  after insert or update on public.registros_muestreo
  for each row execute function public.registrar_historial();

-- ---------------------------------------------------------------------------
-- Guardado con control de versión (concurrencia optimista).
-- Si otro usuario modificó el punto, lanza 'CONFLICTO' y NO sobrescribe.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_registro(
  p_punto_id text, p_ingenio text, p_version_esperada integer, p_datos jsonb)
returns public.registros_muestreo
language plpgsql security invoker set search_path = public
as $$
declare
  actual public.registros_muestreo;
  resultado public.registros_muestreo;
begin
  if not public.es_autorizado() then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  select * into actual from public.registros_muestreo where punto_id = p_punto_id for update;

  if not found then
    if coalesce(p_version_esperada, 0) <> 0 then
      raise exception 'CONFLICTO: el registro % no existe en la base de datos', p_punto_id using errcode = 'P0001';
    end if;
    insert into public.registros_muestreo (punto_id, ingenio, estado, borrador, fecha_hora_muestreo, responsable, profundidad,
                                           humedad_suelo, observaciones, fotos, version, actualizado_en, actualizado_por, actualizado_por_email)
    values (p_punto_id, p_ingenio, coalesce(p_datos ->> 'estado', 'pendiente'), coalesce((p_datos ->> 'borrador')::boolean, false),
            (p_datos ->> 'fecha_hora_muestreo')::timestamptz, p_datos ->> 'responsable', p_datos ->> 'profundidad',
            (p_datos ->> 'humedad_suelo')::numeric, p_datos ->> 'observaciones', coalesce(p_datos -> 'fotos', '[]'::jsonb),
            1, now(), auth.uid(), lower(auth.jwt() ->> 'email'))
    returning * into resultado;
    return resultado;
  end if;

  -- Versión 1 sin modificaciones de usuario (semilla) se acepta como base 0
  if actual.version <> coalesce(p_version_esperada, 0)
     and not (coalesce(p_version_esperada, 0) = 0 and actual.version = 1 and actual.actualizado_por_email is null) then
    raise exception 'CONFLICTO: el punto % fue modificado por % (versión %)', p_punto_id, actual.actualizado_por_email, actual.version
      using errcode = 'P0001';
  end if;

  update public.registros_muestreo set
    estado                = coalesce(p_datos ->> 'estado', estado),
    borrador              = coalesce((p_datos ->> 'borrador')::boolean, borrador),
    fecha_hora_muestreo   = (p_datos ->> 'fecha_hora_muestreo')::timestamptz,
    responsable           = p_datos ->> 'responsable',
    profundidad           = p_datos ->> 'profundidad',
    humedad_suelo         = (p_datos ->> 'humedad_suelo')::numeric,
    observaciones         = p_datos ->> 'observaciones',
    fotos                 = coalesce(p_datos -> 'fotos', '[]'::jsonb),
    version               = actual.version + 1,
    actualizado_en        = now(),
    actualizado_por       = auth.uid(),
    actualizado_por_email = lower(auth.jwt() ->> 'email')
  where punto_id = p_punto_id
  returning * into resultado;
  return resultado;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------------
alter table public.usuarios_autorizados enable row level security;
alter table public.puntos_muestreo      enable row level security;
alter table public.registros_muestreo   enable row level security;
alter table public.historial_registros  enable row level security;

drop policy if exists "ver su propia autorizacion" on public.usuarios_autorizados;
create policy "ver su propia autorizacion" on public.usuarios_autorizados
  for select to authenticated using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "leer puntos" on public.puntos_muestreo;
create policy "leer puntos" on public.puntos_muestreo
  for select to authenticated using (public.es_autorizado());

drop policy if exists "leer registros" on public.registros_muestreo;
create policy "leer registros" on public.registros_muestreo
  for select to authenticated using (public.es_autorizado());
drop policy if exists "crear registros" on public.registros_muestreo;
create policy "crear registros" on public.registros_muestreo
  for insert to authenticated with check (public.es_autorizado());
drop policy if exists "actualizar registros" on public.registros_muestreo;
create policy "actualizar registros" on public.registros_muestreo
  for update to authenticated using (public.es_autorizado()) with check (public.es_autorizado());
-- Sin política de DELETE: los registros no se pueden borrar desde la aplicación.

drop policy if exists "leer historial" on public.historial_registros;
create policy "leer historial" on public.historial_registros
  for select to authenticated using (public.es_autorizado());

revoke all on public.historial_registros from anon;
revoke all on public.registros_muestreo from anon;
revoke all on public.puntos_muestreo from anon;
revoke all on public.usuarios_autorizados from anon;
grant execute on function public.guardar_registro(text, text, integer, jsonb) to authenticated;
grant execute on function public.es_autorizado() to authenticated;

-- ---------------------------------------------------------------------------
-- Fotografías: bucket privado; solo usuarios autorizados suben y ven
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-muestreo', 'fotos-muestreo', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "fotos: leer autorizados" on storage.objects;
create policy "fotos: leer autorizados" on storage.objects
  for select to authenticated using (bucket_id = 'fotos-muestreo' and public.es_autorizado());
drop policy if exists "fotos: subir autorizados" on storage.objects;
create policy "fotos: subir autorizados" on storage.objects
  for insert to authenticated with check (bucket_id = 'fotos-muestreo' and public.es_autorizado());
