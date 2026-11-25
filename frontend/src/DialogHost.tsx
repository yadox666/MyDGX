import { AlertTriangle, CircleHelp, PencilLine } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { settleDialog, useCurrentDialog, type DialogRequest } from "./dialogs";
import { t } from "./i18n";

function Dialog({ request }: { request: DialogRequest }) {
  const { kind, message, options } = request;
  const danger = options.tone === "danger";
  const [value, setValue] = useState(options.defaultValue ?? "");
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelValue = kind === "prompt" ? null : false;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (kind === "prompt") {
      input.current?.focus();
      input.current?.select();
    } else {
      confirmButton.current?.focus();
    }
    return () => previous?.focus?.();
  }, [kind]);

  function confirm() {
    if (kind === "prompt") {
      if (!value.trim()) return;
      settleDialog(request.id, value);
    } else {
      settleDialog(request.id, true);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      settleDialog(request.id, cancelValue);
    } else if (event.key === "Tab") {
      const focusable = card.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  const Icon = kind === "prompt" ? PencilLine : danger ? AlertTriangle : CircleHelp;
  const title = options.title ?? (kind === "prompt" ? t("Introduce un valor") : danger ? t("Confirma esta acción") : t("¿Continuar?"));
  const confirmLabel = options.confirmLabel ?? (kind === "prompt" ? t("Aceptar") : danger ? t("Sí, continuar") : t("Continuar"));

  return (
    <div className="mydgx-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) settleDialog(request.id, cancelValue); }}>
      <div
        ref={card}
        className={`mydgx-dialog ${danger ? "danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`mydgx-dialog-title-${request.id}`}
        aria-describedby={`mydgx-dialog-message-${request.id}`}
        onKeyDown={onKeyDown}
      >
        <div className="mydgx-dialog-icon" aria-hidden="true"><Icon size={22} /></div>
        <div className="mydgx-dialog-body">
          <h2 id={`mydgx-dialog-title-${request.id}`}>{title}</h2>
          <p id={`mydgx-dialog-message-${request.id}`}>{message}</p>
          {kind === "prompt" && (
            <input
              ref={input}
              value={value}
              maxLength={options.maxLength}
              placeholder={options.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }}
            />
          )}
        </div>
        <div className="mydgx-dialog-actions">
          <button type="button" className="button secondary" onClick={() => settleDialog(request.id, cancelValue)}>{options.cancelLabel ?? t("Cancelar")}</button>
          <button
            ref={confirmButton}
            type="button"
            className={`button ${danger ? "danger" : "primary"}`}
            disabled={kind === "prompt" && !value.trim()}
            onClick={confirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function DialogHost() {
  const request = useCurrentDialog();
  if (!request) return null;
  return createPortal(<Dialog key={request.id} request={request} />, document.body);
}
