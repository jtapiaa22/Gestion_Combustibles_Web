import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState(null);

  const entrar = async (e) => {
    e.preventDefault();
    setEntrando(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'El mail o la contraseña no son correctos'
        : error.message);
      setEntrando(false);
    }
    // Si entra bien, onAuthStateChange en App se encarga del resto.
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <form onSubmit={entrar} className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 38 }}>⛽</div>
          <h1 className="titulo-seccion" style={{ fontSize: 19, marginTop: 6 }}>Gestión Combustibles</h1>
        </div>

        <div className="campo">
          <label htmlFor="email">Mail</label>
          <input
            id="email" type="email" inputMode="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </div>

        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </div>

        {error && (
          <div className="sub-card" style={{ marginBottom: 14, borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 600, fontSize: 14 }}>
            {error}
          </div>
        )}

        <button
          type="submit" disabled={entrando}
          style={{ width: '100%', padding: 15, fontSize: 16, fontWeight: 700, borderRadius: 'var(--radius)', backgroundColor: 'var(--accent)', color: '#1C1917' }}
        >
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>

        <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
          Queda la sesión iniciada: no hace falta volver a entrar.
        </p>
      </form>
    </div>
  );
}
