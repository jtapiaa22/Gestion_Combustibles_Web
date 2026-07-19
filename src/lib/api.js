// ══════════════════════════════════════════════════════════════
//  api.js — Capa de datos única (antes duplicada en tres lugares:
//  la app móvil, database/db.js y los 36 handlers IPC de Electron).
//
//  Donde las dos implementaciones diferían, quedó la correcta. Cada
//  una de esas decisiones está marcada con un comentario ELEGIDO.
// ══════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { ahora, arAUTC, inicioDelDia, finDelDia } from './fechas';

// `pagado` es boolean nativo. La app de PC lo normalizaba a 0/1 para
// su UI; eso se va, y la UI compara contra booleans.
const conNombreCliente = (filas) =>
  (filas || []).map(({ clientes, ...v }) => ({
    ...v,
    cliente_nombre: clientes?.nombre || null,
  }));

const alzar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// ── STOCK ───────────────────────────────────────────────────
export const stockAPI = {
  obtenerTodo: async () =>
    alzar(await supabase.from('stock').select('*').order('tipo_combustible')),

  obtenerPorTipo: async (tipo) =>
    alzar(await supabase.from('stock').select('*').eq('tipo_combustible', tipo).single()),

  // TODO: esto es un read-modify-write. Con un solo usuario no hay
  // problema, pero lo correcto es una función RPC que incremente en
  // el servidor de forma atómica. Anotado para la etapa de esquema.
  actualizarCantidad: async (tipo, delta) => {
    const actual = alzar(
      await supabase.from('stock').select('cantidad_litros').eq('tipo_combustible', tipo).single()
    );
    return alzar(
      await supabase
        .from('stock')
        .update({
          cantidad_litros: (actual?.cantidad_litros || 0) + delta,
          ultima_actualizacion: ahora(),
        })
        .eq('tipo_combustible', tipo)
        .select()
    );
  },

  /**
   * Cambiar el precio revalúa las deudas vivas: un fiado está
   * denominado en litros, no en pesos. Si sube la nafta, el que debe
   * 20 litros pasa a deber más plata.
   */
  actualizarPrecio: async (tipo, precio) => {
    const actualizado = alzar(
      await supabase
        .from('stock')
        .update({ precio_por_litro: precio, ultima_actualizacion: ahora() })
        .eq('tipo_combustible', tipo)
        .select()
    );

    const fiados = alzar(
      await supabase.from('ventas').select('*').eq('tipo_combustible', tipo).eq('pagado', false)
    );

    for (const fiado of fiados || []) {
      const nuevoOriginal = fiado.cantidad_litros * precio;
      const yaPagado = (fiado.total_original || 0) - fiado.total;
      const nuevoTotal = Math.max(0, nuevoOriginal - yaPagado);
      const diferencia = nuevoTotal - fiado.total;

      await supabase
        .from('ventas')
        .update({
          precio_por_litro: precio,
          total_original: nuevoOriginal,
          total: nuevoTotal,
          pagado: nuevoTotal <= 0,
        })
        .eq('id', fiado.id);

      if (fiado.cliente_id && Math.abs(diferencia) > 0.001) {
        await clientesAPI._ajustarDeuda(fiado.cliente_id, diferencia);
      }
    }

    return actualizado;
  },
};

