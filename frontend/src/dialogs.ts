import { useEffect, useState } from "react";

export type DialogTone = "default" | "danger";

export type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type PromptOptions = DialogOptions & {
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
};

export type DialogRequest = {
  id: number;
  kind: "confirm" | "prompt";
  message: string;
  options: PromptOptions;
  resolve: (value: boolean | string | null) => void;
};

const QUEUE_EVENT = "mydgx-dialogs";
let queue: DialogRequest[] = [];
let nextId = 1;

function open(kind: DialogRequest["kind"], message: string, options: PromptOptions) {
  return new Promise<boolean | string | null>((resolve) => {
    queue = [...queue, { id: nextId++, kind, message, options, resolve }];
    window.dispatchEvent(new Event(QUEUE_EVENT));
  });
}

/** Themed replacement for window.confirm(). */
export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return open("confirm", message, options) as Promise<boolean>;
}

/** Themed replacement for window.prompt(); resolves to null when cancelled. */
export function promptDialog(message: string, options: PromptOptions = {}): Promise<string | null> {
  return open("prompt", message, options) as Promise<string | null>;
}

export function settleDialog(id: number, value: boolean | string | null) {
  const request = queue.find((item) => item.id === id);
  if (!request) return;
  queue = queue.filter((item) => item.id !== id);
  window.dispatchEvent(new Event(QUEUE_EVENT));
  request.resolve(value);
}

export function useCurrentDialog(): DialogRequest | null {
  const [current, setCurrent] = useState<DialogRequest | null>(queue[0] ?? null);
  useEffect(() => {
    const sync = () => setCurrent(queue[0] ?? null);
    sync();
    window.addEventListener(QUEUE_EVENT, sync);
    return () => window.removeEventListener(QUEUE_EVENT, sync);
  }, []);
  return current;
}
