import { RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { locale, t } from "./i18n";

export default function DgxOfflineNotice({ since, onRetry, variant = "banner" }: { since?: number | null; onRetry?: () => void; variant?: "banner" | "card" }) {
  const [retrying, setRetrying] = useState(false);
  const time = since ? new Date(since).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
  function retry() {
    if (!onRetry) return;
    setRetrying(true);
    onRetry();
    window.setTimeout(() => setRetrying(false), 1200);
  }
  return (
    <div className={`dgx-offline ${variant}`} role="status" aria-live="polite">
      <div className="dgx-offline-icon" aria-hidden="true"><Unplug size={variant === "card" ? 26 : 20} /></div>
      <div className="dgx-offline-copy">
        <strong>{t("DGX desconectado")}</strong>
        <span>
          {t("No hay respuesta del DGX. Puede estar apagado, reiniciándose o fuera de la red.")}
          {time ? ` ${t("Sin conexión desde las {time}.", { time })}` : ""}
        </span>
        <small><i className="dgx-offline-pulse" />{t("Reintentando automáticamente…")}</small>
      </div>
      {onRetry && (
        <button type="button" onClick={retry} disabled={retrying}>
          <RefreshCw size={15} className={retrying ? "spin" : ""} />{t("Reintentar ahora")}
        </button>
      )}
    </div>
  );
}
