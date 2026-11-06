import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsArticle } from '../../../components/docs/DocsArticle';
import { docs, getDoc } from '../../../lib/docs';

type Context = { params: Promise<{ slug: string[] }> };
export const dynamicParams = false;
export function generateStaticParams() { return docs.map(page => ({ slug: page.slug.split('/') })); }
export async function generateMetadata({ params }: Context): Promise<Metadata> {
  const page = getDoc((await params).slug.join('/'));
  return { title: page ? `${page.title} — Bagseven Docs` : 'Page not found — Bagseven Docs', description: page?.description };
}
export default async function DocumentationPage({ params }: Context) {
  const page = getDoc((await params).slug.join('/'));
  if (!page) notFound();
  return <DocsArticle page={page} />;
}
