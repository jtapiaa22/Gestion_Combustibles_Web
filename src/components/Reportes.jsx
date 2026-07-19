import { useEffect, useMemo, useState } from 'react';
import { combustiblesAPI, clientesAPI, ventasAPI, comprasAPI } from '../lib/api.js';
import { formatearMonto, formatearFecha, formatearHora, hoyAR } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { useEsEscritorio } from '../hooks/useAncho.js';
import { Modal } from './Modal.jsx';

/** Rangos rápidos, en fechas locales YYYY-MM-DD. */
function rangos() {
  const hoy = hoyAR();
  const restar = (dias) => {
    const d = new Date(`${hoy}T12:00:00`);
    d.setDate(d.getDate() - dias);
    return d.toLocaleDateString('en-CA');
  };
  return {
    hoy: { etiqueta: 'Hoy', desde: hoy, hasta: hoy },
    semana: { etiqueta: '7 días', desde: restar(6), hasta: hoy },
    mes: { etiqueta: '30 días', desde: restar(29), hasta: hoy },
    todo: { etiqueta: 'Todo', desde: null, hasta: null },
  };
}

export function Reportes() {
  const { mostrar, Notificacion } = useNotificacion();
  const esEscritorio = useEsEscritorio();
  const R = useMemo(rangos, []);

  const [rango, setRango] = useState('mes');
  const [desde, setDesde] = useState(R.mes.desde);
  const [hasta, setHasta] = useState(R.mes.hasta);

  const [ventas, setVentas] = useState([]);
  const [compras, setCompras] = useState([]);
  const [combustibles, setCombustibles] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [editando, setEditando] = useState(null);
  const [borrando, setBorrando] = useState(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = async (d = desde, h = hasta) => {
    setCargando(true);
    try {
      const [vs, cps, cbs, cls] = await Promise.all([
        d && h ? ventasAPI.obtenerPorFecha(d, h) : ventasAPI.obtenerTodas(),
        comprasAPI.obtenerTodas(),
        combustiblesAPI.obtenerTodos({ incluirInactivos: true }),
        clientesAPI.obtenerTodos(),
      ]);
      setVentas(vs);
      setCompras(cps);
      setCombustibles(cbs);
      setClientes(cls);
    } catch (e) {
      mostrar(`No se pudo cargar: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const aplicarRango = (clave) => {
    const r = R[clave];
    setRango(clave);
    setDesde(r.desde);
    setHasta(r.hasta);
    cargar(r.desde, r.hasta);
  };

  // ── Totales del período ───────────────────────────────────
  const t = useMemo(() => {
    const alContado = ventas.filter((v) => !v.es_fiado);
    const fiadas = ventas.filter((v) => v.es_fiado);
    const suma = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

    const porCombustible = {};
    for (const v of ventas) {
      const k = v.combustible_nombre || '—';
      porCombustible[k] ??= { litros: 0, monto: 0, ventas: 0 };
      porCombustible[k].litros += v.cantidad_litros;
      porCombustible[k].monto += v.total;
      porCombustible[k].ventas++;
    }

    return {
      efectivo: suma(alContado.filter((v) => v.metodo_pago === 'Efectivo'), (v) => v.total),
      transferencia: suma(alContado.filter((v) => v.metodo_pago === 'Transferencia'), (v) => v.total),
      fiado: suma(fiadas, (v) => v.total),
      sinCobrar: suma(fiadas.filter((v) => !v.pagado), (v) => v.saldo),
      cantidad: ventas.length,
      cantidadFiadas: fiadas.length,
      porCombustible: Object.entries(porCombustible).sort((a, b) => b[1].monto - a[1].monto),
    };
  }, [ventas]);

  const cobrado = t.efectivo + t.transferencia;

  // Las compras del período, para el contraste con lo vendido
  const comprasPeriodo = useMemo(() => {
    if (!desde || !hasta) return compras;
    return compras.filter((c) => {
      const dia = new Date(c.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      return dia >= desde && dia <= hasta;
    });
  }, [compras, desde, hasta]);
  const invertido = comprasPeriodo.reduce((s, c) => s + Number(c.total_compra || 0), 0);

  const borrarVenta = async () => {
    setProcesando(true);
    try {
      await ventasAPI.eliminar(borrando.id);
      mostrar('Venta borrada · los litros volvieron al tanque');
      setBorrando(null);
      await cargar();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fade-in">
      <Notificacion />

      {/* Rango */}
      <div className="segmentado" style={{ marginBottom: 10, maxWidth: 460 }}>
        {Object.entries(R).map(([k, r]) => (
          <button key={k} className={rango === k ? 'activo' : ''} onClick={() => aplicarRango(k)}>
            {r.etiqueta}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="date" value={desde || ''} max={hasta || undefined}
          onChange={(e) => { setDesde(e.target.value); setRango('personalizado'); }}
          style={{ width: 'auto', flex: '1 1 145px' }}
        />
        <span style={{ color: 'var(--text-muted)' }}>a</span>
        <input
          type="date" value={hasta || ''} min={desde || undefined}
          onChange={(e) => { setHasta(e.target.value); setRango('personalizado'); }}
          style={{ width: 'auto', flex: '1 1 145px' }}
        />
        <button
          onClick={() => cargar(desde, hasta)}
          disabled={!desde || !hasta}
          style={{ padding: '11px 18px', borderRadius: 'var(--radius)', backgroundColor: 'var(--accent)', color: '#1C1917' }}
        >
          Filtrar
        </button>
      </div>

      {cargando ? (
        <div className="vacio">Cargando…</div>
      ) : (
        <>
          {/* Totales */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 10 }}>
            <div className="card" style={{ padding: 16, flex: '1 1 200px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>COBRADO</div>
              <div style={{ fontSize: 27, fontWeight: 700, color: 'var(--success)' }}>{formatearMonto(cobrado)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
                {formatearMonto(t.efectivo)} efectivo · {formatearMonto(t.transferencia)} transferencia
              </div>
            </div>
            <div className="card" style={{ padding: 16, flex: '1 1 200px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>SE FIÓ</div>
              <div style={{ fontSize: 27, fontWeight: 700, color: 'var(--accent)' }}>{formatearMonto(t.fiado)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
                {t.cantidadFiadas} ventas · {formatearMonto(t.sinCobrar)} todavía sin cobrar
              </div>
            </div>
            <div className="card" style={{ padding: 16, flex: '1 1 200px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 700 }}>COMPRASTE</div>
              <div style={{ fontSize: 27, fontWeight: 700 }}>{formatearMonto(invertido)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
                {comprasPeriodo.length} {comprasPeriodo.length === 1 ? 'compra' : 'compras'} de combustible
              </div>
            </div>
          </div>

          {/* Por combustible */}
          {t.porCombustible.length > 0 && (
            <>
              <h2 className="titulo-seccion" style={{ margin: '18px 0 9px' }}>Por combustible</h2>
              <div className="tabla-scroll" style={{ marginBottom: 18 }}>
                <table>
                  <thead>
                    <tr><th>Combustible</th><th>Ventas</th><th>Litros</th><th>Facturado</th></tr>
                  </thead>
                  <tbody>
                    {t.porCombustible.map(([nombre, d]) => (
                      <tr key={nombre}>
                        <td><strong>{nombre}</strong></td>
                        <td>{d.ventas}</td>
                        <td>{d.litros.toFixed(2)} L</td>
                        <td><strong>{formatearMonto(d.monto)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Ventas */}
          <h2 className="titulo-seccion" style={{ marginBottom: 9 }}>
            Ventas ({t.cantidad})
          </h2>
          {ventas.length === 0 ? (
            <div className="vacio">No hubo ventas en este período</div>
          ) : esEscritorio ? (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Combustible</th><th>Litros</th><th>Total</th>
                    <th>Cobro</th><th>Cliente</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <tr key={v.id}>
                      <td>{formatearFecha(v.fecha)} {formatearHora(v.fecha)}</td>
                      <td>{v.combustible_nombre}</td>
                      <td>{v.cantidad_litros.toFixed(2)} L</td>
                      <td><strong>{formatearMonto(v.total)}</strong></td>
                      <td>
                        {!v.es_fiado ? v.metodo_pago
                          : v.pagado ? <span className="badge" style={{ backgroundColor: 'var(--blue)' }}>Saldado</span>
                          : <span className="badge" style={{ backgroundColor: 'var(--accent-dark)' }}>debe {formatearMonto(v.saldo)}</span>}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{v.cliente_nombre || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button onClick={() => setEditando(v)} className="theme-toggle" style={{ padding: '4px 10px', fontSize: 12 }}>
                          Editar
                        </button>
                        <button
                          onClick={() => setBorrando(v)}
                          className="theme-toggle"
                          style={{ padding: '4px 10px', fontSize: 12, marginLeft: 5, color: 'var(--danger)' }}
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="lista-tarjetas" style={{ gap: 7 }}>
              {ventas.map((v) => (
                <div key={v.id} className="venta-tarjeta">
                  <div className="fila">
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 15.5 }}>{formatearMonto(v.total)}</strong>
                      <div className="detalle">
                        {formatearFecha(v.fecha)} {formatearHora(v.fecha)} · {v.combustible_nombre}
                        {' · '}{v.cantidad_litros.toFixed(2)} L{v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}
                      </div>
                    </div>
                    <span
                      className="badge"
                      style={{ flexShrink: 0, backgroundColor: !v.es_fiado ? 'var(--success)' : v.pagado ? 'var(--blue)' : 'var(--accent-dark)' }}
                    >
                      {!v.es_fiado ? v.metodo_pago : v.pagado ? 'Saldado' : 'Fiado'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
                    <button onClick={() => setEditando(v)} className="theme-toggle" style={{ flex: 1 }}>Editar</button>
                    <button onClick={() => setBorrando(v)} className="theme-toggle" style={{ flex: 1, color: 'var(--danger)' }}>
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ══════════ Editar ══════════ */}
      <EditarVentaModal
        venta={editando}
        combustibles={combustibles}
        clientes={clientes}
        onCerrar={() => setEditando(null)}
        onListo={async (msg) => { setEditando(null); mostrar(msg); await cargar(); }}
        onError={(m) => mostrar(m, 'error')}
      />

      {/* ══════════ Borrar ══════════ */}
      <Modal abierto={!!borrando} onCerrar={() => setBorrando(null)} titulo="Borrar venta" ancho={410}>
        {borrando && (
          <>
            <div className="sub-card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 19, fontWeight: 700 }}>{formatearMonto(borrando.total)}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                {formatearFecha(borrando.fecha)} · {borrando.combustible_nombre}
                {' · '}{borrando.cantidad_litros.toFixed(2)} L
                {borrando.cliente_nombre ? ` · ${borrando.cliente_nombre}` : ''}
              </div>
            </div>

            <p style={{ marginBottom: 8, lineHeight: 1.5, fontSize: 14 }}>
              Los <strong>{borrando.cantidad_litros.toFixed(2)} litros</strong> vuelven al tanque de{' '}
              {borrando.combustible_nombre}.
            </p>
            {borrando.es_fiado && !borrando.pagado && (
              <p style={{ marginBottom: 8, lineHeight: 1.5, fontSize: 14, color: 'var(--accent)' }}>
                {borrando.cliente_nombre} deja de deber {formatearMonto(borrando.saldo)}.
              </p>
            )}
            {borrando.cobrado > 0.01 && (
              <p style={{ marginBottom: 8, lineHeight: 1.5, fontSize: 14, color: 'var(--danger)' }}>
                Ojo: se borran también los {formatearMonto(borrando.cobrado)} que ya había pagado.
              </p>
            )}
            <p style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: 13.5 }}>
              No se puede deshacer.
            </p>

            <div style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => setBorrando(null)}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancelar
              </button>
              <button
                onClick={borrarVenta} disabled={procesando}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--radius)', backgroundColor: 'var(--danger)', color: 'white', fontWeight: 700 }}
              >
                {procesando ? 'Borrando…' : 'Borrar'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
function EditarVentaModal({ venta, combustibles, clientes, onCerrar, onListo, onError }) {
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!venta) { setForm(null); return; }
    setForm({
      combustibleId: venta.combustible_id,
      litros: String(venta.cantidad_litros),
      precio: String(venta.precio_por_litro),
      esFiado: venta.es_fiado,
      metodoPago: venta.metodo_pago || 'Efectivo',
      clienteId: venta.cliente_id || null,
      titular: venta.titular_transferencia || '',
    });
  }, [venta]);

  if (!venta || !form) return null;

  const litros = parseFloat(form.litros) || 0;
  const precio = parseFloat(form.precio) || 0;
  const nuevoTotal = litros * precio;

  const problema =
    litros <= 0 ? 'Los litros tienen que ser mayores a cero'
    : precio < 0 ? 'El precio no puede ser negativo'
    : form.esFiado && !form.clienteId ? 'Un fiado necesita un cliente'
    : form.esFiado && nuevoTotal < venta.cobrado - 0.01
      ? `Ya pagó ${formatearMonto(venta.cobrado)}: el total no puede quedar por debajo`
    : !form.esFiado && venta.es_fiado && venta.cobrado > 0.01
      ? 'Esta venta ya tiene pagos registrados. No se puede pasar a contado.'
    : null;

  const guardar = async () => {
    if (problema) return;
    setGuardando(true);
    try {
      await ventasAPI.editar(venta.id, {
        combustibleId: form.combustibleId,
        cantidadLitros: litros,
        precioPorLitro: precio,
        esFiado: form.esFiado,
        metodoPago: form.esFiado ? null : form.metodoPago,
        clienteId: form.esFiado ? form.clienteId : null,
        titularTransferencia: form.metodoPago === 'Transferencia' ? form.titular : null,
      });
      onListo('Venta actualizada');
    } catch (e) {
      onError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const difLitros = litros - venta.cantidad_litros;

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Editar venta" ancho={470}>
      <div className="sub-card" style={{ marginBottom: 16, fontSize: 13.5, color: 'var(--text-secondary)' }}>
        Original: {formatearFecha(venta.fecha)} {formatearHora(venta.fecha)} ·{' '}
        {venta.cantidad_litros.toFixed(2)} L de {venta.combustible_nombre} · {formatearMonto(venta.total)}
      </div>

      <div className="campo">
        <label>Combustible</label>
        <select
          value={form.combustibleId}
          onChange={(e) => setForm({ ...form, combustibleId: Number(e.target.value) })}
        >
          {combustibles.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}{!c.activo ? ' (dado de baja)' : ''}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div className="campo" style={{ flex: 1 }}>
          <label>Litros</label>
          <input
            type="number" inputMode="decimal" step="any" min="0"
            value={form.litros} onChange={(e) => setForm({ ...form, litros: e.target.value })}
          />
        </div>
        <div className="campo" style={{ flex: 1 }}>
          <label>Precio por litro</label>
          <input
            type="number" inputMode="decimal" step="any" min="0"
            value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })}
          />
        </div>
      </div>

      <div className="panel-destacado" style={{ backgroundColor: 'var(--blue)', marginBottom: 14 }}>
        <div className="etiqueta">Nuevo total</div>
        <div className="valor">{formatearMonto(nuevoTotal)}</div>
      </div>

      {Math.abs(difLitros) > 0.001 && (
        <div className="sub-card" style={{ marginBottom: 14, fontSize: 13.5 }}>
          {difLitros > 0
            ? <>Se van a descontar <strong>{difLitros.toFixed(2)} L</strong> más del tanque.</>
            : <>Vuelven <strong>{Math.abs(difLitros).toFixed(2)} L</strong> al tanque.</>}
        </div>
      )}

      <div className="campo">
        <label>Cómo se cobra</label>
        <div className="segmentado">
          {['Efectivo', 'Transferencia', 'Fiado'].map((c) => {
            const activo = c === 'Fiado' ? form.esFiado : !form.esFiado && form.metodoPago === c;
            return (
              <button
                key={c}
                className={activo ? 'activo' : ''}
                data-tono={c === 'Fiado' ? 'fiado' : undefined}
                onClick={() =>
                  setForm({
                    ...form,
                    esFiado: c === 'Fiado',
                    metodoPago: c === 'Fiado' ? form.metodoPago : c,
                    clienteId: c === 'Fiado' ? form.clienteId : null,
                  })
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {form.esFiado && (
        <div className="campo">
          <label>A quién</label>
          <select
            value={form.clienteId || ''}
            onChange={(e) => setForm({ ...form, clienteId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Elegir cliente…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {!form.esFiado && form.metodoPago === 'Transferencia' && (
        <div className="campo">
          <label>Quién transfiere</label>
          <input value={form.titular} onChange={(e) => setForm({ ...form, titular: e.target.value })} />
        </div>
      )}

      {problema && (
        <div className="sub-card" style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 600, fontSize: 14 }}>
          {problema}
        </div>
      )}

      <div style={{ display: 'flex', gap: 9 }}>
        <button
          onClick={onCerrar}
          style={{ flex: 1, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Cancelar
        </button>
        <button
          onClick={guardar} disabled={!!problema || guardando}
          style={{ flex: 2, padding: 14, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white', fontWeight: 700 }}
        >
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </Modal>
  );
}
