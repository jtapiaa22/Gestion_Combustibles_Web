import { useEffect, useMemo, useState } from 'react';
import { stockAPI, clientesAPI, ventasAPI } from '../lib/api.js';
import { formatearMonto, formatearHora, esHoy } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { useEsEscritorio } from '../hooks/useAncho.js';

const FORM_VACIO = {
  tipoCombustible: 'Nafta',
  cantidadLitros: '',
  montoPedido: '',
  cobro: 'Efectivo', // Efectivo | Transferencia | Fiado
  clienteId: null,
  titularTransferencia: '',
};

// La cantidad_litros se guarda con 3 decimales. Redondeamos acá para
// que el total que ve en pantalla sea exactamente el que se guarda.
const LITROS_DECIMALES = 3;
const redondearLitros = (n) => Math.round(n * 10 ** LITROS_DECIMALES) / 10 ** LITROS_DECIMALES;

export function Ventas() {
  const { mostrar, Notificacion } = useNotificacion();
  const esEscritorio = useEsEscritorio();

  const [stock, setStock] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [form, setForm] = useState(FORM_VACIO);
  const [modo, setModo] = useState('litros'); // litros | monto
  const [montoPagado, setMontoPagado] = useState('');
  const [registrando, setRegistrando] = useState(false);

  const [formCliente, setFormCliente] = useState(null); // null = cerrado
  const [guardandoCliente, setGuardandoCliente] = useState(false);

  const set = (cambios) => setForm((f) => ({ ...f, ...cambios }));

  // ── Carga ─────────────────────────────────────────────────
  const cargar = async () => {
    try {
      const [s, c, v] = await Promise.all([
        stockAPI.obtenerTodo(),
        clientesAPI.obtenerTodos(),
        ventasAPI.obtenerTodas(),
      ]);
      setStock(s);
      setClientes(c);
      setVentasHoy(v.filter((x) => esHoy(x.fecha)));
    } catch (e) {
      mostrar(`No se pudieron cargar los datos: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  // ── Derivados ─────────────────────────────────────────────
  const combustible = stock.find((s) => s.tipo_combustible === form.tipoCombustible);
  const precio = combustible?.precio_por_litro || 0;
  const disponible = combustible?.cantidad_litros || 0;

  const litros = useMemo(() => {
    if (modo === 'litros') return parseFloat(form.cantidadLitros) || 0;
    const monto = parseFloat(form.montoPedido) || 0;
    return precio > 0 ? redondearLitros(monto / precio) : 0;
  }, [modo, form.cantidadLitros, form.montoPedido, precio]);

  const total = redondearLitros(litros) * precio;
  const esFiado = form.cobro === 'Fiado';

  const problema = useMemo(() => {
    if (precio <= 0) return `No hay precio cargado para ${form.tipoCombustible}`;
    if (litros <= 0) return null; // todavía no cargó nada, no es un error
    if (litros > disponible) return `Solo quedan ${disponible.toFixed(2)} litros de ${form.tipoCombustible}`;
    if (esFiado && !form.clienteId) return 'Elegí a quién se le fía';
    return null;
  }, [precio, litros, disponible, esFiado, form.clienteId, form.tipoCombustible]);

  const puedeRegistrar = litros > 0 && !problema && !registrando;

  const clienteElegido = clientes.find((c) => c.id === form.clienteId);
  const cobradoHoy = ventasHoy.filter((v) => !v.es_fiado).reduce((s, v) => s + v.total, 0);
  const fiadoHoy = ventasHoy.filter((v) => v.es_fiado).reduce((s, v) => s + v.total, 0);

  // ── Acciones ──────────────────────────────────────────────
  const registrar = async () => {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    try {
      await ventasAPI.registrar({
        clienteId: esFiado ? form.clienteId : null,
        tipoCombustible: form.tipoCombustible,
        cantidadLitros: redondearLitros(litros),
        precioPorLitro: precio,
        esFiado,
        metodoPago: esFiado ? null : form.cobro,
        titularTransferencia: form.cobro === 'Transferencia' ? form.titularTransferencia : null,
      });
      mostrar(`Venta registrada · ${formatearMonto(total)}`);
      setForm({ ...FORM_VACIO, tipoCombustible: form.tipoCombustible });
      setMontoPagado('');
      setFormCliente(null);
      await cargar();
    } catch (e) {
      mostrar(e.message || 'No se pudo registrar la venta', 'error');
    } finally {
      setRegistrando(false);
    }
  };

  const guardarCliente = async () => {
    if (!formCliente?.nombre?.trim()) { mostrar('Poné el nombre del cliente', 'error'); return; }
    setGuardandoCliente(true);
    try {
      const nuevo = await clientesAPI.agregar(formCliente.nombre, formCliente.telefono, formCliente.direccion);
      mostrar('Cliente agregado');
      setClientes(await clientesAPI.obtenerTodos());
      set({ clienteId: nuevo.id });
      setFormCliente(null);
    } catch (e) {
      mostrar(e.message || 'No se pudo agregar el cliente', 'error');
    } finally {
      setGuardandoCliente(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  const vuelto = parseFloat(montoPagado) - total;

  return (
    <div className="fade-in">
      <Notificacion />

      <div className="ventas-layout">
        {/* ══════════ Formulario ══════════ */}
        <div className="card">
          {/* Combustible */}
          <div className="campo">
            <label>Combustible</label>
            <div className="segmentado">
              {['Nafta', 'Gasoil'].map((t) => (
                <button
                  key={t}
                  className={form.tipoCombustible === t ? 'activo' : ''}
                  onClick={() => set({ tipoCombustible: t })}
                >
                  {t}
                </button>
              ))}
            </div>
            <small className="ayuda">
              {cargando ? 'Cargando…' : (
                <>Quedan <strong>{disponible.toFixed(2)} L</strong> · {formatearMonto(precio)} por litro</>
              )}
            </small>
          </div>

          {/* Modo de carga */}
          <div className="campo">
            <div className="segmentado">
              <button
                className={modo === 'litros' ? 'activo' : ''}
                onClick={() => { setModo('litros'); set({ montoPedido: '' }); }}
              >
                Por litros
              </button>
              <button
                className={modo === 'monto' ? 'activo' : ''}
                onClick={() => { setModo('monto'); set({ cantidadLitros: '' }); }}
              >
                Por monto
              </button>
            </div>
          </div>

          {modo === 'litros' ? (
            <div className="campo">
              <label>Cuántos litros</label>
              <input
                type="number" inputMode="decimal" step="any" min="0"
                value={form.cantidadLitros}
                onChange={(e) => set({ cantidadLitros: e.target.value })}
                placeholder="Ej: 20"
                autoFocus={esEscritorio}
              />
            </div>
          ) : (
            <div className="campo">
              <label>Cuánta plata</label>
              <input
                type="number" inputMode="decimal" step="any" min="0"
                value={form.montoPedido}
                onChange={(e) => set({ montoPedido: e.target.value })}
                placeholder="Ej: 5000"
                autoFocus={esEscritorio}
              />
              {litros > 0 && (
                <div className="panel-destacado" style={{ backgroundColor: 'var(--success)', marginTop: 10 }}>
                  <div className="etiqueta">Cargale</div>
                  <div className="valor">{litros.toFixed(2)} L</div>
                </div>
              )}
            </div>
          )}

          {/* Total */}
          <div className="panel-destacado" style={{ backgroundColor: 'var(--blue)', marginBottom: 14 }}>
            <div className="etiqueta">Total</div>
            <div className="valor">{formatearMonto(total)}</div>
          </div>

          {/* Cómo se cobra */}
          <div className="campo">
            <label>Cómo se cobra</label>
            <div className="segmentado">
              {['Efectivo', 'Transferencia', 'Fiado'].map((c) => (
                <button
                  key={c}
                  data-tono={c === 'Fiado' ? 'fiado' : undefined}
                  className={form.cobro === c ? 'activo' : ''}
                  onClick={() => set({ cobro: c, clienteId: null, titularTransferencia: '' })}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Transferencia */}
          {form.cobro === 'Transferencia' && (
            <div className="sub-card campo">
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: 13 }}>
                Quién transfiere
              </label>
              <input
                type="text"
                value={form.titularTransferencia}
                onChange={(e) => set({ titularTransferencia: e.target.value })}
                placeholder="Ej: Juan Pérez"
              />
              <small className="ayuda">Opcional, para después chequear el comprobante</small>
            </div>
          )}

          {/* Fiado: a quién */}
          {esFiado && (
            <div className="sub-card campo">
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: 13 }}>
                A quién se le fía
              </label>
              <select
                value={form.clienteId || ''}
                onChange={(e) => set({ clienteId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Elegir cliente…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.debe > 0.5 ? ` — debe ${formatearMonto(c.debe)}` : ''}
                  </option>
                ))}
              </select>

              {clienteElegido && clienteElegido.debe > 0.5 && (
                <small className="ayuda" style={{ color: 'var(--accent-dark)', fontWeight: 600 }}>
                  Ya debe {formatearMonto(clienteElegido.debe)}. Con esta venta pasaría a{' '}
                  {formatearMonto(clienteElegido.debe + total)}.
                </small>
              )}

              {formCliente === null ? (
                <button
                  onClick={() => setFormCliente({ nombre: '', telefono: '', direccion: '' })}
                  style={{ marginTop: 10, width: '100%', padding: 11, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white' }}
                >
                  + Cliente nuevo
                </button>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <input
                    type="text" placeholder="Nombre" autoFocus
                    value={formCliente.nombre}
                    onChange={(e) => setFormCliente({ ...formCliente, nombre: e.target.value })}
                  />
                  <input
                    type="tel" inputMode="tel" placeholder="Teléfono (opcional)"
                    value={formCliente.telefono}
                    onChange={(e) => setFormCliente({ ...formCliente, telefono: e.target.value })}
                  />
                  <input
                    type="text" placeholder="Dirección (opcional)"
                    value={formCliente.direccion}
                    onChange={(e) => setFormCliente({ ...formCliente, direccion: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setFormCliente(null)}
                      style={{ flex: 1, padding: 11, borderRadius: 'var(--radius)', backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={guardarCliente}
                      disabled={guardandoCliente}
                      style={{ flex: 2, padding: 11, borderRadius: 'var(--radius)', backgroundColor: 'var(--success)', color: 'white' }}
                    >
                      {guardandoCliente ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vuelto */}
          {form.cobro === 'Efectivo' && total > 0 && (
            <div className="sub-card campo">
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: 13 }}>
                Con cuánto paga
              </label>
              <input
                type="number" inputMode="decimal" step="any" min="0"
                value={montoPagado}
                onChange={(e) => setMontoPagado(e.target.value)}
                placeholder="Ej: 10000"
              />
              {montoPagado !== '' && parseFloat(montoPagado) > 0 && (
                <div
                  className="panel-destacado"
                  style={{ marginTop: 10, backgroundColor: vuelto >= 0 ? 'var(--success)' : 'var(--danger)' }}
                >
                  <div className="etiqueta">{vuelto >= 0 ? 'Vuelto' : 'Falta'}</div>
                  <div className="valor">{formatearMonto(Math.abs(vuelto))}</div>
                </div>
              )}
            </div>
          )}

          {problema && (
            <div
              className="sub-card"
              style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 600, fontSize: 14 }}
            >
              {problema}
            </div>
          )}

          <button
            onClick={registrar}
            disabled={!puedeRegistrar}
            style={{
              width: '100%', padding: 16, fontSize: 17, fontWeight: 700,
              borderRadius: 'var(--radius)',
              backgroundColor: esFiado ? 'var(--accent-dark)' : 'var(--success)',
              color: 'white',
            }}
          >
            {registrando ? 'Registrando…' : esFiado ? 'Registrar fiado' : 'Registrar venta'}
          </button>
        </div>

        {/* ══════════ Ventas de hoy ══════════ */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <h2 className="titulo-seccion">Hoy</h2>
            {ventasHoy.length > 0 && (
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                Cobrado <strong style={{ color: 'var(--success)' }}>{formatearMonto(cobradoHoy)}</strong>
                {fiadoHoy > 0 && (
                  <> · Fiado <strong style={{ color: 'var(--accent)' }}>{formatearMonto(fiadoHoy)}</strong></>
                )}
              </div>
            )}
          </div>

          {ventasHoy.length === 0 ? (
            <div className="vacio">{cargando ? 'Cargando…' : 'Todavía no hay ventas hoy'}</div>
          ) : esEscritorio ? (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th><th>Combustible</th><th>Litros</th><th>Total</th>
                    <th>Cobro</th><th>Cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasHoy.map((v) => (
                    <tr key={v.id}>
                      <td>{formatearHora(v.fecha)}</td>
                      <td>{v.tipo_combustible}</td>
                      <td>{v.cantidad_litros.toFixed(2)} L</td>
                      <td><strong>{formatearMonto(v.total)}</strong></td>
                      <td>
                        {v.es_fiado ? (
                          <span className="badge" style={{ backgroundColor: 'var(--accent-dark)' }}>Fiado</span>
                        ) : (
                          <>{v.metodo_pago}{v.titular_transferencia ? ` · ${v.titular_transferencia}` : ''}</>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{v.cliente_nombre || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="lista-tarjetas">
              {ventasHoy.map((v) => (
                <div key={v.id} className="venta-tarjeta">
                  <div className="fila">
                    <strong style={{ fontSize: 16 }}>{formatearMonto(v.total)}</strong>
                    {v.es_fiado ? (
                      <span className="badge" style={{ backgroundColor: 'var(--accent-dark)' }}>Fiado</span>
                    ) : (
                      <span className="badge" style={{ backgroundColor: 'var(--success)' }}>{v.metodo_pago}</span>
                    )}
                  </div>
                  <div className="detalle">
                    {formatearHora(v.fecha)} · {v.tipo_combustible} · {v.cantidad_litros.toFixed(2)} L
                    {v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
