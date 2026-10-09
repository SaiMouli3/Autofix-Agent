# Prebuilt connectors

**Integrations → Browse connectors** creates an integration from a vetted definition. Every connector
is added as **proposed**. An administrator then attaches the credential, runs **Test connection**
(a live request to the vendor), reviews which operations are enabled, assigns agents and activates it.
Agents never see the credential: the gateway on the platform host injects it on each call.

Versions were checked against the vendors' live APIs on 2026-10-09.

| Connector | Type | What agents can do | Changes need approval |
|---|---|---|---|
| **Shopify Admin** | HTTP · Admin GraphQL `2026-07` | `graphql_query`: read products, orders, customers, inventory, fulfilment | `graphql_mutation` (off by default) |
| **Meta Ads** | HTTP · Marketing API `v26.0` | account, campaigns, ad sets, ads, account- and object-level insights | `set_status` (pause/activate), `set_daily_budget` (both off by default) |
| **WhatsApp Business** | HTTP · Cloud API `v26.0` | phone-number health, approved message templates | `send_text_message`, `send_template_message` (every send) |
| **Meta Ads MCP** | MCP · `https://mcp.facebook.com/ads` | Meta's hosted tools for reporting, campaign management, catalogs, diagnostics | follows the agent's approval policy; restrict with *Allowed tools* |
| **Shopify Dev MCP** | MCP · stdio `@shopify/dev-mcp@1.16.0` | Shopify docs search and GraphQL schema exploration (no store data) | — (needs `SCA_ALLOW_STDIO_MCP=true`) |

## Credentials

- **Shopify:** create a custom app in the store admin (*Settings → Apps and sales channels → Develop
  apps*). Grant only the Admin API scopes you need, for example `read_orders` and `read_products`,
  plus `write_*` scopes if you enable mutations. Paste the Admin API access token (`shpat_…`).
- **Meta Ads (HTTP):** create a System User token in Meta Business Settings. Use `ads_read`, and add
  `ads_management` only if you enable the change operations.
- **WhatsApp:** create a System User token with `whatsapp_business_messaging` and
  `whatsapp_business_management`, assigned to the WhatsApp Business Account. You'll also need the
  phone-number ID and the WABA ID from WhatsApp Manager.
- **Meta Ads MCP:** the server is an OAuth-protected resource (authorization server
  `www.facebook.com/ads`). This platform doesn't run the interactive OAuth sign-in, so paste an
  access token issued for the server's scopes, then run *Test connection* to check that Meta accepts it.

## Safety controls these connectors rely on

- **GraphQL guard:** an operation marked `graphql: "query"` is read-only. The gateway rejects any
  document that contains a `mutation` or `subscription`, ignoring the word inside strings and
  comments. This includes a mutation hidden in a second operation.
- **Fixed body fields:** for example, WhatsApp's `messaging_product` and message `type` are set by
  the platform. An agent cannot change them; for instance, it cannot turn a text send into a template send.
- **Default query fields:** these are sensible field lists for Graph API reads. Agents may override them.
- **Write operations:** every operation that can change external data has `requires_approval`. The
  change operations for Shopify and Meta Ads also start disabled.

## Not included, and why

- **WhatsApp MCP:** Meta publishes no hosted WhatsApp MCP server that we could verify. Community
  servers mostly automate a personal WhatsApp Web session, which breaks WhatsApp's terms for business
  use. The Cloud API connector is the supported route. A third-party MCP server can still be added
  as a custom MCP integration.
- **Shopify Storefront/UCP MCP:** the catalog and cart tools moved to `https://{shop}/api/ucp/mcp`,
  which requires an agent profile in every request. The platform's MCP client doesn't send one yet.
- **Creating Meta campaigns or ads:** this is out of scope for the HTTP connector. Use the Meta Ads
  MCP connector, or add operations to the integration after review.
- **Live end-to-end calls:** these were verified only up to authentication. Each connector's
  *Test connection* reached the real vendor endpoint and correctly reported an invalid token as
  rejected. Successful calls need your real credentials.