// ── CLIENTES ────────────────────────────────────────────────
export const clientesAPI = {
  // ELEGIDO: la versión del móvil. La de PC hacía una query por
  // cliente (N+1); con 57 clientes eran 58 viajes a la base.
  obtenerTodos: async () => {
    const clientes = alzar(await supabase.from('clientes').select('*').order('nombre'));
    const ventas = alzar(
      await supabase.from('ventas').select('id, cliente_id, pagado, total, total_original')
    );

    return clientes.map((c) => {
      const suyas = (ventas || []).filter((v) => v.cliente_id === c.id);
      return {
        ...c,
        total_compras: suyas.length,
        total_pagado: suyas.filter((v) => v.pagado).reduce((s, v) => s + (v.total_original || 0), 0),
        // Deuda derivada de las ventas impagas. La columna `debe`
        // sigue existiendo por ahora, pero esta es la fuente de
        // verdad: es la que no se puede desincronizar.
        deuda_real: suyas.filter((v) => !v.pagado).reduce((s, v) => s + (v.total || 0), 0),
      };
    });
  },

  agregar: async (nombre, telefono, direccion) => {
    const data = alzar(
      await supabase
        .from('clientes')
        .insert({ nombre: nombre.trim(), telefono: telefono || null, direccion: direccion || null })
        .select()
        .single()
    );
    return { id: data.id, lastInsertRowid: data.id, ...data };
  },

  buscar: async (nombre) =>
    alzar(await supabase.from('clientes').select('*').ilike('nombre', `%${nombre}%`).order('nombre')),

  obtenerHistorial: async (clienteId) =>
    alzar(
      await supabase.from('ventas').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })
    ),

  eliminar: async (clienteId) => {
    // Borrar un cliente con deuda viva le hace desaparecer plata de
    // los libros sin dejar rastro. Que la UI avise antes.
    const impagas = alzar(
      await supabase.from('ventas').select('id, total').eq('cliente_id', clienteId).eq('pagado', false)
    );
    const deuda = (impagas || []).reduce((s, v) => s + (v.total || 0), 0);
    if (deuda > 0.5) {
      throw new Error(`Este cliente todavía debe $${Math.round(deuda).toLocaleString('es-AR')}. Saldá la deuda antes de borrarlo.`);
    }

    await supabase.from('pagos_fiado').delete().eq('cliente_id', clienteId);
    await supabase.from('ventas').delete().eq('cliente_id', clienteId);
    alzar(await supabase.from('clientes').delete().eq('id', clienteId));
  },

  /** Uso interno. `debe` es un contador incremental y por eso derivó
   *  $32.400 en producción. Está para irse en la etapa de esquema. */
  _ajustarDeuda: async (clienteId, delta) => {
    if (!clienteId || !delta) return;
    const cl = alzar(await supabase.from('clientes').select('debe').eq('id', clienteId).single());
    await supabase
      .from('clientes')
      .update({ debe: Math.max(0, (cl?.debe || 0) + delta) })
      .eq('id', clienteId);
  },
};

