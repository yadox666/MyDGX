import { FormEvent, useCallback, useEffect, useState } from "react";
import { Cpu, Eye, EyeOff, LockKeyhole, RefreshCw } from "lucide-react";
import App from "./App";

type AuthStatus = {
  required: boolean;
  authenticated: boolean;
  expires_in_seconds: number;
  session_ttl_minutes: number;
};

export default function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("No se pudo comprobar la sesión");
      setStatus(await response.json() as AuthStatus);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashboard no disponible");
    }
  }, []);

  useEffect(() => {
    const systemTheme = matchMedia("(prefers-color-scheme: dark)");
    const applySelectedTheme = () => {
      const selected = localStorage.getItem("mydgx-theme");
      document.documentElement.dataset.theme = selected === "light" || selected === "dark"
        ? selected
        : (systemTheme.matches ? "dark" : "light");
    };
    const syncAcrossWindows = (event: StorageEvent) => {
      if (event.key === "mydgx-theme") applySelectedTheme();
    };
    applySelectedTheme();
    systemTheme.addEventListener("change", applySelectedTheme);
    window.addEventListener("storage", syncAcrossWindows);
    const timer = window.setTimeout(() => void refreshStatus(), 0);
    return () => {
      window.clearTimeout(timer);
      systemTheme.removeEventListener("change", applySelectedTheme);
      window.removeEventListener("storage", syncAcrossWindows);
    };
  }, [refreshStatus]);

  useEffect(() => {
    const requireLogin = () => setStatus({
      required: true,
      authenticated: false,
      expires_in_seconds: 0,
      session_ttl_minutes: status?.session_ttl_minutes || 60,
    });
    window.addEventListener("mydgx-auth-required", requireLogin);
    return () => window.removeEventListener("mydgx-auth-required", requireLogin);
  }, [status?.session_ttl_minutes]);

  useEffect(() => {
    if (!status?.required || !status.authenticated) return;
    const timer = window.setTimeout(() => {
      setStatus({ required: true, authenticated: false, expires_in_seconds: 0, session_ttl_minutes: status.session_ttl_minutes });
    }, Math.max(1, status.expires_in_seconds) * 1000);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [refreshStatus, status]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({})) as AuthStatus & { detail?: string };
      if (!response.ok) throw new Error(body.detail || "No se pudo iniciar sesión");
      setPassword("");
      setStatus(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setStatus({ required: true, authenticated: false, expires_in_seconds: 0, session_ttl_minutes: status?.session_ttl_minutes || 60 });
      setPassword("");
    }
  }

  if (status?.authenticated) {
    return <App onLogout={status.required ? () => void logout() : undefined} />;
  }

  return <main className="auth-shell">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand">
        <div className="auth-logo"><Cpu size={28} /></div>
        <div><strong>MyDGX</strong><span>SPARK CONTROL</span></div>
      </div>
      <div className="auth-lock"><LockKeyhole size={26} /></div>
      <div className="auth-copy">
        <span>ACCESO SEGURO</span>
        <h1 id="auth-title">{status ? "Inicia sesión" : "Conectando…"}</h1>
        <p>{status ? `Introduce la contraseña del dashboard. La sesión se cerrará automáticamente después de ${status.session_ttl_minutes} minutos.` : "Comprobando el estado del dashboard."}</p>
      </div>
      {status ? <form className="auth-form" onSubmit={login}>
        <label htmlFor="dashboard-password">Contraseña</label>
        <div className="auth-password">
          <LockKeyhole size={17} />
          <input
            id="dashboard-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            placeholder="Contraseña del dashboard"
          />
          <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={!password || submitting} type="submit">
          {submitting ? <RefreshCw className="spin" size={17} /> : <LockKeyhole size={17} />}
          {submitting ? "Comprobando…" : "Entrar en MyDGX"}
        </button>
      </form> : <div className="auth-loading">
        <RefreshCw className="spin" size={20} />
        {error && <><span role="alert">{error}</span><button onClick={() => void refreshStatus()}>Reintentar</button></>}
      </div>}
      <footer><span /><small>Sesión privada · Cookie HttpOnly · {status?.session_ttl_minutes || 60} min</small><span /></footer>
    </section>
    <div className="auth-orb auth-orb-one" />
    <div className="auth-orb auth-orb-two" />
  </main>;
}
