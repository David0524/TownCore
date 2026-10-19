import { extractText, getDocumentProxy } from 'unpdf';
import type { AdapterContext } from '../types';

/** A PDF's text through the Fetcher (Rule 8), or null when the URL isn't a PDF. */
export async function pdfText(url: string, ctx: AdapterContext): Promise<string | null> {
  const response = await ctx.fetcher.get(url);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return null;
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return (
    String(text)
      .replace(/[ \t]+\n/g, '\n')
      .trim() || null
  );
}