// ── VENTAS ──────────────────────────────────────────────────
export const ventasAPI = {
  registrar: async ({
    clienteId, tipoCombustible, cantidadLitros, precioPorLitro,
    total, metodoPago, pagado, titularTransferencia,
  }) => {
    const venta = alzar(
      await supabase
        .from('ventas')
        .insert({
          cliente_id: clienteId || null,
          tipo_combustible: tipoCombustible,
          cantidad_litros: cantidadLitros,
          precio_por_litro: precioPorLitro,
          total,
          total_original: total,
          metodo_pago: metodoPago,
          titular_transferencia: titularTransferencia || null,
          pagado: !!pagado,
          fecha: ahora(), // UTC real, no la hora local disfrazada de antes
        })
        .select()
        .single()
    );

    await stockAPI.actualizarCantidad(tipoCombustible, -cantidadLitros);
    if (!pagado && clienteId) await clientesAPI._ajustarDeuda(clienteId, total);

    return { ...venta, lastInsertRowid: venta.id };
  },

  obtenerTodas: async () =>
    conNombreCliente(
      alzar(await supabase.from('ventas').select('*, clientes(nombre)').order('fecha', { ascending: false }))
    ),

  obtenerPorFecha: async (inicio, fin) =>
    conNombreCliente(
      alzar(
        await supabase
          .from('ventas')
          .select('*, clientes(nombre)')
          .gte('fecha', inicioDelDia(inicio))
          .lte('fecha', finDelDia(fin))
          .order('fecha', { ascending: false })
      )
    ),

  obtenerPendientes: async () =>
    conNombreCliente(
      alzar(
        await supabase
          .from('ventas')
          .select('*, clientes(nombre)')
          .eq('pagado', false)
          .order('fecha', { ascending: false })
      )
    ),

  // ELEGIDO: la versión de PC. La del móvil sumaba `total`, que para
  // un fiado ya cobrado vale 0 — o sea que se comía toda la
  // facturación de fiados del total histórico.
  obtenerTotal: async () => {
    const data = alzar(await supabase.from('ventas').select('total_original').eq('pagado', true));
    return { total: data.reduce((s, v) => s + (v.total_original || 0), 0) };
  },

  obtenerTotalesPorMetodo: async () => {
    const data = alzar(
      await supabase.from('ventas').select('metodo_pago, total_original').eq('pagado', true)
    );
    const porMetodo = {};
    for (const v of data) {
      porMetodo[v.metodo_pago] ??= { metodo_pago: v.metodo_pago, total: 0, cantidad: 0 };
      porMetodo[v.metodo_pago].total += v.total_original || 0;
      porMetodo[v.metodo_pago].cantidad++;
    }
    return Object.values(porMetodo);
  },

  // ELEGIDO: la versión de PC, que valida. La del móvil dejaba pagar
  // más que la deuda: la venta quedaba en 0 pero al cliente se le
  // descontaba el monto entero, y la diferencia se evaporaba.
  registrarPagoParcial: async (ventaId, clienteId, montoPagado, metodoPago, titularTransferencia) => {
    const venta = alzar(await supabase.from('ventas').select('*').eq('id', ventaId).single());
    if (!venta) throw new Error('Venta no encontrada');
    if (montoPagado > venta.total + 0.001) {
      throw new Error('El monto supera la deuda restante de esta venta');
    }

    const nuevoTotal = Math.max(0, venta.total - montoPagado);
    const saldado = nuevoTotal <= 0.001;

    await supabase.from('pagos_fiado').insert({
      venta_id: ventaId, cliente_id: clienteId, monto: montoPagado,
      metodo_pago: metodoPago, titular_transferencia: titularTransferencia || null,
      fecha: ahora(),
    });

    await supabase
      .from('ventas')
      .update({ total: nuevoTotal, pagado: saldado, metodo_pago: saldado ? metodoPago : venta.metodo_pago })
      .eq('id', ventaId);

    await clientesAPI._ajustarDeuda(clienteId, -montoPagado);
    return { saldado, totalRestante: nuevoTotal };
  },

  // ELEGIDO: la de PC, que lee el pendiente real de la base. La del
  // móvil confiaba en el total que le mandaba la pantalla, que podía
  // estar desactualizado si alguien había cobrado algo en el medio.
  marcarPagada: async (ventaId, clienteId, _total, metodoPago, titularTransferencia) => {
    const venta = alzar(await supabase.from('ventas').select('*').eq('id', ventaId).single());
    if (!venta) throw new Error('Venta no encontrada');
    const pendiente = venta.total;

    await supabase.from('ventas').update({ pagado: true, total: 0, metodo_pago: metodoPago }).eq('id', ventaId);

    await supabase.from('pagos_fiado').insert({
      venta_id: ventaId, cliente_id: clienteId, monto: pendiente,
      metodo_pago: metodoPago, titular_transferencia: titularTransferencia || null,
      fecha: ahora(),
    });

    await clientesAPI._ajustarDeuda(clienteId, -pendiente);
    return { ok: true, montoAplicado: pendiente };
  },

  /** Salda la deuda del cliente de la más vieja a la más nueva. */
  pagarDeudaCliente: async (clienteId, montoPagado, metodoPago, titularTransferencia) => {
    const fiados = alzar(
      await supabase
        .from('ventas')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('pagado', false)
        .order('fecha', { ascending: true })
    );
    if (!fiados?.length) throw new Error('El cliente no tiene deudas pendientes');

    const fechaPago = ahora();
    let restante = montoPagado;
    const saldadas = [];
    const parciales = [];

    for (const fiado of fiados) {
      if (restante <= 0.001) break;
      const aplicado = Math.min(restante, fiado.total);
      const nuevoTotal = fiado.total - aplicado;
      const saldado = nuevoTotal <= 0.001;

      await supabase.from('pagos_fiado').insert({
        venta_id: fiado.id, cliente_id: clienteId, monto: aplicado,
        metodo_pago: metodoPago, titular_transferencia: titularTransferencia || null,
        fecha: fechaPago,
      });

      await supabase
        .from('ventas')
        .update({ total: saldado ? 0 : nuevoTotal, pagado: saldado, metodo_pago: saldado ? metodoPago : fiado.metodo_pago })
        .eq('id', fiado.id);

      (saldado ? saldadas : parciales).push(fiado.id);
      restante -= aplicado;
    }

    const aplicadoTotal = montoPagado - restante;
    await clientesAPI._ajustarDeuda(clienteId, -aplicadoTotal);

    return {
      montoAplicado: aplicadoTotal,
      ventasSaldadas: saldadas,
      ventasParciales: parciales,
      // Si pagó de más, la UI tiene que avisarlo en vez de tragárselo.
      sobrante: restante > 0.001 ? restante : 0,
    };
  },

  obtenerPagosFiado: async (ventaId) =>
    alzar(await supabase.from('pagos_fiado').select('*').eq('venta_id', ventaId).order('fecha', { ascending: false })),

  // ELEGIDO: la de PC. La del móvil sólo hacía UPDATE de la fila —
  // no devolvía litros al tanque ni corregía la deuda. Editar una
  // venta desde el teléfono descuadraba el stock para siempre.
  editar: async (ventaId, datos) => {
    const anterior = alzar(await supabase.from('ventas').select('*').eq('id', ventaId).single());
    if (!anterior) throw new Error('Venta no encontrada');

    const { tipoCombustible, cantidadLitros, precioPorLitro, metodoPago, clienteId, pagado } = datos;
    const total = cantidadLitros * precioPorLitro;

    // Stock: devolver lo viejo, descontar lo nuevo
    if (tipoCombustible !== anterior.tipo_combustible) {
      await stockAPI.actualizarCantidad(anterior.tipo_combustible, anterior.cantidad_litros);
      await stockAPI.actualizarCantidad(tipoCombustible, -cantidadLitros);
    } else {
      await stockAPI.actualizarCantidad(tipoCombustible, anterior.cantidad_litros - cantidadLitros);
    }

    // Deuda: revertir la anterior, aplicar la nueva
    if (!anterior.pagado && anterior.cliente_id) {
      await clientesAPI._ajustarDeuda(anterior.cliente_id, -anterior.total);
    }
    if (!pagado && clienteId) {
      await clientesAPI._ajustarDeuda(clienteId, total);
    }

    alzar(
      await supabase
        .from('ventas')
        .update({
          cliente_id: clienteId || null,
          tipo_combustible: tipoCombustible,
          cantidad_litros: cantidadLitros,
          precio_por_litro: precioPorLitro,
          total,
          total_original: total,
          metodo_pago: metodoPago,
          pagado: !!pagado,
        })
        .eq('id', ventaId)
    );
  },

  // ELEGIDO: la de PC, por lo mismo que `editar`. Borrar desde el
  // teléfono no devolvía los litros ni bajaba la deuda.
  eliminar: async (ventaId) => {
    const venta = alzar(await supabase.from('ventas').select('*').eq('id', ventaId).single());
    if (!venta) throw new Error('Venta no encontrada');

    await stockAPI.actualizarCantidad(venta.tipo_combustible, venta.cantidad_litros);
    if (!venta.pagado && venta.cliente_id) {
      await clientesAPI._ajustarDeuda(venta.cliente_id, -venta.total);
    }

    await supabase.from('pagos_fiado').delete().eq('venta_id', ventaId);
    alzar(await supabase.from('ventas').delete().eq('id', ventaId));
  },
};

