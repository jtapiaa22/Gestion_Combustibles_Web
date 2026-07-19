// ═══════════════════════════════════════════════════════════════
//  smoke.mjs — Prueba de punta a punta de la capa de datos contra
//  la base nueva. Crea datos de prueba y los borra al terminar.
//
//  Seguro de correr AHORA porque la base nueva todavía es un ensayo:
//  se va a vaciar y recargar el día del cambio. No correr contra una
//  base en uso real.
//
//  Uso: node db/smoke.mjs
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

// Cargar .env antes de importar nada que use el cliente
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
Object.assign(process.env, env);

const { supabase } = await import('../src/lib/supabase.js');
const { stockAPI, clientesAPI, ventasAPI, cajaAPI } = await import('../src/lib/api.js');

let ok = 0, fallos = 0;
const cerca = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const check = (nombre, condicion, detalle = '') => {
  if (condicion) { console.log(`  ✓ ${nombre}`); ok++; }
  else { console.log(`  ✗ ${nombre}${detalle ? `\n     ${detalle}` : ''}`); fallos++; }
};

const limpiar = [];

try {
  console.log('\nSmoke test — capa de datos contra la base nueva\n');

  const { error } = await supabase.auth.signInWithPassword({
    email: env.IMPORT_EMAIL, password: env.IMPORT_PASSWORD,
  });
  if (error) throw new Error(`login: ${error.message}`);
  console.log('  · autenticado\n');

  // ── Estado inicial ────────────────────────────────────────
  const stock0 = await stockAPI.obtenerTodo();
  const nafta0 = stock0.find((s) => s.tipo_combustible === 'Nafta');
  const clientes0 = await clientesAPI.obtenerTodos();
  const deuda0 = clientes0.reduce((s, c) => s + c.debe, 0);
  console.log(`  estado inicial: nafta ${nafta0.cantidad_litros} L @ $${nafta0.precio_por_litro} · deuda $${deuda0.toLocaleString('es-AR')}\n`);

  // ── Cliente de prueba ─────────────────────────────────────
  console.log('clientes');
  const cli = await clientesAPI.agregar('ZZ Prueba Smoke', '123', 'calle falsa');
  limpiar.push(() => supabase.from('clientes').delete().eq('id', cli.id));
  check('se crea un cliente', !!cli.id);

  let dup = null;
  try { await clientesAPI.agregar('zz prueba smoke  '); } catch (e) { dup = e.message; }
  check('rechaza nombre duplicado sin importar mayúsculas ni espacios', !!dup, dup || 'no lanzó error');

  // ── Venta al contado ──────────────────────────────────────
  console.log('\nventa al contado');
  const contado = await ventasAPI.registrar({
    tipoCombustible: 'Nafta', cantidadLitros: 10, precioPorLitro: 100,
    esFiado: false, metodoPago: 'Efectivo',
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', contado.id));
  check('total generado = litros × precio', cerca(contado.total, 1000), `total=${contado.total}`);

  const vContado = await ventasAPI.obtenerUna(contado.id);
  check('queda marcada como pagada', vContado.pagado === true);
  check('saldo cero', cerca(vContado.saldo, 0));

  const stock1 = await stockAPI.obtenerTodo();
  check('descuenta del stock', cerca(stock1.find((s) => s.tipo_combustible === 'Nafta').cantidad_litros, nafta0.cantidad_litros - 10));

  let sinMetodo = null;
  try {
    await ventasAPI.registrar({ tipoCombustible: 'Nafta', cantidadLitros: 1, precioPorLitro: 100, esFiado: false });
  } catch (e) { sinMetodo = e.message; }
  check('rechaza venta al contado sin método de pago', !!sinMetodo);

  // ── Fiado y cobros ────────────────────────────────────────
  console.log('\nfiado');
  const fiado = await ventasAPI.registrar({
    clienteId: cli.id, tipoCombustible: 'Nafta', cantidadLitros: 20, precioPorLitro: 100, esFiado: true,
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', fiado.id));
  check('el fiado vale litros × precio', cerca(fiado.total, 2000));

  let sinCliente = null;
  try {
    await ventasAPI.registrar({ tipoCombustible: 'Nafta', cantidadLitros: 1, precioPorLitro: 100, esFiado: true });
  } catch (e) { sinCliente = e.message; }
  check('rechaza fiado sin cliente', !!sinCliente);

  const conDeuda = (await clientesAPI.obtenerTodos()).find((c) => c.id === cli.id);
  check('la deuda del cliente aparece derivada', cerca(conDeuda.debe, 2000), `debe=${conDeuda.debe}`);

  await ventasAPI.registrarPago(fiado.id, 500, 'Efectivo');
  const tras500 = await ventasAPI.obtenerUna(fiado.id);
  check('pago parcial deja saldo correcto', cerca(tras500.saldo, 1500), `saldo=${tras500.saldo}`);
  check('sigue impaga', tras500.pagado === false);
  check('registra lo cobrado', cerca(tras500.cobrado, 500));

  let excede = null;
  try { await ventasAPI.registrarPago(fiado.id, 99999, 'Efectivo'); } catch (e) { excede = e.message; }
  check('rechaza cobrar más que el saldo', !!excede, excede || 'no lanzó error');

  // ── Revaluación por cambio de precio ──────────────────────
  console.log('\ncambio de precio');
  await stockAPI.actualizarPrecio('Nafta', 200);
  const revaluado = await ventasAPI.obtenerUna(fiado.id);
  check('el fiado se revalúa al precio nuevo', cerca(revaluado.total, 4000), `total=${revaluado.total}`);
  check('el saldo descuenta lo ya cobrado', cerca(revaluado.saldo, 3500), `saldo=${revaluado.saldo}`);

  const contadoTrasPrecio = await ventasAPI.obtenerUna(contado.id);
  check('la venta ya cobrada NO se revalúa', cerca(contadoTrasPrecio.total, 1000), `total=${contadoTrasPrecio.total}`);

  // ── El caso del precio mal tipeado ────────────────────────
  // Un precio absurdamente bajo hace que lo ya cobrado supere el
  // total. Antes eso daba el fiado por saldado, y al corregir el
  // precio la deuda no volvía nunca más: se perdía en silencio.
  console.log('\nprecio mal tipeado (el caso que perdía plata)');
  await stockAPI.actualizarPrecio('Nafta', 10);
  const conTypo = await ventasAPI.obtenerUna(fiado.id);
  check('con el precio mal cargado el saldo da cero', cerca(conTypo.saldo, 0), `saldo=${conTypo.saldo}`);
  check('pero el fiado NO queda saldado', conTypo.pagado === false);

  await stockAPI.actualizarPrecio('Nafta', 100);
  const corregido = await ventasAPI.obtenerUna(fiado.id);
  check('al corregir el precio la deuda vuelve sola', cerca(corregido.saldo, 1500), `saldo=${corregido.saldo}`);

  // ── Saldar ────────────────────────────────────────────────
  console.log('\nsaldar deuda');
  await ventasAPI.saldarVenta(fiado.id, 'Transferencia', 'Juan');
  const saldado = await ventasAPI.obtenerUna(fiado.id);
  check('queda saldada', saldado.pagado === true);
  check('saldo en cero', cerca(saldado.saldo, 0));
  check('queda registrado cuándo se saldó', !!saldado.saldado_en);

  const sinDeuda = (await clientesAPI.obtenerTodos()).find((c) => c.id === cli.id);
  check('el cliente deja de deber', cerca(sinDeuda.debe, 0), `debe=${sinDeuda.debe}`);

  // Lo inverso del caso anterior: una vez saldado, el fiado queda
  // cerrado y no revive aunque el precio suba.
  await stockAPI.actualizarPrecio('Nafta', 500);
  const saldadoTrasSubida = await ventasAPI.obtenerUna(fiado.id);
  check('un fiado saldado no revive al subir el precio', saldadoTrasSubida.pagado === true && cerca(saldadoTrasSubida.saldo, 0));
  await stockAPI.actualizarPrecio('Nafta', nafta0.precio_por_litro);

  // ── Editar y borrar ───────────────────────────────────────
  console.log('\neditar y borrar');
  await ventasAPI.editar(contado.id, {
    tipoCombustible: 'Nafta', cantidadLitros: 5, precioPorLitro: 100,
    esFiado: false, metodoPago: 'Efectivo',
  });
  const stockTrasEditar = await stockAPI.obtenerTodo();
  check('editar devuelve litros al tanque',
    cerca(stockTrasEditar.find((s) => s.tipo_combustible === 'Nafta').cantidad_litros, nafta0.cantidad_litros - 5 - 20),
    `nafta=${stockTrasEditar.find((s) => s.tipo_combustible === 'Nafta').cantidad_litros}`);

  await ventasAPI.eliminar(contado.id);
  await ventasAPI.eliminar(fiado.id);
  const stockFinal = await stockAPI.obtenerTodo();
  check('borrar devuelve todo el stock',
    cerca(stockFinal.find((s) => s.tipo_combustible === 'Nafta').cantidad_litros, nafta0.cantidad_litros),
    `nafta=${stockFinal.find((s) => s.tipo_combustible === 'Nafta').cantidad_litros} esperado=${nafta0.cantidad_litros}`);

  const pagosHuerfanos = await ventasAPI.obtenerPagosFiado(fiado.id);
  check('los pagos se borran en cascada', pagosHuerfanos.length === 0);

  // ── Caja ──────────────────────────────────────────────────
  console.log('\ncaja');
  const abierta0 = await cajaAPI.obtenerCajaAbierta();
  if (abierta0) {
    check('ya había una caja abierta (se deja como estaba)', true);
  } else {
    const caja = await cajaAPI.abrirCaja('smoke test');
    limpiar.push(() => supabase.from('sesiones_caja').delete().eq('id', caja.id));
    check('abre caja', !!caja.id);

    let dobleCaja = null;
    try { await cajaAPI.abrirCaja('otra'); } catch (e) { dobleCaja = e.message; }
    check('impide dos cajas abiertas a la vez', !!dobleCaja, dobleCaja || 'no lanzó error');

    const resumen = await cajaAPI.obtenerResumen(caja.id);
    check('calcula el resumen', resumen && typeof resumen.totalCobrado === 'number');

    await cajaAPI.cerrarCaja(caja.id, 'fin smoke');
    const trasCierre = await cajaAPI.obtenerCajaAbierta();
    check('al cerrar no queda ninguna abierta', trasCierre === null);
  }

  // ── Estado final ──────────────────────────────────────────
  console.log('\nestado final');
  const clientesFin = await clientesAPI.obtenerTodos();
  const deudaFin = clientesFin.filter((c) => c.id !== cli.id).reduce((s, c) => s + c.debe, 0);
  check('la deuda real quedó igual que al empezar', cerca(deudaFin, deuda0, 1), `antes=${deuda0} después=${deudaFin}`);
} catch (e) {
  console.log(`\n  ✗ error: ${e.message}`);
  fallos++;
} finally {
  for (const f of limpiar.reverse()) { try { await f(); } catch {} }
  console.log(`\n${ok} ok, ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
}
