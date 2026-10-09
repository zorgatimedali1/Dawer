export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | undefined | null>;

/* ==========================================================================
   Minimal Tailwind-aware class joiner.

   Plain string concatenation is not enough for a component library: `<Card
   className="border-brand-500">` renders both `border-line` and
   `border-brand-500`, and which one wins is decided by Tailwind's stylesheet
   order rather than by the order they appear in the attribute. This resolves
   conflicts explicitly so a caller can always override a component default.

   Scope is deliberately narrow: it groups utilities by axis (colour, font
   size, border width, …) and keeps the last value per axis. It is not a
   general-purpose Tailwind parser.
   ========================================================================== */

const COLOR_KEYWORDS = new Set(['transparent', 'current', 'inherit', 'white', 'black']);

/** Semantic colour names exposed by the Dawer design tokens. */
const SEMANTIC_COLORS = new Set([
  'surface',
  'surface-2',
  'surface-3',
  'card',
  'elevated',
  'line',
  'line-strong',
  'ink',
  'ink-muted',
  'ink-subtle',
  'ink-inverse',
  'accent',
  'accent-hover',
  'accent-bright',
  'accent-soft',
  'accent-ink',
]);

const AXES = new Set(['x', 'y', 't', 'r', 'b', 'l', 's', 'e']);

/**
 * Utilities whose family shares a first segment across two axes — `gap-2` and
 * `gap-x-2` are different properties and must not clobber each other.
 */
const AXIS_UTILITIES = new Set([
  'gap',
  'space',
  'overflow',
  'overscroll',
  'inset',
  'translate',
  'scale',
  'place',
  'scroll-m',
  'scroll-p',
  'border-spacing',
]);

const BORDER_WIDTHS = new Set(['', '0', '1', '2', '4', '8']);
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);

const COLOR_UTILITIES = new Set([
  'bg',
  'text',
  'border',
  'divide',
  'ring',
  'outline',
  'fill',
  'stroke',
  'decoration',
  'caret',
  'accent',
  'shadow',
  'from',
  'via',
  'to',
  'placeholder',
]);

const FONT_SIZES = new Set([
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
]);

const FONT_WEIGHTS = new Set([
  'thin',
  'extralight',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
]);

function isColorValue(value: string): boolean {
  if (COLOR_KEYWORDS.has(value)) return true;
  if (SEMANTIC_COLORS.has(value)) return true;
  // Numeric scale steps such as brand-500 or success-700.
  if (/^[a-z][a-z0-9]*-\d{2,3}$/.test(value)) return true;
  // Arbitrary colour literals: [#fff], [rgb(…)], [var(--x)].
  if (value.startsWith('[') && value.endsWith(']')) {
    return /(^|[^a-z])(#|rgb|hsl|oklch|lab|color|var\()/.test(value);
  }
  return false;
}

function stripOpacity(value: string): string {
  const index = value.lastIndexOf('/');
  if (index === -1) return value;
  const suffix = value.slice(index + 1);
  return /^(?:\[.+\]|\d{1,3})$/.test(suffix) ? value.slice(0, index) : value;
}

/** Index of the last top-level `:` variant separator, or -1 when there is none. */
function lastVariantIndex(token: string): number {
  let depth = 0;
  let found = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === ':' && depth === 0) found = index;
  }
  return found;
}

/** Splits on whitespace while keeping `[…]` groups (arbitrary values) intact. */
function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of value) {
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;

    if (depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

/** Resolves a utility to its conflict group, or null when it never conflicts. */
function groupOf(token: string): string | null {
  if (!token || token.startsWith('-') || token.startsWith('!')) return null;

  const variantIndex = lastVariantIndex(token);
  const variants = variantIndex === -1 ? '' : token.slice(0, variantIndex);
  const base = variantIndex === -1 ? token : token.slice(variantIndex + 1);
  const prefix = `${variants}|`;

  const segments = base.split('-');
  const util = segments[0] ?? '';
  const rest = segments.slice(1);

  if (!COLOR_UTILITIES.has(util)) {
    // `gap-x-2` and `gap-y-4` are separate axes behind one family name.
    if (AXIS_UTILITIES.has(util)) {
      return rest[0] !== undefined && AXES.has(rest[0])
        ? `${prefix}${util}-${rest[0]}`
        : `${prefix}${util}`;
    }
    // Display vs grow vs direction all live under `flex-`.
    if (util === 'flex') {
      const first = rest[0];
      if (rest.length === 0) return `${prefix}flex-display`;
      if (first !== undefined && (/^\d+$/.test(first) || ['auto', 'initial', 'none'].includes(first))) {
        return `${prefix}flex-flex`;
      }
      return `${prefix}flex-${rest.join('-')}`;
    }
    if (util === 'font') {
      const value = rest.join('-');
      return FONT_WEIGHTS.has(value) ? `${prefix}font-weight` : `${prefix}font-family`;
    }
    // `p-4` / `px-4` / `gap-x-2` / `w-10` / `rounded-lg` all differ by first
    // segment already, which is exactly the axis we want.
    return `${prefix}${util}`;
  }

  if (util === 'shadow') return `${prefix}shadow`;

  // Peel an axis off the value so `border-t-brand-500` and `border-brand-500`
  // are allowed to coexist.
  const axis = rest[0] !== undefined && AXES.has(rest[0]) ? rest[0] : '';
  const value = stripOpacity(axis ? rest.slice(1).join('-') : rest.join('-'));

  if (util === 'text') {
    if (FONT_SIZES.has(value)) return `${prefix}text-size`;
    if (FONT_WEIGHTS.has(value)) return `${prefix}text-weight`;
  }

  if (isColorValue(value)) {
    if (util === 'bg' && (value.startsWith('gradient') || value.startsWith('linear-gradient'))) {
      return `${prefix}gradient`;
    }
    return `${prefix}${util}${axis ? `-${axis}` : ''}-color`;
  }

  if (util === 'border' || util === 'divide') {
    if (axis) return `${prefix}${util}-${axis}`;
    if (BORDER_WIDTHS.has(value)) return `${prefix}${util}-width`;
    if (BORDER_STYLES.has(value)) return `${prefix}${util}-style`;
    return `${prefix}${util}`;
  }

  if (util === 'ring') {
    if (rest[0] === 'offset') return `${prefix}ring-offset`;
    if (value === 'inset') return `${prefix}ring-inset`;
  }

  return `${prefix}${util}`;
}

/**
 * Join class names, letting later arguments override earlier ones on the same
 * axis. `cn('p-4', 'p-6')` → `'p-6'`, while `cn('p-4', 'px-6')` keeps both.
 */
export function cn(...inputs: ClassValue[]): string {
  const tokens: string[] = [];

  const collect = (value: ClassValue): void => {
    if (value === null || value === undefined || value === false || value === '') return;
    if (typeof value === 'number') {
      tokens.push(String(value));
      return;
    }
    if (typeof value === 'string') {
      tokens.push(...splitTokens(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) if (enabled) collect(key);
    }
  };

  inputs.forEach(collect);

  const order: string[] = [];
  const slotOf = new Map<string, number>();

  for (const token of tokens) {
    const group = groupOf(token);
    if (group === null) {
      order.push(token);
      continue;
    }
    const existing = slotOf.get(group);
    if (existing === undefined) {
      slotOf.set(group, order.length);
      order.push(token);
    } else {
      // Later value wins, but keeps the original slot so the component's own
      // cascade order is preserved.
      order[existing] = token;
    }
  }

  return order.join(' ');
}