// ── COMPRAS DE STOCK ────────────────────────────────────────
export const comprasAPI = {
  registrar: async (tipo, cantidad, precioCompra) => {
    const compra = alzar(
      await supabase
        .from('compras_stock')
        .insert({
          tipo_combustible: tipo,
          cantidad_litros: cantidad,
          precio_por_litro_compra: precioCompra,
          total_compra: cantidad * precioCompra,
          fecha: ahora(),
        })
        .select()
        .single()
    );
    await stockAPI.actualizarCantidad(tipo, cantidad);
    return compra;
  },

  obtenerTodas: async () =>
    alzar(await supabase.from('compras_stock').select('*').order('fecha', { ascending: false })),

  obtenerTotalInvertido: async () => {
    const data = alzar(await supabase.from('compras_stock').select('total_compra'));
    return { total: data.reduce((s, c) => s + (c.total_compra || 0), 0) };
  },
};

/** Último precio de compra por tipo — base del cálculo de ganancia. */
const costoPorLitro = async (tipo) => {
  const data = alzar(
    await supabase
      .from('compras_stock')
      .select('precio_por_litro_compra')
      .eq('tipo_combustible', tipo)
      .order('fecha', { ascending: false })
      .limit(1)
  );
  return data?.[0]?.precio_por_litro_compra || 0;
};

// ── CAJA ────────────────────────────────────────────────────

/**
 * Los totales de una sesión, calculados una sola vez.
 * Antes esta misma cuenta estaba copiada en tres funciones distintas
 * y las tres se habían ido separando entre sí.
 */
