-- ═══════════════════════════════════════════════════════════════
--  003 — Fondo de caja y arqueo al cerrar
--
--  Dos cosas que faltaban para que el cierre sirva de control real:
--
--  1. El fondo: la plata que se deja en el cajón para dar vuelto. Sin
--     eso, "tiene que haber X en el cajón" siempre daba de menos,
--     porque contaba las ventas pero no lo que ya estaba adentro.
--
--  2. El arqueo: cuánto contó de verdad al cerrar. La diferencia
--     contra lo esperado es la que dice si el turno cuadró, y es todo
--     el sentido de cerrar una caja.
--
--  efectivo_esperado se congela al cerrar junto con el resto de los
--  totales. La diferencia NO se guarda: es una resta entre dos
--  numeros que ya estan ahi.
-- ═══════════════════════════════════════════════════════════════

alter table sesiones_caja
  add column if not exists fondo_inicial     numeric(14,2) not null default 0,
  add column if not exists efectivo_esperado numeric(14,2),
  add column if not exists efectivo_contado  numeric(14,2);

alter table sesiones_caja
  add constraint fondo_no_negativo check (fondo_inicial >= 0);

alter table sesiones_caja
  add constraint contado_no_negativo check (efectivo_contado is null or efectivo_contado >= 0);

comment on column sesiones_caja.fondo_inicial is
  'Efectivo que quedó en el cajón al abrir, para dar vuelto. Suma a lo que tiene que haber al cerrar.';
comment on column sesiones_caja.efectivo_esperado is
  'Fondo + ventas en efectivo + fiados cobrados en efectivo. Congelado al cerrar.';
comment on column sesiones_caja.efectivo_contado is
  'Lo que se contó de verdad en el cajón al cerrar. Null = no se hizo arqueo.';
