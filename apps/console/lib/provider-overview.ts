import type { Database } from '@bagseven/db';

export type ProviderOverview = {
  asOf: string;
  days: number;
  metrics: {
    checkouts: number;
    paid: number;
    pending: number;
    failed: number;
    expired: number;
    customers: number;
    activeSubscriptions: number;
    pastDue: number;
    reconciliation: number;
    activePlans: number;
    publishedEmbeds: number;
  };
  activity: { day: string; opened: number; paid: number }[];
  recent: { id: string; plan: string; status: string; createdAt: string }[];
  subscriptions: { id: string; plan: string; status: string; nextAttemptAt: string }[];
  topPlans: { id: string; name: string; opened: number; paid: number }[];
};

/** Indexed catalog ownership is the scope. Never accept a holder/provider from browser input. */
export async function providerOverview(
  db: Database,
  provider: string,
  days: number,
): Promise<ProviderOverview> {
  const connection = await db.$client.connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '5s'");
    const clock = await connection.query<{ now: Date }>('select now() as now');
    const asOf = clock.rows[0]!.now.toISOString();
    const args = [provider, days, asOf];
    const checkouts = await connection.query(
      `
      select count(*)::int as checkouts,
        count(*) filter(where c.status='PAID')::int as paid,
        count(*) filter(where c.status='PENDING' and c.expires_at > $3::timestamptz)::int as pending,
        count(*) filter(where c.status='FAILED')::int as failed,
        count(*) filter(where c.status='EXPIRED' or (c.status='PENDING' and c.expires_at <= $3::timestamptz))::int as expired,
        count(distinct c.holder) filter(where c.status='PAID')::int as customers
      from checkout_sessions c join billing_plans p on p.id=c.plan_id
      where p.provider_id=$1 and c.created_at >= date_trunc('day',$3::timestamptz at time zone 'UTC') at time zone 'UTC' - ($2::int-1)*interval '1 day' and c.created_at <= $3::timestamptz`,
      args,
    );
    const subscriptions = await connection.query(
      `select
      count(*) filter(where status='ACTIVE')::int as "activeSubscriptions",
      count(*) filter(where status='PAST_DUE')::int as "pastDue",
      count(*) filter(where status='RECONCILIATION_REQUIRED')::int as reconciliation
      from billing_subscriptions where provider_id=$1`,
      [provider],
    );
    const catalog = await connection.query(
      `select
      (select count(*)::int from billing_plans where provider_id=$1 and active='true') as "activePlans",
      (select count(*)::int from embed_designs where owner=$1 and published is not null) as "publishedEmbeds"`,
      [provider],
    );
    const activity = await connection.query(
      `with days as (
      select generate_series((date_trunc('day',$3::timestamptz at time zone 'UTC') - ($2::int-1)*interval '1 day')::date, ($3::timestamptz at time zone 'UTC')::date,interval '1 day')::date as day
    ), counts as (
      select (c.created_at at time zone 'UTC')::date as day, count(*)::int as opened, count(*) filter(where c.status='PAID')::int as paid
      from checkout_sessions c join billing_plans p on p.id=c.plan_id where p.provider_id=$1 and c.created_at >= date_trunc('day',$3::timestamptz at time zone 'UTC') at time zone 'UTC' - ($2::int-1)*interval '1 day' and c.created_at <= $3::timestamptz group by 1
    ) select to_char(d.day,'YYYY-MM-DD') as day,coalesce(c.opened,0)::int as opened,coalesce(c.paid,0)::int as paid from days d left join counts c on c.day=d.day order by d.day`,
      args,
    );
    const recent = await connection.query(
      `select c.id,p.name as plan,
      case when c.status='PENDING' and c.expires_at <= $3::timestamptz then 'EXPIRED' else c.status end as status,
      c.created_at as "createdAt" from checkout_sessions c join billing_plans p on p.id=c.plan_id
      where p.provider_id=$1 and c.created_at >= date_trunc('day',$3::timestamptz at time zone 'UTC') at time zone 'UTC' - ($2::int-1)*interval '1 day' and c.created_at <= $3::timestamptz order by c.created_at desc,c.id desc limit 6`,
      args,
    );
    const issues = await connection.query(
      `select s.id,p.name as plan,s.status,s.next_attempt_at as "nextAttemptAt"
      from billing_subscriptions s join billing_plans p on p.id=s.data->>'planId' and p.provider_id=$1
      where s.provider_id=$1 and s.status in ('PAST_DUE','RECONCILIATION_REQUIRED') order by s.next_attempt_at,s.id limit 5`,
      [provider],
    );
    const topPlans = await connection.query(
      `select p.id,p.name,count(c.id)::int as opened,count(c.id) filter(where c.status='PAID')::int as paid
      from billing_plans p left join checkout_sessions c on c.plan_id=p.id and c.created_at >= date_trunc('day',$3::timestamptz at time zone 'UTC') at time zone 'UTC' - ($2::int-1)*interval '1 day' and c.created_at <= $3::timestamptz
      where p.provider_id=$1 group by p.id,p.name having p.active='true' or count(c.id)>0 order by paid desc,opened desc,p.name,p.id limit 5`,
      args,
    );
    await connection.query('COMMIT');
    return {
      asOf,
      days,
      metrics: { ...checkouts.rows[0], ...subscriptions.rows[0], ...catalog.rows[0] },
      activity: activity.rows,
      recent: recent.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      subscriptions: issues.rows.map((r) => ({ ...r, nextAttemptAt: r.nextAttemptAt.toISOString() })),
      topPlans: topPlans.rows,
    };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

export async function providerCheckouts(
  db: Database,
  provider: string,
  status: string,
  page: number,
  days = 0,
) {
  const result = await db.$client.query(
    `with scoped as (
    select c.id,c.holder,c.amount,c.created_at,p.name as plan,
      case when c.status='PENDING' and c.expires_at <= now() then 'EXPIRED' else c.status end as status,
      c.payment_tx as "paymentTx",c.chain_id as "chainId",c.payment_token as "paymentToken"
    from checkout_sessions c join billing_plans p on p.id=c.plan_id where p.provider_id=$1
      and c.created_at <= now() and ($4::int=0 or c.created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' - ($4::int-1)*interval '1 day')
  ), filtered as (select * from scoped where $2='ALL' or status=$2),
  page as (select * from filtered order by created_at desc,id desc limit 20 offset $3)
  select (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb) as sessions`,
    [provider, status, page * 20, days],
  );
  return result.rows[0] as {
    total: number;
    sessions: {
      id: string;
      holder: string;
      amount: string;
      created_at: string;
      plan: string;
      status: string;
      paymentTx: string | null;
      chainId: number;
      paymentToken: string | null;
    }[];
  };
}
