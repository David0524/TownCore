import { renderMarkdown } from '@/lib/markdown';

/** Renders trusted-template or article Markdown through the safe renderer. */
export function Prose({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
  );
}
