import { useEffect, useMemo, useState } from 'react';
import { combustiblesAPI, clientesAPI, ventasAPI, cajaAPI } from '../lib/api.js';
import { formatearMonto, formatearHora, esHoy } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { useEsEscritorio } from '../hooks/useAncho.js';

const FORM_VACIO = {
  combustibleId: null, // se completa con el primero del catálogo
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

  const [combustibles, setCombustibles] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [caja, setCaja] = useState(null);
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
      const [cbs, c, v, cj] = await Promise.all([
        combustiblesAPI.obtenerTodos(),
        clientesAPI.obtenerTodos(),
        ventasAPI.obtenerTodas(),
        cajaAPI.obtenerCajaAbierta(),
      ]);
      setCombustibles(cbs);
      setClientes(c);
      setVentasHoy(v.filter((x) => esHoy(x.fecha)));
      setCaja(cj);
      // Si todavía no hay uno elegido, arrancar por el primero
      setForm((f) => (f.combustibleId ? f : { ...f, combustibleId: cbs[0]?.id ?? null }));
    } catch (e) {
      mostrar(`No se pudieron cargar los datos: ${e.message}`, 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  // ── Derivados ─────────────────────────────────────────────
  const combustible = combustibles.find((c) => c.id === form.combustibleId);
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
    if (!combustible) return cargando ? null : 'No hay ningún combustible cargado. Agregalo en Stock.';
    if (precio <= 0) return `No hay precio cargado para ${combustible.nombre}`;
    if (litros <= 0) return null; // todavía no cargó nada, no es un error
    if (litros > disponible) return `Solo quedan ${disponible.toFixed(2)} litros de ${combustible.nombre}`;
    if (esFiado && !form.clienteId) return 'Elegí a quién se le fía';
    return null;
  }, [combustible, cargando, precio, litros, disponible, esFiado, form.clienteId]);

  const puedeRegistrar = litros > 0 && !problema && !registrando;

  const clienteElegido = clientes.find((c) => c.id === form.clienteId);
  const cobradoHoy = ventasHoy.filter((v) => !v.es_fiado).reduce((s, v) => s + v.total, 0);
  const fiadoHoy = ventasHoy.filter((v) => v.es_fiado).reduce((s, v) => s + v.total, 0);

  // ── Acciones ──────────────────────────────────────────────
  const registrar = async () => {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    try {
      // Sin caja abierta la venta quedaria fuera de todo cierre. En vez
      // de frenarlo con un cliente esperando, se abre acá mismo: el
      // control se consigue igual y nunca hay una venta sin registrar.
      if (!caja) {
        await cajaAPI.abrirCaja('Abierta al registrar una venta');
      }

      await ventasAPI.registrar({
        clienteId: esFiado ? form.clienteId : null,
        combustibleId: form.combustibleId,
        cantidadLitros: redondearLitros(litros),
        precioPorLitro: precio,
        esFiado,
        metodoPago: esFiado ? null : form.cobro,
        titularTransferencia: form.cobro === 'Transferencia' ? form.titularTransferencia : null,
      });
      mostrar(`Venta registrada · ${formatearMonto(total)}`);
      setForm({ ...FORM_VACIO, combustibleId: form.combustibleId });
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
            {cargando ? (
              <div className="vacio" style={{ padding: 16 }}>Cargando…</div>
            ) : combustibles.length === 0 ? (
              <div className="vacio" style={{ padding: 16 }}>
                No hay combustibles cargados.<br />Agregalos desde la pantalla de Stock.
              </div>
            ) : (
              <div className="grilla-combustibles">
                {combustibles.map((c) => {
                  const vacio = c.cantidad_litros <= 0;
                  return (
                    <button
                      key={c.id}
                      className={`chip-combustible ${form.combustibleId === c.id ? 'activo' : ''}`}
                      onClick={() => set({ combustibleId: c.id })}
                      disabled={vacio}
                      title={vacio ? 'Sin stock' : undefined}
                    >
                      <span className="nombre">{c.nombre}</span>
                      <span className="precio">{formatearMonto(c.precio_por_litro)}/L</span>
                      <span className="stock">
                        {vacio ? 'sin stock' : `${c.cantidad_litros.toFixed(1)} L`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
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
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
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
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
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
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
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
              style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 600, fontSize: '0.875rem' }}
            >
              {problema}
            </div>
          )}

          {/* Sin caja abierta la venta no entraría en ningún cierre.
              Se avisa, pero el mismo botón abre la caja y registra. */}
          {!cargando && !caja && (
            <div className="sub-card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
              <strong style={{ color: 'var(--accent)' }}>No hay caja abierta</strong>
              <div style={{ fontSize: '0.8438rem', color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.45 }}>
                Se va a abrir ahora junto con esta venta, así queda dentro del turno.
              </div>
            </div>
          )}

          <button
            onClick={registrar}
            disabled={!puedeRegistrar}
            style={{
              width: '100%', padding: 16, fontSize: '1.0625rem', fontWeight: 700,
              borderRadius: 'var(--radius)',
              backgroundColor: esFiado ? 'var(--accent-dark)' : 'var(--success)',
              color: 'white',
            }}
          >
            {registrando
              ? 'Registrando…'
              : !caja
                ? (esFiado ? 'Abrir caja y registrar fiado' : 'Abrir caja y registrar venta')
                : (esFiado ? 'Registrar fiado' : 'Registrar venta')}
          </button>
        </div>

        {/* ══════════ Ventas de hoy ══════════ */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <h2 className="titulo-seccion">Hoy</h2>
            {ventasHoy.length > 0 && (
              <div style={{ fontSize: '0.8438rem', color: 'var(--text-secondary)' }}>
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
                      <td>{v.combustible_nombre}</td>
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
                    <strong style={{ fontSize: '1rem' }}>{formatearMonto(v.total)}</strong>
                    {v.es_fiado ? (
                      <span className="badge" style={{ backgroundColor: 'var(--accent-dark)' }}>Fiado</span>
                    ) : (
                      <span className="badge" style={{ backgroundColor: 'var(--success)' }}>{v.metodo_pago}</span>
                    )}
                  </div>
                  <div className="detalle">
                    {formatearHora(v.fecha)} · {v.combustible_nombre} · {v.cantidad_litros.toFixed(2)} L
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