async function calcularTotales(desdeUTC, hastaUTC) {
  const [ventasRaw, pagosRaw, costoNafta, costoGasoil] = await Promise.all([
    supabase.from('ventas').select('*, clientes(nombre)').gte('fecha', desdeUTC).lte('fecha', hastaUTC).order('fecha', { ascending: false }),
    supabase.from('pagos_fiado').select('*, clientes(nombre)').gte('fecha', desdeUTC).lte('fecha', hastaUTC).order('fecha', { ascending: false }),
    costoPorLitro('Nafta'),
    costoPorLitro('Gasoil'),
  ]);

  const ventas = conNombreCliente(alzar(ventasRaw));
  const pagosFiado = conNombreCliente(alzar(pagosRaw));

  const pagadas = ventas.filter((v) => v.pagado);
  const fiadas = ventas.filter((v) => !v.pagado);
  const montoDe = (v) => v.total_original || v.total || 0;
  const sumar = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

  const totalEfectivo = sumar(pagadas.filter((v) => v.metodo_pago === 'Efectivo'), montoDe);
  const totalTransferencia = sumar(pagadas.filter((v) => v.metodo_pago === 'Transferencia'), montoDe);
  const totalCobrado = totalEfectivo + totalTransferencia;

  const costoVendido = sumar(pagadas, (v) =>
    (v.cantidad_litros || 0) * (v.tipo_combustible === 'Nafta' ? costoNafta : costoGasoil)
  );

  return {
    ventas,
    pagosFiado,
    totalEfectivo,
    totalTransferencia,
    totalCobrado,
    totalFiadoNuevo: sumar(fiadas, montoDe),
    totalFiadoCobrado: sumar(pagosFiado, (p) => p.monto),
    litrosNafta: sumar(ventas.filter((v) => v.tipo_combustible === 'Nafta'), (v) => v.cantidad_litros),
    litrosGasoil: sumar(ventas.filter((v) => v.tipo_combustible === 'Gasoil'), (v) => v.cantidad_litros),
    ganancia: totalCobrado - costoVendido,
    cantidadVentas: ventas.length,
    cantidadFiados: fiadas.length,
  };
}

/**
 * Los límites de la sesión se guardan como fecha + hora locales por
 * separado. Acá se convierten a UTC — y esta conversión es justo la
 * que estaba rota en la app de PC: le aplicaba el offset al límite
 * pero no a las ventas, así que las ventanas nunca coincidían.
 */
const limitesDe = (sesion) => ({
  desde: arAUTC(sesion.fecha_apertura, sesion.hora_apertura, '00'),
  hasta: sesion.fecha_cierre ? arAUTC(sesion.fecha_cierre, sesion.hora_cierre, '59') : ahora(),
});

export const cajaAPI = {
  abrirCaja: async (fecha, hora, notas) => {
    const abierta = alzar(
      await supabase.from('sesiones_caja').select('id').eq('estado', 'abierta').maybeSingle()
    );
    if (abierta) throw new Error('Ya hay una caja abierta');

    const data = alzar(
      await supabase
        .from('sesiones_caja')
        .insert({ fecha_apertura: fecha, hora_apertura: hora, notas_apertura: notas || null, estado: 'abierta' })
        .select()
        .single()
    );
    return { id: data.id };
  },

  cerrarCaja: async (id, fechaCierre, horaCierre, notasCierre) => {
    const sesion = alzar(
      await supabase.from('sesiones_caja').select('*').eq('id', id).eq('estado', 'abierta').maybeSingle()
    );
    if (!sesion) throw new Error('No se encontró la sesión o ya está cerrada');

    const { desde } = limitesDe(sesion);
    const hasta = arAUTC(fechaCierre, horaCierre, '59');
    const t = await calcularTotales(desde, hasta);

    alzar(
      await supabase
        .from('sesiones_caja')
        .update({
          fecha_cierre: fechaCierre,
          hora_cierre: horaCierre,
          notas_cierre: notasCierre || null,
          total_efectivo: t.totalEfectivo,
          total_transferencia: t.totalTransferencia,
          total_fiado_nuevo: t.totalFiadoNuevo,
          total_fiado_cobrado: t.totalFiadoCobrado,
          total_cobrado: t.totalCobrado,
          litros_nafta: t.litrosNafta,
          litros_gasoil: t.litrosGasoil,
          cantidad_ventas: t.cantidadVentas,
          cantidad_ventas_fiado: t.cantidadFiados,
          ganancia: t.ganancia,
          estado: 'cerrada',
        })
        .eq('id', id)
    );
    return { ok: true, ...t };
  },

  obtenerCajaAbierta: async () =>
    alzar(
      await supabase
        .from('sesiones_caja')
        .select('*')
        .eq('estado', 'abierta')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
    ),

  obtenerResumenActual: async (idSesion) => {
    const sesion = alzar(await supabase.from('sesiones_caja').select('*').eq('id', idSesion).maybeSingle());
    if (!sesion) return null;
    const { desde, hasta } = limitesDe(sesion);
    return { sesion, ...(await calcularTotales(desde, hasta)) };
  },

  obtenerDetalle: async (id) => {
    const sesion = alzar(await supabase.from('sesiones_caja').select('*').eq('id', id).maybeSingle());
    if (!sesion) return null;
    const { desde, hasta } = limitesDe(sesion);
    return { sesion, ...(await calcularTotales(desde, hasta)) };
  },

  obtenerHistorial: async () =>
    alzar(await supabase.from('sesiones_caja').select('*').order('id', { ascending: false })),
};
