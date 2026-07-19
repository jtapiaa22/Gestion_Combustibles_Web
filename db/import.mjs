// ═══════════════════════════════════════════════════════════════
//  import.mjs — Pasa el estado vivo de la base vieja a la nueva.
//
//  Lee: clientes, fiados abiertos, stock y la última compra de cada
//  combustible. NO trae el historial: las ventas ya cobradas, los
//  pagos viejos y los cierres de caja quedan en la base vieja, que
//  no se toca nunca y funciona como archivo.
//
//  La base de origen se abre SOLO PARA LECTURA. Este script no
//  escribe una sola fila ahí.
//
//  Uso:
//    node db/import.mjs              → simulacro, no escribe nada
//    node db/import.mjs --ejecutar   → escribe de verdad
// ═══════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const EJECUTAR = process.argv.includes('--ejecutar');

// ── env ───────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const origen = createClient(env.ORIGEN_URL, env.ORIGEN_KEY);
const destino = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

// ── helpers ───────────────────────────────────────────────────
const money = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR');

/**
 * Los timestamps viejos son hora local argentina etiquetada como UTC
 * (el bug del .replace que no hacía nada). Para convertirlos a un
 * instante UTC real hay que sumarles las 3 horas que les faltan.
 */
const corregirFecha = (iso) => new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString();

/** Partículas que en castellano van en minúscula dentro del nombre. */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do']);

