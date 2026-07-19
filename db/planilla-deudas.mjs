// ═══════════════════════════════════════════════════════════════
//  planilla-deudas.mjs — Planilla imprimible para cruzar las deudas
//  contra la libreta del papá antes de pasar los datos.
//
//  Lee de la base VIEJA (solo lectura) y genera un HTML con un
//  recuadro por deudor: el detalle de cada fiado, un renglón en
//  blanco para escribir lo que dice la libreta, y un casillero para
//  tildar. Marca en amarillo los que no cuadran.
//
//  Correr el MISMO DÍA del cambio: las deudas se mueven, una planilla
//  vieja no sirve para nada.
//
//  Uso: node db/planilla-deudas.mjs
// ═══════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const U = `${env.ORIGEN_URL}/rest/v1`;
const H = { apikey: env.ORIGEN_KEY, Authorization: `Bearer ${env.ORIGEN_KEY}` };
const q = async (p) => (await fetch(`${U}/${p}`, { headers: H })).json();

const money = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR');

// Las fechas de la base vieja están guardadas como hora local
// etiquetada UTC. Se formatean CRUDAS, sin conversión de zona: así
// coinciden con lo que el papá tiene anotado. Pasarlas por new Date()
// las corre 3 horas y no reconoce las ventas.
const fecha = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const [clientes, impagas] = await Promise.all([
  q('clientes?select=id,nombre,telefono,debe&order=nombre'),
  q('ventas?select=id,cliente_id,fecha,tipo_combustible,cantidad_litros,total,total_original&pagado=eq.false&order=fecha.asc'),
]);

const porCliente = {};
impagas.forEach((v) => (porCliente[v.cliente_id] = porCliente[v.cliente_id] || []).push(v));

const conDeuda = clientes
  .filter((c) => porCliente[c.id]?.length || (c.debe || 0) > 0.5)
  .map((c) => {
    const vs = porCliente[c.id] || [];
    const real = vs.reduce((s, v) => s + (v.total || 0), 0);
    return { ...c, ventas: vs, real, dif: (c.debe || 0) - real };
  })
  .sort((a, b) => b.real - a.real);

const totalReal = conDeuda.reduce((s, c) => s + c.real, 0);

const filas = conDeuda.map((c) => {
  const alerta = Math.abs(c.dif) > 0.5;
  const detalle = c.ventas.map((v) => `
      <tr class="det">
        <td>${fecha(v.fecha)}</td>
        <td>${v.tipo_combustible}</td>
        <td class="r">${(v.cantidad_litros || 0).toFixed(1)} L</td>
        <td class="r">${money(v.total)}</td>
      </tr>`).join('');

  return `
    <div class="cli ${alerta ? 'alerta' : ''}">
      <div class="cab">
        <div>
          <span class="nom">${c.nombre}</span>
          ${c.telefono ? `<span class="tel">${c.telefono}</span>` : ''}
        </div>
        <div class="tot">${money(c.real)}</div>
      </div>
      ${alerta ? `<div class="warn">⚠ El sistema tenía anotado ${money(c.debe || 0)} — hay ${money(Math.abs(c.dif))} de diferencia. Definir con la libreta cuál es el correcto.</div>` : ''}
      <table>
        <tr><th>Fecha</th><th>Combustible</th><th class="r">Litros</th><th class="r">Debe</th></tr>
        ${detalle || '<tr class="det"><td colspan="4"><i>sin fiados registrados</i></td></tr>'}
      </table>
      <div class="firma">
        Según la libreta debe: <span class="linea"></span>
        &nbsp;&nbsp; <span class="ok">☐ coincide</span>
      </div>
    </div>`;
}).join('');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Verificación de deudas</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:28px;color:#18181b;background:#fff;font-size:13px}
  h1{font-size:21px;margin:0 0 4px}
  .sub{color:#71717a;margin-bottom:6px}
  .resumen{background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:12px 14px;margin:16px 0 22px}
  .resumen b{font-size:19px}
  .cli{border:1px solid #d4d4d8;border-radius:8px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid}
  .cli.alerta{border-color:#f59e0b;border-width:2px;background:#fffbeb}
  .cab{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
  .nom{font-weight:700;font-size:15px}
  .tel{color:#71717a;margin-left:10px;font-size:12px}
  .tot{font-weight:700;font-size:17px}
  .warn{background:#fef3c7;border-left:3px solid #f59e0b;padding:7px 10px;margin-bottom:8px;font-size:12px;border-radius:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:9px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#71717a;border-bottom:1px solid #e4e4e7;padding:3px 5px;font-weight:600}
  td{padding:3px 5px;border-bottom:1px solid #f4f4f5}
  .r{text-align:right}
  .firma{border-top:1px dashed #d4d4d8;padding-top:8px;font-size:12px;color:#52525b}
  .linea{display:inline-block;width:150px;border-bottom:1px solid #18181b;margin:0 4px}
  .ok{margin-left:8px}
  @media print{body{padding:12px}.cli{border-color:#999}}
</style></head><body>
<h1>Verificación de deudas</h1>
<div class="sub">Cruzar contra la libreta antes de pasar al sistema nuevo · generado ${new Date().toLocaleDateString('es-AR')}</div>
<div class="resumen">
  <b>${money(totalReal)}</b> en total &nbsp;·&nbsp; ${conDeuda.length} clientes con deuda &nbsp;·&nbsp; ${impagas.length} fiados sin cobrar<br>
  <span style="color:#71717a">Los recuadros en amarillo son los que no cierran con lo que el sistema tenía anotado.</span>
</div>
${filas}
</body></html>`;

const salida = new URL('../../verificacion-deudas.html', import.meta.url);
writeFileSync(salida, html, 'utf8');

console.log('Planilla generada:', decodeURIComponent(salida.pathname.replace(/^\//, '')));
console.log(`${conDeuda.length} clientes con deuda · ${impagas.length} fiados · ${money(totalReal)}`);
const raros = conDeuda.filter((c) => Math.abs(c.dif) > 0.5);
console.log('descuadrados:', raros.length ? raros.map((c) => `${c.nombre} (${money(Math.abs(c.dif))})`).join(', ') : 'ninguno');
