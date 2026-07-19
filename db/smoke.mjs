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
const { combustiblesAPI, clientesAPI, ventasAPI, cajaAPI } = await import('../src/lib/api.js');

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
  const combustibles0 = await combustiblesAPI.obtenerTodos();
  const nafta0 = combustibles0.find((c) => c.nombre === 'Nafta');
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
    combustibleId: nafta0.id, cantidadLitros: 10, precioPorLitro: 100,
    esFiado: false, metodoPago: 'Efectivo',
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', contado.id));
  check('total generado = litros × precio', cerca(contado.total, 1000), `total=${contado.total}`);

  const vContado = await ventasAPI.obtenerUna(contado.id);
  check('queda marcada como pagada', vContado.pagado === true);
  check('saldo cero', cerca(vContado.saldo, 0));

  const stock1 = await combustiblesAPI.obtenerTodos();
  check('descuenta del stock', cerca(stock1.find((c) => c.nombre === 'Nafta').cantidad_litros, nafta0.cantidad_litros - 10));

  let sinMetodo = null;
  try {
    await ventasAPI.registrar({ combustibleId: nafta0.id, cantidadLitros: 1, precioPorLitro: 100, esFiado: false });
  } catch (e) { sinMetodo = e.message; }
  check('rechaza venta al contado sin método de pago', !!sinMetodo);

  // ── Fiado y cobros ────────────────────────────────────────
  console.log('\nfiado');
  const fiado = await ventasAPI.registrar({
    clienteId: cli.id, combustibleId: nafta0.id, cantidadLitros: 20, precioPorLitro: 100, esFiado: true,
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', fiado.id));
  check('el fiado vale litros × precio', cerca(fiado.total, 2000));

  let sinCliente = null;
  try {
    await ventasAPI.registrar({ combustibleId: nafta0.id, cantidadLitros: 1, precioPorLitro: 100, esFiado: true });
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
  await combustiblesAPI.actualizarPrecio(nafta0.id, 200);
  const revaluado = await ventasAPI.obtenerUna(fiado.id);
  check('el fiado se revalúa al precio nuevo', cerca(revaluado.total, 4000), `total=${revaluado.total}`);
  check('el saldo descuenta lo ya cobrado', cerca(revaluado.saldo, 3500), `saldo=${revaluado.saldo}`);

  const contadoTrasPrecio = await ventasAPI.obtenerUna(contado.id);
  check('la venta ya cobrada NO se revalúa', cerca(contadoTrasPrecio.total, 1000), `total=${contadoTrasPrecio.total}`);

  // La simulación tiene que anticipar exactamente lo que después pasa
  const sim = await combustiblesAPI.simularCambioPrecio(nafta0.id, 300);
  const simCli = sim.afectados.find((a) => a.clienteId === cli.id);
  check('la simulación anticipa la deuda del cliente',
    simCli && cerca(simCli.antes, 3500) && cerca(simCli.despues, 5500),
    simCli ? `antes=${simCli.antes} después=${simCli.despues}` : 'no aparece en la simulación');
  check('la simulación no escribe nada',
    cerca((await ventasAPI.obtenerUna(fiado.id)).saldo, 3500));

  // ── El caso del precio mal tipeado ────────────────────────
  // Un precio absurdamente bajo hace que lo ya cobrado supere el
  // total. Antes eso daba el fiado por saldado, y al corregir el
  // precio la deuda no volvía nunca más: se perdía en silencio.
  console.log('\nprecio mal tipeado (el caso que perdía plata)');
  await combustiblesAPI.actualizarPrecio(nafta0.id, 10);
  const conTypo = await ventasAPI.obtenerUna(fiado.id);
  check('con el precio mal cargado el saldo da cero', cerca(conTypo.saldo, 0), `saldo=${conTypo.saldo}`);
  check('pero el fiado NO queda saldado', conTypo.pagado === false);

  await combustiblesAPI.actualizarPrecio(nafta0.id, 100);
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
  await combustiblesAPI.actualizarPrecio(nafta0.id, 500);
  const saldadoTrasSubida = await ventasAPI.obtenerUna(fiado.id);
  check('un fiado saldado no revive al subir el precio', saldadoTrasSubida.pagado === true && cerca(saldadoTrasSubida.saldo, 0));
  await combustiblesAPI.actualizarPrecio(nafta0.id, nafta0.precio_por_litro);

  // ── Editar y borrar ───────────────────────────────────────
  console.log('\neditar y borrar');
  await ventasAPI.editar(contado.id, {
    combustibleId: nafta0.id, cantidadLitros: 5, precioPorLitro: 100,
    esFiado: false, metodoPago: 'Efectivo',
  });
  const stockTrasEditar = await combustiblesAPI.obtenerTodos();
  check('editar devuelve litros al tanque',
    cerca(stockTrasEditar.find((c) => c.nombre === 'Nafta').cantidad_litros, nafta0.cantidad_litros - 5 - 20),
    `nafta=${stockTrasEditar.find((c) => c.nombre === 'Nafta').cantidad_litros}`);

  await ventasAPI.eliminar(contado.id);
  await ventasAPI.eliminar(fiado.id);
  const stockFinal = await combustiblesAPI.obtenerTodos();
  check('borrar devuelve todo el stock',
    cerca(stockFinal.find((c) => c.nombre === 'Nafta').cantidad_litros, nafta0.cantidad_litros),
    `nafta=${stockFinal.find((c) => c.nombre === 'Nafta').cantidad_litros} esperado=${nafta0.cantidad_litros}`);

  const pagosHuerfanos = await ventasAPI.obtenerPagosFiado(fiado.id);
  check('los pagos se borran en cascada', pagosHuerfanos.length === 0);

  // ── Caja ──────────────────────────────────────────────────
  // Un turno completo de punta a punta. Es donde el sistema viejo
  // estaba roto: la app de PC calculaba la ventana con offset y las
  // ventas se guardaban sin él, así que los cierres daban cualquier
  // cosa. Acá se verifica que la ventana agarre lo que tiene que
  // agarrar y que las cuentas cierren.
  console.log('\ncaja');
  const yaAbierta = await cajaAPI.obtenerCajaAbierta();
  if (yaAbierta) {
    check('había una caja abierta: se saltea el test para no tocarla', true);
  } else {
    const caja = await cajaAPI.abrirCaja('smoke test');
    limpiar.push(() => supabase.from('sesiones_caja').delete().eq('id', caja.id));
    check('abre caja', !!caja.id);

    let dobleCaja = null;
    try { await cajaAPI.abrirCaja('otra'); } catch (e) { dobleCaja = e.message; }
    check('impide dos cajas abiertas a la vez', !!dobleCaja, dobleCaja || 'no lanzó error');

    // Un turno: efectivo, transferencia, un fiado, y un cobro parcial
    // de ese fiado en efectivo.
    const vEfectivo = await ventasAPI.registrar({
      combustibleId: nafta0.id, cantidadLitros: 3, precioPorLitro: 1000,
      esFiado: false, metodoPago: 'Efectivo',
    });
    const vTransf = await ventasAPI.registrar({
      combustibleId: nafta0.id, cantidadLitros: 2, precioPorLitro: 1000,
      esFiado: false, metodoPago: 'Transferencia',
    });
    const vFiado = await ventasAPI.registrar({
      clienteId: cli.id, combustibleId: nafta0.id, cantidadLitros: 10, precioPorLitro: 1000, esFiado: true,
    });
    for (const v of [vEfectivo, vTransf, vFiado]) {
      limpiar.push(() => supabase.from('ventas').delete().eq('id', v.id));
    }
    await ventasAPI.registrarPago(vFiado.id, 4000, 'Efectivo');

    const r = await cajaAPI.obtenerResumen(caja.id);
    check('la ventana agarra las 3 ventas del turno', r.cantidadVentas === 3, `cantidadVentas=${r.cantidadVentas}`);
    check('separa efectivo de transferencia',
      cerca(r.totalEfectivo, 3000) && cerca(r.totalTransferencia, 2000),
      `efectivo=${r.totalEfectivo} transf=${r.totalTransferencia}`);
    check('cuenta lo fiado aparte de lo cobrado', cerca(r.totalFiadoNuevo, 10000), `fiadoNuevo=${r.totalFiadoNuevo}`);
    check('registra el cobro de fiado del turno', cerca(r.totalFiadoCobrado, 4000), `fiadoCobrado=${r.totalFiadoCobrado}`);

    // Lo que de verdad importa al cerrar: cuánta plata hay en el cajón
    check('el efectivo en caja suma ventas + fiados cobrados en efectivo',
      cerca(r.efectivoEnCaja, 7000), `efectivoEnCaja=${r.efectivoEnCaja} (esperado 3000+4000)`);
    check('un fiado no cobrado NO cuenta como plata en el cajón',
      !cerca(r.efectivoEnCaja, 17000));

    check('desglosa los litros por combustible',
      cerca(r.litrosPorCombustible['Nafta'] || 0, 15), `litros=${JSON.stringify(r.litrosPorCombustible)}`);

    const cerrado = await cajaAPI.cerrarCaja(caja.id, 'fin smoke');
    check('al cerrar no queda ninguna abierta', (await cajaAPI.obtenerCajaAbierta()) === null);

    // Los totales quedan congelados en la fila, no se recalculan
    const guardada = (await cajaAPI.obtenerHistorial()).find((s) => s.id === caja.id);
    check('guarda los totales del cierre',
      cerca(Number(guardada.total_efectivo), 3000) && cerca(Number(guardada.total_cobrado), 5000),
      `efectivo=${guardada.total_efectivo} cobrado=${guardada.total_cobrado}`);
    check('guarda el desglose por combustible',
      cerca(Number(guardada.litros_por_combustible?.Nafta || 0), 15),
      `jsonb=${JSON.stringify(guardada.litros_por_combustible)}`);

    // Borrar una venta después del cierre no debe mover el registro
    await ventasAPI.eliminar(vEfectivo.id);
    const trasBorrar = (await cajaAPI.obtenerHistorial()).find((s) => s.id === caja.id);
    check('el cierre no cambia si después se borra una venta',
      cerca(Number(trasBorrar.total_efectivo), 3000), `efectivo=${trasBorrar.total_efectivo}`);

    await ventasAPI.eliminar(vTransf.id);
    await ventasAPI.eliminar(vFiado.id);
  }

  // ── Catálogo de combustibles ──────────────────────────────
  // El motivo del rediseño: poder vender Premium sin tocar el código.
  console.log('\ncatálogo de combustibles');
  const premium = await combustiblesAPI.crear({
    nombre: 'ZZ Premium Prueba', precioPorLitro: 3500, cantidadLitros: 50, orden: 99,
  });
  limpiar.push(() => supabase.from('combustibles').delete().eq('id', premium.id));
  check('se puede agregar un combustible nuevo', !!premium.id);

  let dupComb = null;
  try { await combustiblesAPI.crear({ nombre: '  zz premium prueba' }); } catch (e) { dupComb = e.message; }
  check('rechaza un combustible con nombre repetido', !!dupComb, dupComb || 'no lanzó error');

  const ventaPremium = await ventasAPI.registrar({
    combustibleId: premium.id, cantidadLitros: 4, precioPorLitro: 3500,
    esFiado: false, metodoPago: 'Efectivo',
  });
  limpiar.push(() => supabase.from('ventas').delete().eq('id', ventaPremium.id));
  check('se le puede vender', cerca(ventaPremium.total, 14000), `total=${ventaPremium.total}`);

  const vPremium = await ventasAPI.obtenerUna(ventaPremium.id);
  check('la venta trae el nombre del combustible', vPremium.combustible_nombre === 'ZZ Premium Prueba', `nombre=${vPremium.combustible_nombre}`);

  const trasVenta = (await combustiblesAPI.obtenerTodos()).find((c) => c.id === premium.id);
  check('descuenta de su propio tanque', cerca(trasVenta.cantidad_litros, 46), `litros=${trasVenta.cantidad_litros}`);

  // Cada combustible tiene su precio: cambiar uno no toca a los otros
  const naftaAntes = (await combustiblesAPI.obtenerTodos()).find((c) => c.nombre === 'Nafta');
  await combustiblesAPI.actualizarPrecio(premium.id, 4000);
  const naftaDespues = (await combustiblesAPI.obtenerTodos()).find((c) => c.nombre === 'Nafta');
  check('el precio es por combustible, no compartido',
    cerca(naftaAntes.precio_por_litro, naftaDespues.precio_por_litro),
    `nafta antes=${naftaAntes.precio_por_litro} después=${naftaDespues.precio_por_litro}`);

  let conStock = null;
  try { await combustiblesAPI.desactivar(premium.id); } catch (e) { conStock = e.message; }
  check('no deja desactivar uno que todavía tiene litros', !!conStock, conStock || 'no lanzó error');

  await ventasAPI.eliminar(ventaPremium.id);
  await combustiblesAPI.actualizarCantidad(premium.id, -50);
  await combustiblesAPI.desactivar(premium.id);
  const activos = await combustiblesAPI.obtenerTodos();
  const todos = await combustiblesAPI.obtenerTodos({ incluirInactivos: true });
  check('desactivado sale de la lista de venta', !activos.some((c) => c.id === premium.id));
  check('pero sigue existiendo para el historial', todos.some((c) => c.id === premium.id));

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
