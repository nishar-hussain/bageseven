import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { docs, type DocBlock, type DocPage } from '../../lib/docs';
import { CodeBlock } from './CodeBlock';
import { ArchitectureDiagram } from './ArchitectureDiagram';

function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).map((part, index) => part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part)}</>;
}
function Block({ block }: { block: DocBlock }) {
  if (block.type === 'architecture') return <ArchitectureDiagram />;
  if (block.type === 'paragraph') return <p><Inline text={block.text} /></p>;
  if (block.type === 'code') return <CodeBlock language={block.language} code={block.code} />;
  if (block.type === 'note') return <div className="docs-callout"><Info size={18} /><div><strong>{block.title}</strong><p><Inline text={block.text} /></p></div></div>;
  if (block.type === 'table') return <div className="docs-table-wrap"><table><thead><tr>{block.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}><Inline text={cell} /></td>)}</tr>)}</tbody></table></div>;
  if (block.type === 'steps') return <ol className="docs-steps">{block.items.map((item, i) => <li key={item.title}><span>{i + 1}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></li>)}</ol>;
  return <div className="docs-cards">{block.items.map(item => <Link href={`/docs/${item.slug}`} key={item.slug}><ArrowUpRight size={17} /><h3>{item.title}</h3><p>{item.text}</p></Link>)}</div>;
}
export function DocsArticle({ page }: { page: DocPage }) {
  const index = docs.findIndex(item => item.slug === page.slug);
  const previous = docs[index - 1]; const next = docs[index + 1];
  return <article className="docs-article">
    <div className="docs-eyebrow">{page.group}</div>
    <h1>{page.title}</h1><p className="docs-description">{page.description}</p>
    <div className="docs-article-rule" />
    {page.sections.map(section => <section key={section.id} id={section.id}><h2><a href={`#${section.id}`} aria-label={`Link to ${section.title}`}>{section.title}<span aria-hidden="true">#</span></a></h2>{section.blocks.map((block, i) => <Block block={block} key={i} />)}</section>)}
    <nav className="docs-pagination" aria-label="Previous and next page">{previous ? <Link href={`/docs/${previous.slug}`}><small><ArrowLeft size={13} /> Previous</small><strong>{previous.title}</strong></Link> : <span />}{next && <Link href={`/docs/${next.slug}`}><small>Next <ArrowRight size={13} /></small><strong>{next.title}</strong></Link>}</nav>
    <footer className="docs-article-footer"><span>Bagseven documentation</span><span>email and wallet · Avalanche · Registry</span></footer>
  </article>;
}
