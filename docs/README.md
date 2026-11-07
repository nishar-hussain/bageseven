# Docs

The public documentation site runs in the existing landing app: [localhost:3001/docs/introduction](http://localhost:3001/docs/introduction).

Edit public guides and examples in `apps/landing/lib/docs.ts`. Navigation, search, section links, page metadata, and previous/next links are derived from that content. The landing navigation and dashboard both link to the documentation. Set `NEXT_PUBLIC_LANDING_URL` and `NEXT_PUBLIC_CONSOLE_URL` to the deployed origins when hosting.

| | |
| --- | --- |
| [PRODUCT.md](./PRODUCT.md) | What ships, demo script, World vs MCP |
| [DEVELOPERS.md](./DEVELOPERS.md) | Mental model, local run, MCP |
| [HOSTING.md](./HOSTING.md) | Deploy, Resend, env |
| [DECISIONS.md](./DECISIONS.md) | Spend-token invariants |
| [design.md](./design.md) | Landing vs dashboard (Fianto) |
| [arkiv/](./arkiv/) | Grant schema + Arkiv friction |

Agents: [`../AGENTS.md`](../AGENTS.md) · [`../llms.txt`](../llms.txt)
