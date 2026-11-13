import type { createDb } from './client.js';

export type EmbedDesign<T> = { id: string; config: T; revision: number; published: T | null; published_revision: number | null; updated_at: string };

/** Provider-private drafts and explicit public snapshots; compare-and-swap prevents lost edits. */
export class EmbedDesignStore<T extends Record<string, unknown>> {
  constructor(private db: ReturnType<typeof createDb>) {}
  async list(owner: string): Promise<EmbedDesign<T>[]> {
    const { rows } = await this.db.$client.query('SELECT id,config,revision,published,published_revision,updated_at FROM embed_designs WHERE owner=$1 ORDER BY updated_at DESC,id LIMIT 100', [owner]);
    return rows;
  }
  async create(owner: string, config: T): Promise<EmbedDesign<T>> {
    const connection = await this.db.$client.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`embed-designs:${owner}`]);
      const { rows: count } = await connection.query('SELECT count(*)::int AS total FROM embed_designs WHERE owner=$1', [owner]);
      if (count[0].total >= 100) throw Error('DESIGN_LIMIT');
      const { rows } = await connection.query('INSERT INTO embed_designs(owner,config) VALUES($1,$2) RETURNING id,config,revision,published,published_revision,updated_at', [owner, JSON.stringify(config)]);
      await connection.query('COMMIT'); return rows[0];
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }
  async change(owner: string, id: string, revision: number, action: 'save' | 'publish' | 'unpublish' | 'delete', config?: T): Promise<EmbedDesign<T> | null> {
    const updates = { save: 'config=$4,revision=revision+1,updated_at=now()',
      publish: 'published=config,published_revision=revision+1,revision=revision+1,updated_at=now()',
      unpublish: 'published=NULL,published_revision=NULL,revision=revision+1,updated_at=now()' };
    const query = action === 'delete' ? 'DELETE FROM embed_designs WHERE owner=$1 AND id=$2 AND revision=$3 RETURNING id' :
      `UPDATE embed_designs SET ${updates[action]} WHERE owner=$1 AND id=$2 AND revision=$3 RETURNING id,config,revision,published,published_revision,updated_at`;
    const { rows } = await this.db.$client.query(query, action === 'save' ? [owner, id, revision, JSON.stringify(config)] : [owner, id, revision]);
    if (!rows.length) {
      const { rows: existing } = await this.db.$client.query('SELECT 1 FROM embed_designs WHERE owner=$1 AND id=$2', [owner, id]);
      throw Error(existing.length ? 'DESIGN_CONFLICT' : 'DESIGN_NOT_FOUND');
    }
    return action === 'delete' ? null : rows[0];
  }
  async published(id: string): Promise<T | undefined> {
    const { rows } = await this.db.$client.query('SELECT published FROM embed_designs WHERE id=$1 AND published IS NOT NULL', [id]);
    return rows[0]?.published;
  }
}
