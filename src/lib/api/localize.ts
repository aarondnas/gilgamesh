// Text from the backend in the user's language. The backend sends messages of
// its own as the key of a message in messages/*.json with its parameters, as
// JSON (see src-tauri/src/util/i18n.rs); text from TeX, Git or the system
// comes as it is.
import { m } from "$lib/paraglide/messages";

type Message = (params: Record<string, string>) => string;

/** The message `key` with `params`; `null` where there is no such message. */
export function translate(key: string, params: Record<string, string> = {}): string | null {
  const message = (m as unknown as Record<string, Message | undefined>)[key];
  return message ? message(params) : null;
}

/** `text` from the backend in the user's language. Parameters may be such messages themselves. */
export function localize(text: string): string {
  if (!text.startsWith('{"message":')) return text;
  try {
    const { message, params } = JSON.parse(text) as { message: string; params: Record<string, string> };
    const localized = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, localize(value)]));
    return translate(message, localized) ?? message;
  } catch {
    return text;
  }
}
