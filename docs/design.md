# Bagseven design system (Fianto-aligned)

Two **separate** surfaces — do not mash them into one chrome.

| Surface | URL | Feel |
| --- | --- | --- |
| **Landing** | http://localhost:3001 | Marketing site (fianto.xyz) |
| **Dashboard** | http://localhost:3000 | Merchant app (Fianto Overview) |

## Shared tokens (from fianto.xyz)

```css
--blue: #0002f8;
--blue-d: #0001c8;
--hero: #0c0a0b;
--ink: #0e0e10;
--ink2: #3a3a40;
--gray: #63636d;
--faint: #6f6f78;
--soft: #f6f6f8;      /* landing soft bands + dashboard page bg */
--dash-bg: #f2f2f2;   /* Fianto merchant login / app canvas */
--line: #ececf0;
--good: #1a7a45;
--warn: #a8480f;
--warn-t: #fff1e4;
--paper: #ffffff;
--r-s: 10px;
--r-m: 16px;
--r-l: 28px;
--text: Switzer, system-ui, sans-serif;
--brand: "Space Grotesk", Switzer, system-ui, sans-serif;
--mono: "Chivo Mono", ui-monospace, monospace;
```

## Landing rhythm

1. Dark hero (`--hero`) + huge brand headline  
2. Dark statement band  
3. **Electric blue** “two ways in” (`--blue`)  
4. Dark creators / product story  
5. Soft cream developer band (`#f7f6f3` / `--soft`)  
6. Blue product list  
7. Dark security “cannot do”  
8. Soft FAQ  
9. Blue close CTA  

Nav: transparent over hero, white “Open app” pill → dashboard `:3000`.

## Dashboard rhythm (Fianto Overview)

- Canvas: `#f2f2f2` / `--soft`
- Left sidebar ~260px, white/transparent, blue wordmark “Bagseven Beta”
- Workspace chip + network badge (Mock / Live)
- Nav: Overview · Needs attention · Entitlements · Mint · Credits · groups for Access / Settings
- Top bar: search · black “Mint grant” button · avatar
- Content: large title, attention banner, white **rounded** cards (`border-radius: 16px`), soft shadow
- Accent: chart/links `--blue`; alert peach `--warn-t`

## Anti-patterns

- Dark marketing header inside the dashboard  
- Flat gray shadcn “admin” look without blue wordmark / rounded cards  
- Running inspector `:3010` or folding landing into `/app`
