import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { AjustesProvider, useAjustes } from './hooks/useAjustes.jsx';
import { Login } from './components/Login.jsx';
import { Ventas } from './components/Ventas.jsx';
import { Clientes } from './components/Clientes.jsx';
import { Stock } from './components/Stock.jsx';
import { Caja } from './components/Caja.jsx';
import { Reportes } from './components/Reportes.jsx';
import { Inicio } from './components/Inicio.jsx';

const SECCIONES = [
  { id: 'ventas',   etiqueta: 'Ventas',   icono: '⛽' },
  { id: 'inicio',   etiqueta: 'Inicio',   icono: '🏠' },
  { id: 'stock',    etiqueta: 'Stock',    icono: '📦' },
  { id: 'clientes', etiqueta: 'Clientes', icono: '👥' },
  { id: 'reportes', etiqueta: 'Reportes', icono: '📊' },
  { id: 'caja',     etiqueta: 'Caja',     icono: '🏦' },
];

function AppAutenticada() {
  const { tema, alternarTema, escalaActual, siguienteEscala } = useAjustes();
  const [seccion, setSeccion] = useState('ventas');

  return (
    <>
      <header className="app-header">
        <div className="app-marca">
          <span>⛽</span>
          <span className="nombre">Gestión Combustibles</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="theme-toggle"
            onClick={siguienteEscala}
            title={`Tamaño de letra: ${escalaActual.etiqueta}`}
            aria-label={`Tamaño de letra: ${escalaActual.etiqueta}. Tocar para cambiar.`}
          >
            <span style={{ fontSize: '0.75rem' }}>A</span>
            <span style={{ fontSize: '1.05rem', marginLeft: 1 }}>A</span>
          </button>
          <button className="theme-toggle" onClick={alternarTema} title="Cambiar tema">
            {tema === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            className="theme-toggle"
            onClick={() => supabase.auth.signOut()}
            title="Salir"
          >
            Salir
          </button>
        </div>
      </header>

      <nav className="app-nav">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            className={`nav-btn ${seccion === s.id ? 'activo' : ''}`}
            onClick={() => setSeccion(s.id)}
          >
            <span className="icono">{s.icono}</span>
            <span>{s.etiqueta}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">
        {seccion === 'ventas' ? (
          <Ventas />
        ) : seccion === 'clientes' ? (
          <Clientes />
        ) : seccion === 'stock' ? (
          <Stock />
        ) : seccion === 'caja' ? (
          <Caja />
        ) : seccion === 'reportes' ? (
          <Reportes />
        ) : (
          <Inicio irA={setSeccion} />
        )}
      </main>
    </>
  );
}

export default function App() {
  const [sesion, setSesion] = useState(undefined); // undefined = todavía no sabemos

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AjustesProvider>
      {sesion === undefined ? (
        <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
          Cargando…
        </div>
      ) : sesion ? (
        <AppAutenticada />
      ) : (
        <Login />
      )}
    </AjustesProvider>
  );
}
