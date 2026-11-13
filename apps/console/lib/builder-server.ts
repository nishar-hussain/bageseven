import { EmbedDesignStore } from '@bagseven/db';
import { NextResponse } from 'next/server';
import { consoleDatabase } from './account-profiles';
import { getSession, sessionHolder, sessionIsValid } from './auth';
import { daemonJson } from './daemon-bff';
import { providerScopeHeaders } from './provider-gas-scope';
import { validateDesign, type DesignConfig } from './builder-model';
import type { Plan } from './billing-client';

export const designStore = () => new EmbedDesignStore<DesignConfig>(consoleDatabase());
export async function designRequest(request: Request, id?: string) {
  try {
    const session = await getSession();
    if (!sessionIsValid(session) || !session)
      return NextResponse.json({ error: { message: 'Sign in required.' } }, { status: 401 });
    const owner = sessionHolder(session);
    if (request.method !== 'GET') {
      if (request.headers.get('origin') !== new URL(request.url).origin)
        return NextResponse.json({ error: { message: 'Same-origin request required.' } }, { status: 403 });
      if (Number(request.headers.get('content-length') ?? 0) > 20000)
        throw Error('Design request is too large.');
    }
    const store = designStore();
    if (request.method === 'GET')
      return NextResponse.json(
        { designs: await store.list(owner) },
        { headers: { 'cache-control': 'no-store' } },
      );
    const raw = await request.text();
    if (raw.length > 20000) throw Error('Design request is too large.');
    const body = JSON.parse(raw);
    if (!id) {
      const config = validateDesign(body.config);
      await assertPlans(config, owner, false);
      return NextResponse.json({ design: await store.create(owner, config) }, { status: 201 });
    }
    if (!/^[a-f0-9-]{36}$/i.test(id) || !Number.isSafeInteger(body.revision) || body.revision < 1)
      throw Error('Invalid design revision.');
    if (!['save', 'publish', 'unpublish', 'delete'].includes(body.action))
      throw Error('Unknown design action.');
    const config = body.action === 'save' ? validateDesign(body.config) : undefined;
    if (config) await assertPlans(config, owner, false);
    if (body.action === 'publish') {
      const existing = (await store.list(owner)).find((d) => d.id === id);
      if (!existing) throw Error('DESIGN_NOT_FOUND');
      await assertPlans(validateDesign(existing.config), owner, true);
    }
    return NextResponse.json({ design: await store.change(owner, id, body.revision, body.action, config) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save design.';
    const status =
      message === 'DESIGN_CONFLICT'
        ? 409
        : message === 'DESIGN_NOT_FOUND'
          ? 404
          : message === 'DESIGN_LIMIT'
            ? 409
            : /^(Choose|Invalid|Unknown|Design|name |heading |cta )/.test(message) ||
                error instanceof SyntaxError
              ? 400
              : 503;
    return NextResponse.json(
      {
        error: {
          message:
            status === 503
              ? 'Design storage is unavailable. Please try again.'
              : message === 'DESIGN_CONFLICT'
                ? 'This design changed in another tab. Reload it before saving.'
                : message,
        },
      },
      { status },
    );
  }
}
async function assertPlans(config: DesignConfig, owner: string, publishing: boolean) {
  if (!config.planIds.length && publishing && ['cmp_pricing', 'cmp_customer'].includes(config.componentId))
    throw Error('Choose at least one plan before publishing.');
  const response = await daemonJson<{ plans: Plan[] }>('/v1/plans', {
    headers: { 'x-bagseven-provider': owner, ...providerScopeHeaders(owner) },
  });
  if (!response.ok) throw Error('PLAN_SERVICE_UNAVAILABLE');
  const owned = new Set(
    response.body.plans.filter((p) => p.provider_id === owner && (!publishing || p.active)).map((p) => p.id),
  );
  if (config.planIds.some((id) => !owned.has(id)))
    throw Error('Choose plans owned by your workspace. Published plans must be active.');
}
