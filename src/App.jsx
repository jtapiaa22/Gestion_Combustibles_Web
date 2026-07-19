import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { TemaProvider, useTema } from './hooks/useTema.jsx';
import { Login } from './components/Login.jsx';
import { Ventas } from './components/Ventas.jsx';

const SECCIONES = [
  { id: 'ventas',   etiqueta: 'Ventas',   icono: '⛽' },
  { id: 'inicio',   etiqueta: 'Inicio',   icono: '🏠' },
  { id: 'stock',    etiqueta: 'Stock',    icono: '📦' },
  { id: 'clientes', etiqueta: 'Clientes', icono: '👥' },
  { id: 'reportes', etiqueta: 'Reportes', icono: '📊' },
  { id: 'caja',     etiqueta: 'Caja',     icono: '🏦' },
];

function EnConstruccion({ nombre }) {
  return (
    <div className="vacio" style={{ marginTop: 30 }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>🚧</div>
      <strong>{nombre}</strong> todavía no está migrada.<br />
      Seguí usando la app vieja para esta parte.
    </div>
  );
}

function AppAutenticada() {
  const { tema, alternar } = useTema();
  const [seccion, setSeccion] = useState('ventas');

  return (
    <>
      <header className="app-header">
        <div className="app-marca">
          <span>⛽</span>
          <span className="nombre">Gestión Combustibles</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="theme-toggle" onClick={alternar} title="Cambiar tema">
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
        ) : (
          <EnConstruccion nombre={SECCIONES.find((s) => s.id === seccion)?.etiqueta} />
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
    <TemaProvider>
      {sesion === undefined ? (
        <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
          Cargando…
        </div>
      ) : sesion ? (
        <AppAutenticada />
      ) : (
        <Login />
      )}
    </TemaProvider>
  );
}
