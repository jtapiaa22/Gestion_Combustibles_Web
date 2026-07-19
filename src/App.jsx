// Placeholder: las pantallas se migran en el próximo paso.
// Por ahora sirve para verificar que la capa de datos compila y conecta.
import { useEffect, useState } from 'react';
import { stockAPI, clientesAPI } from './lib/api';
import { formatearMonto } from './lib/fechas';

export default function App() {
  const [stock, setStock] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([stockAPI.obtenerTodo(), clientesAPI.obtenerTodos()]);
        setStock(s);
        setClientes(c);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  const conDeuda = clientes.filter((c) => c.deuda_real > 0.5);
  const totalDeuda = conDeuda.reduce((s, c) => s + c.deuda_real, 0);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>Gestión Combustibles</h1>
      <p style={{ color: '#71717a' }}>Verificación de la capa de datos unificada.</p>

      {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}

      <h2>Stock</h2>
      <ul>
        {stock.map((s) => (
          <li key={s.id}>
            {s.tipo_combustible}: {s.cantidad_litros?.toFixed(2)} L a {formatearMonto(s.precio_por_litro)}/L
          </li>
        ))}
      </ul>

      <h2>Deuda viva</h2>
      <p>
        {conDeuda.length} clientes · <strong>{formatearMonto(totalDeuda)}</strong>
      </p>
    </main>
  );
}
