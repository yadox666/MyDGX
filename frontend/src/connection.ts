import { useEffect, useState } from "react";
import { t } from "./i18n";

const CONNECTION_EVENT = "mydgx-connection";

let offlineSince: number | null = null;

export class DgxOfflineError extends Error {
  constructor() {
    super(t("El DGX está desconectado"));
    this.name = "DgxOfflineError";
  }
}

export function isDgxOfflineError(error: unknown): boolean {
  return error instanceof DgxOfflineError;
}

function setConnection(online: boolean) {
  if (online === (offlineSince === null)) return;
  offlineSince = online ? null : Date.now();
  window.dispatchEvent(new Event(CONNECTION_EVENT));
}

/** fetch() that reports whether the DGX answered; network failures become DgxOfflineError. */
export async function fetchDgx(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    setConnection(false);
    throw new DgxOfflineError();
  }
  setConnection(true);
  return response;
}

export function useDgxConnection() {
  const [since, setSince] = useState(offlineSince);
  useEffect(() => {
    const sync = () => setSince(offlineSince);
    window.addEventListener(CONNECTION_EVENT, sync);
    return () => window.removeEventListener(CONNECTION_EVENT, sync);
  }, []);
  return { online: since === null, since };
}
