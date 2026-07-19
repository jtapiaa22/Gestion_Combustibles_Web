-- ═══════════════════════════════════════════════════════════════
--  Esquema del sistema de gestión de combustibles
--
--  Diseñado a partir de los defectos encontrados en la base vieja.
--  Tres ideas rectoras:
--
--  1. Lo que se puede calcular NO se guarda. La deuda de un cliente
--     y el saldo de un fiado eran columnas que se mantenían a mano y
--     derivaron $32.400 en producción. Acá son vistas.
--  2. Un instante es un timestamptz. Nunca fecha y hora en columnas
--     separadas: así se rompió el cierre de caja.
--  3. Lo que no puede pasar, que la base no lo deje pasar. Un fiado
--     sin cliente o una venta de 0 litros son errores de datos, no
--     casos a manejar en la app.
-- ═══════════════════════════════════════════════════════════════

-- ── CLIENTES ──────────────────────────────────────────────────
create table clientes (
  id          bigint generated always as identity primary key,
  nombre      text not null check (length(trim(nombre)) > 0),
  telefono    text,
  direccion   text,
  creado_en   timestamptz not null default now()
);
create unique index clientes_nombre_unico on clientes (lower(trim(nombre)));

-- ── STOCK ─────────────────────────────────────────────────────
create table stock (
  id                    bigint generated always as identity primary key,
  tipo_combustible      text not null unique check (tipo_combustible in ('Nafta', 'Gasoil')),
  cantidad_litros       numeric(12,3) not null default 0,
  precio_por_litro      numeric(12,2) not null default 0 check (precio_por_litro >= 0),
  ultima_actualizacion  timestamptz not null default now()
);

-- ── VENTAS ────────────────────────────────────────────────────
create table ventas (
  id                     bigint generated always as identity primary key,
  fecha                  timestamptz not null default now(),
  cliente_id             bigint references clientes(id) on delete restrict,
  tipo_combustible       text not null check (tipo_combustible in ('Nafta', 'Gasoil')),
  cantidad_litros        numeric(12,3) not null check (cantidad_litros > 0),
  precio_por_litro       numeric(12,2) not null check (precio_por_litro >= 0),

  -- El total no se guarda a mano: es litros × precio, siempre.
  -- En un fiado impago el precio se actualiza si cambia el del
  -- surtidor (la deuda está en litros, no en pesos) y el total
  -- sigue solo. En una venta cobrada el precio queda congelado.
  total                  numeric(14,2) generated always as (cantidad_litros * precio_por_litro) stored,

  -- es_fiado es un hecho inmutable de la venta.
  es_fiado               boolean not null default false,
  metodo_pago            text check (metodo_pago in ('Efectivo', 'Transferencia')),
  titular_transferencia  text,

  -- Saldar es un evento con fecha, no el resultado de una cuenta.
  -- Si se dedujera del saldo, un precio mal cargado podría dar por
  -- saldado un fiado que no lo está, y al corregir el precio ya no
  -- se revaluaría: la deuda se perdería en silencio.
  saldado_en             timestamptz,

  -- Un fiado sin cliente es plata que nadie debe. Que no exista.
  constraint fiado_necesita_cliente check (not es_fiado or cliente_id is not null),
  -- Una venta cobrada tiene que decir cómo se cobró.
  constraint cobrada_necesita_metodo check (es_fiado or metodo_pago is not null),
  -- Sólo un fiado puede estar saldado.
  constraint solo_fiados_se_saldan check (saldado_en is null or es_fiado)
);
create index ventas_fecha_idx   on ventas (fecha desc);
create index ventas_cliente_idx on ventas (cliente_id) where cliente_id is not null;
create index ventas_fiados_abiertos_idx on ventas (tipo_combustible) where es_fiado and saldado_en is null;

-- ── PAGOS DE FIADO ────────────────────────────────────────────
-- Fuente de verdad de cuánto se cobró. Un fiado puede pagarse en
-- varias veces y con distinto método cada vez.
create table pagos_fiado (
  id                     bigint generated always as identity primary key,
  venta_id               bigint not null references ventas(id) on delete cascade,
  cliente_id             bigint not null references clientes(id) on delete restrict,
  monto                  numeric(14,2) not null check (monto > 0),
  metodo_pago            text not null check (metodo_pago in ('Efectivo', 'Transferencia')),
  titular_transferencia  text,
  fecha                  timestamptz not null default now()
);
create index pagos_venta_idx   on pagos_fiado (venta_id);
create index pagos_fecha_idx   on pagos_fiado (fecha desc);
create index pagos_cliente_idx on pagos_fiado (cliente_id);

