# API — REST surface

> **Moved.** The API reference is now **auto-generated from the route files** (so
> it can't drift) and served in Ariadne's built-in docs. Run the app and open
> **`/developers/api`** — every endpoint, filterable, with the request/response
> shapes. This hand-maintained table is retired in its favour; the stub below
> points the way.

| You want… | In-app page |
| --- | --- |
| Every endpoint (138, filterable) | `/developers/api` |
| Authenticating from outside the SPA (login → cookie → call) | `/developers/remote-access` |
| Local vs remote, what each role can do | `/developers/auth-model` |
| Bring-your-own provider keys | `/developers/add-a-provider` |

The inventory regenerates with `npm run gen:api` and is gated in CI by
`npm run gen:api:check`. Source: `scripts/gen-api-inventory.mjs` →
`apps/web/src/features/developers/apiInventory.generated.ts`. The docs prose is
in `apps/web/src/features/developers/docsContent.ts`.
