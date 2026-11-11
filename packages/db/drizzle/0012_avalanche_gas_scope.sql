ALTER TABLE provider_gas_accounts ADD COLUMN IF NOT EXISTS avalanche_reserved numeric(78,0) NOT NULL DEFAULT 0;
ALTER TABLE provider_gas_accounts ADD COLUMN IF NOT EXISTS registry_reserved numeric(78,0) NOT NULL DEFAULT 0;
UPDATE provider_gas_accounts SET status = 'revoked'
WHERE "authorization" IS NOT NULL AND (
  NOT ("authorization" ? 'avalancheId') OR NOT ("authorization" ? 'registryId')
);
