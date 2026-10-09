import * as frDict from './fr';
import * as enDict from './en';

export type Locale = 'fr' | 'en';

/** Widened view of the FR dictionary: every value is a plain string. */
export type Dictionary = {
  readonly [Namespace in keyof typeof frDict]: {
    readonly [Key in keyof (typeof frDict)[Namespace]]: string;
  };
};

export const translations: Record<Locale, Dictionary> = {
  fr: frDict,
  en: enDict,
};

export function getDictionary(locale: Locale): Dictionary {
  return translations[locale];
}

/** Replaces `{name}` placeholders inside a translated string. */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/**
 * Best-effort translation for dynamic service/API error strings: known
 * messages are replaced with the locale variant, unknown ones pass through.
 */
export function msg(dict: Dictionary, text: string): string {
  const table = dict.errors as Readonly<Record<string, string | undefined>>;
  return table[text] ?? text;
}
