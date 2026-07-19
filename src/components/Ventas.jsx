import { useEffect, useMemo, useState } from 'react';
import { combustiblesAPI, clientesAPI, ventasAPI, cajaAPI } from '../lib/api.js';
import { formatearMonto, formatearHora, esHoy, hoyAR } from '../lib/fechas.js';
import { useNotificacion } from '../hooks/useNotificacion.jsx';
import { useEsEscritorio } from '../hooks/useAncho.js';

const FORM_VACIO = {
  combustibleId: null, // se completa con el primero del catálogo
  cantidadLitros: '',
  montoPedido: '',
  cobro: 'Efectivo', // Efectivo | Transferencia | Fiado
  clienteId: null,
  titularTransferencia: '',
  dividido: false,     // pagó parte en efectivo y parte por transferencia
  montoEfectivo: '',
  conEntrega: false,   // fiado en el que entrega algo al momento
  montoEntrega: '',
  metodoEntrega: 'Efectivo',
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
  const [pagosHoy, setPagosHoy] = useState([]);
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
      const hoy = hoyAR();
      const [cbs, c, v, pg, cj] = await Promise.all([
        combustiblesAPI.obtenerTodos(),
        clientesAPI.obtenerTodos(),
        ventasAPI.obtenerTodas(),
        ventasAPI.obtenerPagosPorFecha(hoy, hoy),
        cajaAPI.obtenerCajaAbierta(),
      ]);
      setCombustibles(cbs);
      setClientes(c);
      setVentasHoy(v.filter((x) => esHoy(x.fecha)));
      setPagosHoy(pg);
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

  // En el pago dividido se carga el efectivo y el resto va por
  // transferencia: así siempre suman el total exacto y no hay forma de
  // que queden descuadrados.
  const montoEfectivo = parseFloat(form.montoEfectivo) || 0;
  const restoTransferencia = total - montoEfectivo;

  // Fiado con entrega: paga algo al momento y queda debiendo el resto.
  const montoEntrega = esFiado && form.conEntrega ? parseFloat(form.montoEntrega) || 0 : 0;
  const quedaDebiendo = total - montoEntrega;

  const problema = useMemo(() => {
    if (!combustible) return cargando ? null : 'No hay ningún combustible cargado. Agregalo en Stock.';
    if (precio <= 0) return `No hay precio cargado para ${combustible.nombre}`;
    if (litros <= 0) return null; // todavía no cargó nada, no es un error
    if (litros > disponible) return `Solo quedan ${disponible.toFixed(2)} litros de ${combustible.nombre}`;
    if (esFiado && !form.clienteId) return 'Elegí a quién se le fía';
    if (esFiado && form.conEntrega) {
      if (montoEntrega <= 0) return 'Poné cuánto entrega';
      if (quedaDebiendo < 0.01) return 'Si entrega todo no es un fiado: elegí Efectivo o Transferencia';
    }
    if (!esFiado && form.dividido) {
      if (montoEfectivo <= 0) return 'Poné cuánto pagó en efectivo';
      if (restoTransferencia < -0.01) return 'El efectivo no puede superar el total de la venta';
      if (restoTransferencia < 0.01) return 'Si paga todo en efectivo, elegí Efectivo arriba';
    }
    return null;
  }, [combustible, cargando, precio, litros, disponible, esFiado, form.clienteId, form.dividido, montoEfectivo, restoTransferencia, form.conEntrega, montoEntrega, quedaDebiendo]);

  const puedeRegistrar = litros > 0 && !problema && !registrando;

  const clienteElegido = clientes.find((c) => c.id === form.clienteId);
  // Lo cobrado sale de los pagos del día, no del tipo de venta: un
  // fiado con entrega mete plata en el cajón igual. Y lo fiado es lo
  // que quedaron debiendo, no lo que se vendió a crédito.
  const cobradoHoy = pagosHoy.reduce((s, p) => s + p.monto, 0);
  const fiadoHoy = ventasHoy.filter((v) => v.es_fiado).reduce((s, v) => s + v.saldo, 0);

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

      // Un fiado nace sin pagos; una venta al contado nace con el
      // suyo, o con los dos si fue partido.
      const pagos = esFiado
        ? (montoEntrega > 0
            ? [{ metodo: form.metodoEntrega, monto: montoEntrega, titular: form.titularTransferencia }]
            : [])
        : form.dividido
          ? [
              { metodo: 'Efectivo', monto: montoEfectivo },
              { metodo: 'Transferencia', monto: restoTransferencia, titular: form.titularTransferencia },
            ]
          : [{ metodo: form.cobro, monto: total, titular: form.titularTransferencia }];

      await ventasAPI.registrar({
        clienteId: esFiado ? form.clienteId : null,
        combustibleId: form.combustibleId,
        cantidadLitros: redondearLitros(litros),
        precioPorLitro: precio,
        esFiado,
        pagos,
      });
      mostrar(
        esFiado && montoEntrega > 0
          ? `Fiado registrado · entregó ${formatearMonto(montoEntrega)}, queda debiendo ${formatearMonto(quedaDebiendo)}`
          : `Venta registrada · ${formatearMonto(total)}`
      );
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
                  onClick={() => set({ cobro: c, clienteId: null, titularTransferencia: '', dividido: false })}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* El caso común es un solo método y queda en un toque. El
                pago partido es un paso extra, a propósito. */}
            {!esFiado && (
              <button
                onClick={() => set({ dividido: !form.dividido, montoEfectivo: '' })}
                style={{
                  marginTop: 8, background: 'transparent', padding: 0,
                  color: form.dividido ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'underline',
                }}
              >
                {form.dividido ? '← Un solo medio de pago' : 'Pagó parte y parte'}
              </button>
            )}
          </div>

          {/* Pago dividido */}
          {!esFiado && form.dividido && total > 0 && (
            <div className="sub-card campo">
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
                    En efectivo
                  </label>
                  <input
                    type="number" inputMode="decimal" step="any" min="0" autoFocus
                    value={form.montoEfectivo}
                    onChange={(e) => set({ montoEfectivo: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
                    Por transferencia
                  </label>
                  {/* El resto se calcula solo: se carga un número, no dos */}
                  <div
                    style={{
                      padding: '11px 14px', border: '1.5px solid var(--border)',
                      borderRadius: 'var(--radius)', backgroundColor: 'var(--surface-2)',
                      fontSize: '1rem', color: restoTransferencia < 0 ? 'var(--danger)' : 'var(--text)',
                    }}
                  >
                    {formatearMonto(Math.max(0, restoTransferencia))}
                  </div>
                </div>
              </div>
              <small className="ayuda">
                Poné cuánto te dio en efectivo y el resto se toma como transferencia.
              </small>
            </div>
          )}

          {/* Transferencia */}
          {(form.cobro === 'Transferencia' || (form.dividido && !esFiado) || (esFiado && form.conEntrega && form.metodoEntrega === 'Transferencia')) && (
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
                  {formatearMonto(clienteElegido.debe + quedaDebiendo)}.
                </small>
              )}

              {/* Entrega: paga una parte ahora y queda debiendo el resto */}
              <button
                onClick={() => set({ conEntrega: !form.conEntrega, montoEntrega: '' })}
                style={{
                  marginTop: 10, background: 'transparent', padding: 0,
                  color: form.conEntrega ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'underline',
                }}
              >
                {form.conEntrega ? '← Se lleva todo fiado' : 'Paga algo ahora'}
              </button>

              {form.conEntrega && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.8125rem' }}>
                    Cuánto entrega
                  </label>
                  <input
                    type="number" inputMode="decimal" step="any" min="0" autoFocus
                    value={form.montoEntrega}
                    onChange={(e) => set({ montoEntrega: e.target.value })}
                    placeholder={`Menos de ${formatearMonto(total)}`}
                  />
                  <div className="segmentado" style={{ marginTop: 8 }}>
                    {['Efectivo', 'Transferencia'].map((m) => (
                      <button
                        key={m}
                        className={form.metodoEntrega === m ? 'activo' : ''}
                        onClick={() => set({ metodoEntrega: m })}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {montoEntrega > 0 && quedaDebiendo > 0 && (
                    <div
                      className="panel-destacado"
                      style={{ marginTop: 10, backgroundColor: 'var(--accent-dark)' }}
                    >
                      <div className="etiqueta">Queda debiendo</div>
                      <div className="valor">{formatearMonto(quedaDebiendo)}</div>
                    </div>
                  )}
                </div>
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
                          <>{v.metodos_pago}{v.titulares_transferencia ? ` · ${v.titulares_transferencia}` : ''}</>
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
                      <span className="badge" style={{ backgroundColor: 'var(--success)' }}>{v.metodos_pago}</span>
                    )}
                  </div>
                  <div className="detalle">
                    {formatearHora(v.fecha)} · {v.combustible_nombre} · {v.cantidad_litros.toFixed(2)} L
                    {v.cliente_nombre ? ` · ${v.cliente_nombre}` : ''}
                    {v.es_fiado && v.cobrado > 0.01 && (
                      <> · entregó {formatearMonto(v.cobrado)}, debe {formatearMonto(v.saldo)}</>
                    )}
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
