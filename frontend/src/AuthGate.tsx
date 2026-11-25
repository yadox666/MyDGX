import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Eye, EyeOff, LockKeyhole, RefreshCw } from "lucide-react";
import App from "./App";
import DgxOfflineNotice from "./DgxOfflineNotice";
import { fetchDgx, isDgxOfflineError, useDgxConnection } from "./connection";
import { languageHeader, t } from "./i18n";

type AuthStatus = {
  required: boolean;
  authenticated: boolean;
  expires_in_seconds: number;
  session_ttl_minutes: number;
  session_max_hours?: number;
};

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export default function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const lastActivity = useRef(0);
  const lastRenewal = useRef(0);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetchDgx("/api/auth/status", {
        cache: "no-store",
        headers: languageHeader,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(t("No se pudo comprobar la sesión"));
      setStatus(await response.json() as AuthStatus);
      setError("");
    } catch (requestError) {
      setError(isDgxOfflineError(requestError) ? "" : requestError instanceof Error ? requestError.message : t("Dashboard no disponible"));
    }
  }, []);

  const connection = useDgxConnection();
  useEffect(() => {
    if (connection.online || status) return;
    const timer = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [connection.online, refreshStatus, status]);

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

  const sessionRequired = Boolean(status?.required && status.authenticated);
  const ttlMinutes = status?.session_ttl_minutes || 60;
  useEffect(() => {
    if (!sessionRequired) return;
    lastRenewal.current = Date.now();
    const markActive = () => { lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    // Background polling must not count as activity, or an unattended tab would never expire.
    const renewEveryMs = Math.min(5 * 60_000, ttlMinutes * 60_000 / 3);
    const timer = window.setInterval(async () => {
      if (lastActivity.current <= lastRenewal.current) return;
      lastRenewal.current = Date.now();
      try {
        const response = await fetchDgx("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: languageHeader });
        if (response.ok) setStatus(await response.json() as AuthStatus);
        else if (response.status === 401) window.dispatchEvent(new Event("mydgx-auth-required"));
      } catch {
        // Offline for a moment: the next interval retries while there is activity.
        lastRenewal.current = 0;
      }
    }, renewEveryMs);
    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive));
    };
  }, [sessionRequired, ttlMinutes]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetchDgx("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...languageHeader },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({})) as AuthStatus & { detail?: string };
      if (!response.ok) throw new Error(body.detail || t("No se pudo iniciar sesión"));
      setPassword("");
      setStatus(body);
    } catch (requestError) {
      setError(isDgxOfflineError(requestError) ? "" : requestError instanceof Error ? requestError.message : t("No se pudo iniciar sesión"));
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
        <div><strong>MyDGX</strong><span>{t("SPARK CONTROL")}</span></div>
      </div>
      <div className="auth-lock"><LockKeyhole size={26} /></div>
      <div className="auth-copy">
        <span>{t("ACCESO SEGURO")}</span>
        <h1 id="auth-title">{status ? t("Inicia sesión") : t("Conectando…")}</h1>
        <p>{status ? t("Introduce la contraseña del dashboard. La sesión se cierra tras {session_ttl_minutes} minutos sin actividad y, como máximo, {session_max_hours} horas después de entrar.", { session_ttl_minutes: status.session_ttl_minutes, session_max_hours: status.session_max_hours ?? 12 }) : t("Comprobando el estado del dashboard.")}</p>
      </div>
      {status ? <form className="auth-form" onSubmit={login}>
        <label htmlFor="dashboard-password">{t("Contraseña")}</label>
        <div className="auth-password">
          <LockKeyhole size={17} />
          <input
            id="dashboard-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            placeholder={t("Contraseña del dashboard")}
          />
          <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? t("Ocultar contraseña") : t("Mostrar contraseña")}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {!connection.online && <DgxOfflineNotice since={connection.since} variant="card" />}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={!password || submitting} type="submit">
          {submitting ? <RefreshCw className="spin" size={17} /> : <LockKeyhole size={17} />}
          {submitting ? t("Comprobando…") : t("Entrar en MyDGX")}
        </button>
      </form> : !connection.online ? <DgxOfflineNotice since={connection.since} variant="card" onRetry={() => void refreshStatus()} /> : <div className="auth-loading">
        <RefreshCw className="spin" size={20} />
        {error && <><span role="alert">{error}</span><button onClick={() => void refreshStatus()}>{t("Reintentar")}</button></>}
      </div>}
      <footer><span /><small>{t("Sesión privada · Cookie HttpOnly ·")}{" "}{status?.session_ttl_minutes || 60}{" "}{t("min")}</small><span /></footer>
    </section>
    <div className="auth-orb auth-orb-one" />
    <div className="auth-orb auth-orb-two" />
  </main>;
}
