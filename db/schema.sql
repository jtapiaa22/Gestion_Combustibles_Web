-- ═══════════════════════════════════════════════════════════════
--  Esquema del sistema de gestión de combustibles
--
--  Este archivo es el estado ACTUAL completo, para instalar de cero.
--  Una base ya creada se actualiza con los archivos de migrations/.
--
--  Diseñado a partir de los defectos encontrados en la base vieja.
--  Cuatro ideas rectoras:
--
--  1. Lo que se puede calcular NO se guarda. La deuda de un cliente y
--     el saldo de un fiado eran columnas mantenidas a mano y
--     derivaron $32.400 en producción. Acá son vistas.
--  2. Pero los eventos SÍ se registran. Que alguien haya terminado de
--     pagar es un hecho con fecha, no una suma: ver saldado_en.
--  3. Un instante es un timestamptz. Nunca fecha y hora en columnas
--     separadas: así se rompió el cierre de caja.
--  4. Lo que no puede pasar, que la base no lo deje pasar. Un fiado
--     sin cliente o una venta de 0 litros son errores de datos, no
--     casos a manejar en la app.
-- ═══════════════════════════════════════════════════════════════

-- ── CLIENTES ──────────────────────────────────────────────────
create table clientes (
  id         bigint generated always as identity primary key,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  direccion  text,
  creado_en  timestamptz not null default now()
);
create unique index clientes_nombre_unico on clientes (lower(trim(nombre)));

-- ── COMBUSTIBLES ──────────────────────────────────────────────
-- Catálogo de lo que se vende Y estado del tanque de cada uno.
-- Agregar "Nafta Premium YPF" es una fila más: no hay nada
-- hardcodeado. Desactivar uno lo saca de la lista de venta sin tocar
-- las ventas viejas, que lo siguen referenciando.
create table combustibles (
  id                    bigint generated always as identity primary key,
  nombre                text not null check (length(trim(nombre)) > 0),
  cantidad_litros       numeric(12,3) not null default 0,
  precio_por_litro      numeric(12,2) not null default 0 check (precio_por_litro >= 0),
  activo                boolean not null default true,
  orden                 integer not null default 0,
  ultima_actualizacion  timestamptz not null default now(),
  creado_en             timestamptz not null default now()
);
create unique index combustibles_nombre_unico on combustibles (lower(trim(nombre)));
create index combustibles_activos_idx on combustibles (orden, nombre) where activo;

-- ── VENTAS ────────────────────────────────────────────────────
create table ventas (
  id                     bigint generated always as identity primary key,
  fecha                  timestamptz not null default now(),
  cliente_id             bigint references clientes(id) on delete restrict,
  combustible_id         bigint not null references combustibles(id) on delete restrict,
  cantidad_litros        numeric(12,3) not null check (cantidad_litros > 0),
  precio_por_litro       numeric(12,2) not null check (precio_por_litro >= 0),

  -- El total no se guarda a mano: es litros × precio, siempre. En un
  -- fiado impago el precio se actualiza si cambia el del surtidor (la
  -- deuda está en litros, no en pesos) y el total sigue solo. En una
  -- venta ya cobrada el precio queda congelado.
  total                  numeric(14,2) generated always as (cantidad_litros * precio_por_litro) stored,

  es_fiado               boolean not null default false,
  metodo_pago            text check (metodo_pago in ('Efectivo', 'Transferencia')),
  titular_transferencia  text,

  -- Saldar es un evento con fecha, no el resultado de una cuenta. Si
  -- se dedujera del saldo, un precio mal cargado podría dar por
  -- saldado un fiado que no lo está, y al corregir el precio ya no se
  -- revaluaría: la deuda se perdería en silencio.
  saldado_en             timestamptz,

  constraint fiado_necesita_cliente check (not es_fiado or cliente_id is not null),
  constraint cobrada_necesita_metodo check (es_fiado or metodo_pago is not null),
  constraint solo_fiados_se_saldan  check (saldado_en is null or es_fiado)
);
create index ventas_fecha_idx       on ventas (fecha desc);
create index ventas_cliente_idx     on ventas (cliente_id) where cliente_id is not null;
create index ventas_combustible_idx on ventas (combustible_id);
create index ventas_fiados_abiertos_idx on ventas (combustible_id) where es_fiado and saldado_en is null;

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

