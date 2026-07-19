-- ═══════════════════════════════════════════════════════════════
--  001 — Saldar un fiado pasa a ser un hecho registrado
--
--  Antes "pagado" se deducía de una cuenta: ¿lo cobrado alcanza para
--  cubrir lo que vale? El problema es que lo que vale depende del
--  precio de HOY, así que un precio mal cargado podía dar por saldado
--  un fiado que no lo estaba.
--
--  El caso concreto: un fiado de 5 L con $10.900 ya cobrados. A
--  $2.800/L vale $14.000 y quedan $3.100 por cobrar. Si alguien tipea
--  $280 en vez de $2.800, pasa a valer $1.400, lo cobrado lo supera y
--  el fiado queda "saldado". Al corregir el precio ya no se revalúa,
--  porque la revaluación sólo toca fiados impagos. Los $3.100 se
--  pierden sin ningún aviso.
--
--  Con saldado_en, saldar deja de ser un accidente aritmético y pasa
--  a ser un evento con fecha. La revaluación apunta a los fiados sin
--  fecha de saldado, así que corregir el precio devuelve la deuda a
--  su lugar.
--
--  Puramente aditiva: los fiados abiertos arrancan con saldado_en en
--  null, que es exactamente lo que corresponde. No hay backfill.
-- ═══════════════════════════════════════════════════════════════

-- Las vistas se recrean porque cambia la lista de columnas de
-- v_ventas (create or replace exige la misma forma).
drop view if exists v_clientes;
drop view if exists v_ventas;

alter table ventas
  add column if not exists saldado_en timestamptz;

comment on column ventas.saldado_en is
  'Momento en que un pago terminó de cubrir este fiado. Null = sigue abierto. '
  'No se deduce del saldo: lo escribe el registro del pago que lo salda.';

-- Un fiado no puede tener fecha de saldado si no es fiado.
alter table ventas
  add constraint solo_fiados_se_saldan
  check (saldado_en is null or es_fiado);

create index ventas_fiados_abiertos_idx
  on ventas (tipo_combustible)
  where es_fiado and saldado_en is null;

-- ── Vistas ────────────────────────────────────────────────────
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
