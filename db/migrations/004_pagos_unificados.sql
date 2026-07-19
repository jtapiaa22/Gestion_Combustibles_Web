-- ═══════════════════════════════════════════════════════════════
--  004 — Toda la plata se registra igual
--
--  Hasta acá habia dos mecanismos para lo mismo: una venta al contado
--  guardaba UN metodo_pago en la propia venta, y un fiado guardaba
--  filas en pagos_fiado con el metodo de cada cobro.
--
--  Por eso un fiado se podia cobrar mitad en efectivo y mitad por
--  transferencia, y una venta al contado no. Y el pago partido pasa
--  seguido.
--
--  El arreglo no es agregarle un caso especial al contado: es que
--  toda la plata se registre en el mismo lugar. La tabla pasa a
--  llamarse `pagos` y recibe los cobros de cualquier venta, sea al
--  contado o fiada. Una venta al contado nace con sus pagos; una
--  fiada los va juntando.
--
--  Efecto secundario lindo: el efectivo del cajon deja de ser
--  "ventas en efectivo + fiados cobrados en efectivo" y pasa a ser
--  simplemente "los pagos en efectivo".
-- ═══════════════════════════════════════════════════════════════

drop view if exists v_clientes;
drop view if exists v_ventas;
drop view if exists v_compras;

-- ── 1. La tabla deja de ser sólo de fiados ───────────────────
alter table pagos_fiado rename to pagos;

-- Una venta al contado puede no tener cliente, y ahora tambien
-- genera pagos.
alter table pagos alter column cliente_id drop not null;

comment on table pagos is
  'Cada cobro recibido, de cualquier venta. Una venta al contado nace con sus pagos; una fiada los va juntando. Es la fuente de verdad de cuanta plata entro y por que via.';

-- ── 2. Las ventas al contado pasan sus cobros a la tabla ─────
insert into pagos (venta_id, cliente_id, monto, metodo_pago, titular_transferencia, fecha)
select v.id, v.cliente_id, v.total, v.metodo_pago, v.titular_transferencia, v.fecha
  from ventas v
 where not v.es_fiado
   and v.metodo_pago is not null;

-- Verificacion antes de tirar las columnas viejas: cada venta al
-- contado tiene que haber quedado con su pago por el total exacto.
do $$
declare descuadradas int;
begin
  select count(*) into descuadradas
    from ventas v
    left join (select venta_id, sum(monto) m from pagos group by venta_id) p on p.venta_id = v.id
   where not v.es_fiado
     and abs(coalesce(p.m, 0) - v.total) > 0.01;
  if descuadradas > 0 then
    raise exception 'Hay % ventas al contado cuyos pagos no suman el total. Abortando.', descuadradas;
  end if;
end $$;

-- ── 3. El metodo de pago sale de la venta ────────────────────
alter table ventas drop constraint if exists cobrada_necesita_metodo;
alter table ventas drop column if exists metodo_pago;
alter table ventas drop column if exists titular_transferencia;

-- ── 4. Vistas ────────────────────────────────────────────────
create view v_ventas with (security_invoker = on) as
select
  v.*,
  cl.nombre as cliente_nombre,
  co.nombre as combustible_nombre,
  coalesce(p.cobrado, 0) as cobrado,
  -- Como se cobro, para mostrar: "Efectivo", "Transferencia", o
  -- "Efectivo + Transferencia" si fue partido.
  p.metodos as metodos_pago,
  p.titulares as titulares_transferencia,
  case when v.es_fiado and v.saldado_en is null
       then greatest(0, v.total - coalesce(p.cobrado, 0))
       else 0
  end as saldo,
  case when v.es_fiado
       then v.saldado_en is not null
       else coalesce(p.cobrado, 0) >= v.total - 0.01
  end as pagado
from ventas v
left join clientes cl on cl.id = v.cliente_id
join combustibles co on co.id = v.combustible_id
left join (
  select
    venta_id,
    sum(monto) as cobrado,
    string_agg(distinct metodo_pago, ' + ' order by metodo_pago) as metodos,
    string_agg(distinct titular_transferencia, ', ') as titulares
  from pagos
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

-- ── 5. RLS sobre la tabla renombrada ─────────────────────────
alter policy acceso_autenticado_pagos_fiado on pagos rename to acceso_autenticado_pagos;
