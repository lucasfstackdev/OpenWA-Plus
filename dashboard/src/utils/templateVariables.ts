// Shared between the Templates editor and the Kirvano "test message" modal — both need to read
// {{variable}} placeholders out of a template's header/body/footer and render a preview with
// user-supplied values.

export interface TemplateLike {
  header?: string | null;
  body: string;
  footer?: string | null;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Every distinct {{variable}} name referenced in header/body/footer, sorted. */
export function extractPlaceholders(template: TemplateLike): string[] {
  const source = [template.header, template.body, template.footer].filter(Boolean).join('\n');
  return Array.from(new Set(Array.from(source.matchAll(PLACEHOLDER_PATTERN), match => match[1]))).sort();
}

/**
 * Renders header+body+footer joined with a blank line, substituting `{{key}}` with `values[key]`.
 * A key with no value (or an empty one) is left as the literal placeholder, so an unfilled
 * variable stays visible in the preview instead of silently blanking.
 */
export function renderPreview(template: TemplateLike, values: Record<string, string>): string {
  return [template.header, template.body, template.footer]
    .filter(Boolean)
    .join('\n\n')
    .replace(PLACEHOLDER_PATTERN, (_match, key: string) => values[key] || `{{${key}}}`);
}