-- ── COMPRAS ───────────────────────────────────────────────────
create table compras_stock (
  id                       bigint generated always as identity primary key,
  fecha                    timestamptz not null default now(),
  combustible_id           bigint not null references combustibles(id) on delete restrict,
  cantidad_litros          numeric(12,3) not null check (cantidad_litros > 0),
  precio_por_litro_compra  numeric(12,2) not null check (precio_por_litro_compra >= 0),
  total_compra             numeric(14,2) generated always as (cantidad_litros * precio_por_litro_compra) stored
);
create index compras_fecha_idx on compras_stock (combustible_id, fecha desc);

-- ── SESIONES DE CAJA ──────────────────────────────────────────
-- Antes los límites eran fecha (date) + hora (text) por separado, y
-- convertir ese par a un instante fue lo que la app de PC hacía mal.
create table sesiones_caja (
  id             bigint generated always as identity primary key,
  abierta_en     timestamptz not null default now(),
  cerrada_en     timestamptz,
  notas_apertura text,
  notas_cierre   text,

  -- Totales congelados al cerrar: son el registro contable de ese
  -- turno y no cambian aunque después se edite una venta.
  total_efectivo         numeric(14,2),
  total_transferencia    numeric(14,2),
  total_fiado_nuevo      numeric(14,2),
  total_fiado_cobrado    numeric(14,2),
  total_cobrado          numeric(14,2),
  -- Desglose por combustible. Es una foto del turno, no algo que se
  -- consulte relacionalmente, y así funciona con dos o con seis.
  litros_por_combustible jsonb,
  cantidad_ventas        integer,
  cantidad_ventas_fiado  integer,
  ganancia               numeric(14,2),

  constraint cierre_posterior_a_apertura check (cerrada_en is null or cerrada_en >= abierta_en)
);
-- A lo sumo una caja abierta, garantizado por la base y no por un if
-- de la app que se puede saltear.
create unique index caja_una_sola_abierta on sesiones_caja ((cerrada_en is null)) where cerrada_en is null;
create index caja_abierta_en_idx on sesiones_caja (abierta_en desc);

-- ═══════════════════════════════════════════════════════════════
--  VISTAS — lo derivado, en un solo lugar
--
--  security_invoker: la vista respeta el RLS del que consulta, no el
--  del que la creó. Sin esto las vistas serían un agujero.
-- ═══════════════════════════════════════════════════════════════

create view v_ventas with (security_invoker = on) as
select
  v.*,
  cl.nombre as cliente_nombre,
  co.nombre as combustible_nombre,
  coalesce(p.cobrado, 0) as cobrado,
  -- Un fiado saldado no tiene saldo. Uno abierto debe lo que vale hoy
  -- menos lo ya cobrado; si el precio quedó por debajo de lo cobrado,
  -- da cero pero sigue abierto y se recupera al corregirlo.
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
left join clientes cl on cl.id = v.cliente_id
join combustibles co on co.id = v.combustible_id
left join (
  select venta_id, sum(monto) as cobrado
  from pagos_fiado
  group by venta_id
) p on p.venta_id = v.id;

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

create view v_compras with (security_invoker = on) as
select cs.*, co.nombre as combustible_nombre
from compras_stock cs
join combustibles co on co.id = cs.combustible_id;

-- ═══════════════════════════════════════════════════════════════
--  RLS — un solo usuario, pero la base cerrada igual
-- ═══════════════════════════════════════════════════════════════
alter table clientes      enable row level security;
alter table combustibles  enable row level security;
alter table ventas        enable row level security;
alter table pagos_fiado   enable row level security;
alter table compras_stock enable row level security;
alter table sesiones_caja enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clientes','combustibles','ventas','pagos_fiado','compras_stock','sesiones_caja']
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      'acceso_autenticado_' || t, t
    );
  end loop;
end $$;

-- ── SEMILLA ───────────────────────────────────────────────────
insert into combustibles (nombre, orden) values ('Nafta', 1), ('Gasoil', 2);
