CREATE TABLE embed_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  config jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  published jsonb,
  published_revision integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revision > 0)
);
CREATE INDEX embed_designs_owner_updated_idx ON embed_designs(owner, updated_at DESC, id);
