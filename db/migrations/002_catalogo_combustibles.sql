-- ═══════════════════════════════════════════════════════════════
--  002 — Los combustibles pasan a ser datos, no constantes
--
--  Hasta acá "Nafta" y "Gasoil" estaban clavados como restricción en
--  tres tablas y en el código. Para vender Común y Premium, y más
--  adelante distinguir Premium de YPF de la de Axion, la lista tiene
--  que poder editarse desde la app.
--
--  La tabla `stock` ya era una fila por combustible con su cantidad y
--  su precio: o sea, ya era el catálogo sin saberlo. Se renombra a
--  `combustibles`, se le agrega nombre libre, activo y orden, y
--  `ventas` y `compras_stock` pasan a apuntarle por id.
--
--  Efectos: agregar un combustible es un INSERT; renombrarlo no rompe
--  el historial (las ventas apuntan al id, no al texto); y
--  desactivarlo lo saca de la lista de venta sin tocar lo ya vendido.
-- ═══════════════════════════════════════════════════════════════

drop view if exists v_clientes;
drop view if exists v_ventas;

-- ── 1. stock pasa a ser el catálogo ──────────────────────────
alter table stock rename to combustibles;
alter table combustibles rename column tipo_combustible to nombre;

alter table combustibles drop constraint if exists stock_tipo_combustible_check;
alter table combustibles drop constraint if exists stock_tipo_combustible_key;

alter table combustibles
  add column if not exists activo boolean not null default true,
  add column if not exists orden  integer not null default 0,
  add column if not exists creado_en timestamptz not null default now();

alter table combustibles
  add constraint nombre_no_vacio check (length(trim(nombre)) > 0);

-- Mismo criterio que clientes: "Nafta Premium" y "nafta premium " son
-- el mismo combustible.
create unique index combustibles_nombre_unico on combustibles (lower(trim(nombre)));
create index combustibles_activos_idx on combustibles (orden, nombre) where activo;

update combustibles set orden = case nombre when 'Nafta' then 1 when 'Gasoil' then 2 else 3 end;

-- ── 2. ventas apunta al catálogo ─────────────────────────────
alter table ventas add column combustible_id bigint references combustibles(id) on delete restrict;

update ventas v
   set combustible_id = c.id
  from combustibles c
 where c.nombre = v.tipo_combustible;

-- Si algo quedó sin mapear, frenamos acá antes de romper nada.
do $$
declare huerfanas int;
begin
  select count(*) into huerfanas from ventas where combustible_id is null;
  if huerfanas > 0 then
    raise exception 'Hay % ventas sin combustible mapeado. Abortando.', huerfanas;
  end if;
end $$;

alter table ventas alter column combustible_id set not null;
alter table ventas drop constraint if exists ventas_tipo_combustible_check;
drop index if exists ventas_fiados_abiertos_idx;
alter table ventas drop column tipo_combustible;

create index ventas_fiados_abiertos_idx
  on ventas (combustible_id) where es_fiado and saldado_en is null;
create index ventas_combustible_idx on ventas (combustible_id);

-- ── 3. compras_stock apunta al catálogo ──────────────────────
alter table compras_stock add column combustible_id bigint references combustibles(id) on delete restrict;

update compras_stock cs
   set combustible_id = c.id
  from combustibles c
 where c.nombre = cs.tipo_combustible;

do $$
declare huerfanas int;
begin
  select count(*) into huerfanas from compras_stock where combustible_id is null;
  if huerfanas > 0 then
    raise exception 'Hay % compras sin combustible mapeado. Abortando.', huerfanas;
  end if;
end $$;

alter table compras_stock alter column combustible_id set not null;
alter table compras_stock drop constraint if exists compras_stock_tipo_combustible_check;
drop index if exists compras_fecha_idx;
alter table compras_stock drop column tipo_combustible;

create index compras_fecha_idx on compras_stock (combustible_id, fecha desc);

-- ── 4. La caja deja de tener dos combustibles clavados ───────
-- litros_nafta y litros_gasoil no generalizan a N combustibles. El
-- desglose pasa a un jsonb: es una foto congelada del turno, no algo
-- que se consulte relacionalmente.
alter table sesiones_caja drop column if exists litros_nafta;
alter table sesiones_caja drop column if exists litros_gasoil;
alter table sesiones_caja add column if not exists litros_por_combustible jsonb;

-- ── 5. Vistas ────────────────────────────────────────────────
create view v_ventas with (security_invoker = on) as
select
  v.*,
  cl.nombre as cliente_nombre,
  co.nombre as combustible_nombre,
  coalesce(p.cobrado, 0) as cobrado,
  case when v.es_fiado and v.saldado_en is null
       then greatest(0, v.total - coalesce(p.cobrado, 0))
       else 0
  end as saldo,
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

-- ── 6. RLS sobre la tabla renombrada ─────────────────────────
alter policy acceso_autenticado_stock on combustibles rename to acceso_autenticado_combustibles;