-- ── COMPRAS DE STOCK ──────────────────────────────────────────
create table compras_stock (
  id                       bigint generated always as identity primary key,
  fecha                    timestamptz not null default now(),
  tipo_combustible         text not null check (tipo_combustible in ('Nafta', 'Gasoil')),
  cantidad_litros          numeric(12,3) not null check (cantidad_litros > 0),
  precio_por_litro_compra  numeric(12,2) not null check (precio_por_litro_compra >= 0),
  total_compra             numeric(14,2) generated always as (cantidad_litros * precio_por_litro_compra) stored
);
create index compras_fecha_idx on compras_stock (tipo_combustible, fecha desc);

-- ── SESIONES DE CAJA ──────────────────────────────────────────
-- Antes esto era fecha (date) + hora (text) en columnas separadas, y
-- convertir eso a un instante fue exactamente lo que la app de PC
-- hacía mal. Ahora es un timestamptz y no hay nada que convertir.
create table sesiones_caja (
  id             bigint generated always as identity primary key,
  abierta_en     timestamptz not null default now(),
  cerrada_en     timestamptz,
  notas_apertura text,
  notas_cierre   text,

  -- Totales congelados al cerrar: son el registro contable de ese
  -- turno y no deben cambiar aunque después se edite una venta.
  total_efectivo        numeric(14,2),
  total_transferencia   numeric(14,2),
  total_fiado_nuevo     numeric(14,2),
  total_fiado_cobrado   numeric(14,2),
  total_cobrado         numeric(14,2),
  litros_nafta          numeric(12,3),
  litros_gasoil         numeric(12,3),
  cantidad_ventas       integer,
  cantidad_ventas_fiado integer,
  ganancia              numeric(14,2),

  constraint cierre_posterior_a_apertura check (cerrada_en is null or cerrada_en >= abierta_en)
);
-- A lo sumo una caja abierta a la vez, garantizado por la base y no
-- por un chequeo en la app que se puede saltear.
create unique index caja_una_sola_abierta on sesiones_caja ((cerrada_en is null)) where cerrada_en is null;
create index caja_abierta_en_idx on sesiones_caja (abierta_en desc);

-- ═══════════════════════════════════════════════════════════════
--  VISTAS — lo derivado, en un solo lugar
-- ═══════════════════════════════════════════════════════════════

-- security_invoker: la vista respeta el RLS del que consulta, no el
-- del que la creó. Sin esto las vistas serían un agujero.
create view v_ventas with (security_invoker = on) as
select
  v.*,
  c.nombre as cliente_nombre,
  coalesce(p.cobrado, 0) as cobrado,
  -- Un fiado saldado no tiene saldo. Uno abierto debe lo que vale
  -- hoy menos lo ya cobrado; si el precio quedó por debajo de lo
  -- cobrado, da cero pero sigue abierto y se recupera al corregirlo.
  case when v.es_fiado and v.saldado_en is null
       then greatest(0, v.total - coalesce(p.cobrado, 0))
       else 0
  end as saldo,
  -- Pagado es un hecho, no una cuenta.
  case when v.es_fiado
       then v.saldado_en is not null
       else true
  end as pagado
from ventas v
left join clientes c on c.id = v.cliente_id
left join (
  select venta_id, sum(monto) as cobrado
  from pagos_fiado
  group by venta_id
) p on p.venta_id = v.id;

-- La deuda del cliente sale de sus fiados. No hay columna `debe` que
-- pueda desincronizarse: si no hay fiados abiertos, no debe nada.
create view v_clientes with (security_invoker = on) as
select
  c.*,
  coalesce(d.debe, 0)            as debe,
  coalesce(d.fiados_abiertos, 0) as fiados_abiertos,
  coalesce(h.total_compras, 0)   as total_compras,
  coalesce(h.total_pagado, 0)    as total_pagado
from clientes c
left join (
  select cliente_id, sum(saldo) as debe, count(*) as fiados_abiertos
  from v_ventas
  where es_fiado and not pagado
  group by cliente_id
) d on d.cliente_id = c.id
left join (
  select cliente_id, count(*) as total_compras,
         sum(case when pagado then total else 0 end) as total_pagado
  from v_ventas
  where cliente_id is not null
  group by cliente_id
) h on h.cliente_id = c.id;

-- ═══════════════════════════════════════════════════════════════
--  RLS — un solo usuario, pero la base cerrada igual
-- ═══════════════════════════════════════════════════════════════
alter table clientes      enable row level security;
alter table stock         enable row level security;
alter table ventas        enable row level security;
alter table pagos_fiado   enable row level security;
alter table compras_stock enable row level security;
alter table sesiones_caja enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clientes','stock','ventas','pagos_fiado','compras_stock','sesiones_caja']
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      'acceso_autenticado_' || t, t
    );
  end loop;
end $$;

-- ── SEMILLA ───────────────────────────────────────────────────
insert into stock (tipo_combustible, cantidad_litros, precio_por_litro)
values ('Nafta', 0, 0), ('Gasoil', 0, 0);