const normalizarNombre = (raw) =>
  (raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

const alzar = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(EJECUTAR ? '  IMPORT REAL — se van a escribir datos' : '  SIMULACRO — no se escribe nada');
  console.log('═'.repeat(62));

  // ── 1. Leer el estado vivo de la base vieja ─────────────────
  console.log('\n[1] Leyendo la base vieja (solo lectura)...');

  const clientesViejos = alzar(await origen.from('clientes').select('*').order('nombre'));
  const fiados = alzar(await origen.from('ventas').select('*').eq('pagado', false).order('fecha'));
  const stockViejo = alzar(await origen.from('stock').select('*'));

  const idsFiados = fiados.map((f) => f.id);
  const pagosPrevios = idsFiados.length
    ? alzar(await origen.from('pagos_fiado').select('*').in('venta_id', idsFiados))
    : [];

  const comprasRecientes = [];
  for (const tipo of ['Nafta', 'Gasoil']) {
    const c = alzar(
      await origen.from('compras_stock').select('*').eq('tipo_combustible', tipo)
        .order('fecha', { ascending: false }).limit(1)
    );
    if (c?.[0]) comprasRecientes.push(c[0]);
  }

  console.log(`    ${clientesViejos.length} clientes`);
  console.log(`    ${fiados.length} fiados abiertos`);
  console.log(`    ${pagosPrevios.length} pagos parciales sobre esos fiados`);
  console.log(`    ${comprasRecientes.length} compras (última de cada combustible)`);

  // ── 2. Normalizar y deduplicar clientes ─────────────────────
  console.log('\n[2] Normalizando nombres y deduplicando...');

  const porClave = new Map();      // nombre normalizado -> cliente elegido
  const mapaViejoANuevo = new Map(); // id viejo -> clave (después, id nuevo)
  const renombrados = [];
  const fusionados = [];

  for (const c of clientesViejos) {
    const nombre = normalizarNombre(c.nombre);
    const clave = nombre.toLowerCase();

    if (porClave.has(clave)) {
      fusionados.push({ nombre, mantiene: porClave.get(clave).idViejo, descarta: c.id });
    } else {
      porClave.set(clave, {
        idViejo: c.id,
        nombre,
        telefono: c.telefono?.trim() || null,
        direccion: c.direccion?.trim() || null,
      });
    }
    mapaViejoANuevo.set(c.id, clave);
    if (nombre !== c.nombre) renombrados.push(`${JSON.stringify(c.nombre)} → ${JSON.stringify(nombre)}`);
  }

  console.log(`    ${porClave.size} clientes finales (${clientesViejos.length - porClave.size} fusionados)`);
  fusionados.forEach((f) => console.log(`      fusionado: "${f.nombre}" (ids ${f.descarta} → ${f.mantiene})`));
  if (renombrados.length) {
    console.log(`    ${renombrados.length} nombres normalizados:`);
    renombrados.slice(0, 12).forEach((r) => console.log(`      ${r}`));
    if (renombrados.length > 12) console.log(`      ... y ${renombrados.length - 12} más`);
  }

  // ── 3. Resumen de lo que se va a escribir ───────────────────
  const totalDeuda = fiados.reduce((s, f) => s + (f.total || 0), 0);
  console.log('\n[3] Lo que se va a insertar en la base nueva:');
  console.log(`    clientes      : ${porClave.size}`);
  console.log(`    ventas fiadas : ${fiados.length}  (deuda viva ${money(totalDeuda)})`);
  console.log(`    pagos         : ${pagosPrevios.length}`);
  console.log(`    compras       : ${comprasRecientes.length}`);
  console.log(`    stock         : ${stockViejo.map((s) => `${s.tipo_combustible} ${s.cantidad_litros}L @ ${money(s.precio_por_litro)}`).join(' | ')}`);

  if (!EJECUTAR) {
    console.log('\n  Simulacro terminado. Nada fue escrito.');
    console.log('  Para hacerlo de verdad: node db/import.mjs --ejecutar\n');
    return;
  }

  // ── 4. Autenticarse en la base nueva ────────────────────────
  console.log('\n[4] Entrando a la base nueva...');
  const { error: errLogin } = await destino.auth.signInWithPassword({
    email: env.IMPORT_EMAIL,
    password: env.IMPORT_PASSWORD,
  });
  if (errLogin) throw new Error(`No se pudo entrar: ${errLogin.message}`);
  console.log(`    ok, como ${env.IMPORT_EMAIL}`);

  // Que no se cargue dos veces por accidente
  const yaHay = alzar(await destino.from('clientes').select('id').limit(1));
  if (yaHay?.length) {
    throw new Error('La base nueva ya tiene clientes cargados. Vaciala antes de reimportar.');
  }

  // ── 5. Clientes ─────────────────────────────────────────────
  console.log('\n[5] Insertando clientes...');
  const nuevosClientes = alzar(
    await destino.from('clientes')
      .insert([...porClave.values()].map(({ nombre, telefono, direccion }) => ({ nombre, telefono, direccion })))
      .select('id, nombre')
  );

  const claveANuevoId = new Map(nuevosClientes.map((c) => [c.nombre.toLowerCase(), c.id]));
  const idNuevoDe = (idViejo) => claveANuevoId.get(mapaViejoANuevo.get(idViejo)) ?? null;
  console.log(`    ${nuevosClientes.length} insertados`);

  // ── 6. Stock y compras ──────────────────────────────────────
  console.log('\n[6] Actualizando stock e insertando compras...');
  for (const s of stockViejo) {
    alzar(
      await destino.from('stock')
        .update({ cantidad_litros: s.cantidad_litros, precio_por_litro: s.precio_por_litro })
        .eq('tipo_combustible', s.tipo_combustible)
        .select()
    );
  }
  if (comprasRecientes.length) {
    alzar(
      await destino.from('compras_stock').insert(
        comprasRecientes.map((c) => ({
          fecha: corregirFecha(c.fecha),
          tipo_combustible: c.tipo_combustible,
          cantidad_litros: c.cantidad_litros,
          precio_por_litro_compra: c.precio_por_litro_compra,
        }))
      ).select()
    );
  }
  console.log(`    stock actualizado, ${comprasRecientes.length} compras insertadas`);

  // ── 7. Fiados abiertos ──────────────────────────────────────
  console.log('\n[7] Insertando fiados abiertos...');
  const nuevasVentas = alzar(
    await destino.from('ventas').insert(
      fiados.map((f) => ({
        fecha: corregirFecha(f.fecha),
        cliente_id: idNuevoDe(f.cliente_id),
        tipo_combustible: f.tipo_combustible,
        cantidad_litros: f.cantidad_litros,
        precio_por_litro: f.precio_por_litro,
        es_fiado: true,
        metodo_pago: null, // un fiado se define al cobrarse, no al venderse
      }))
    ).select('id')
  );

  const ventaNuevaDe = new Map(fiados.map((f, i) => [f.id, nuevasVentas[i].id]));
  console.log(`    ${nuevasVentas.length} insertados`);

  // ── 8. Pagos parciales previos ──────────────────────────────
  if (pagosPrevios.length) {
    console.log('\n[8] Insertando pagos parciales...');
    alzar(
      await destino.from('pagos_fiado').insert(
        pagosPrevios.map((p) => ({
          venta_id: ventaNuevaDe.get(p.venta_id),
          cliente_id: idNuevoDe(p.cliente_id),
          monto: p.monto,
          metodo_pago: p.metodo_pago,
          titular_transferencia: p.titular_transferencia || null,
          fecha: corregirFecha(p.fecha),
        }))
      ).select()
    );
    console.log(`    ${pagosPrevios.length} insertados`);
  }

  // ── 9. Verificación ─────────────────────────────────────────
  console.log('\n[9] Verificando contra el origen...');
  const vClientes = alzar(await destino.from('v_clientes').select('nombre, debe').gt('debe', 0.5));
  const deudaNueva = vClientes.reduce((s, c) => s + Number(c.debe), 0);

  console.log(`    deuda en la base vieja : ${money(totalDeuda)}`);
  console.log(`    deuda en la base nueva : ${money(deudaNueva)}`);

  const dif = Math.abs(totalDeuda - deudaNueva);
  if (dif > 1) {
    console.log(`\n  ⚠ NO CUADRA: diferencia de ${money(dif)}. Revisar antes de usar.`);
    process.exitCode = 1;
  } else {
    console.log(`    ✓ cuadra (${vClientes.length} clientes con deuda)`);
    console.log('\n  Import terminado. La base vieja quedó intacta.\n');
  }
}

main().catch((e) => {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exitCode = 1;
});
