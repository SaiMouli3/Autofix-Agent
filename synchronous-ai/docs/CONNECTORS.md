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
| **Salesforce** | HTTP · REST API `v67.0` · **one-click OAuth** | SOQL queries, SOSL search, describe objects, read records, org limits | `create_record`, `update_record`, `delete_record` (off by default) |
| **Salesforce Hosted MCP** | MCP · `api.salesforce.com/platform/mcp/v1/…` · **one-click OAuth** | Salesforce's hosted servers (`sobject-reads`, `sobject-all`, `flows`, …) | follows the agent's approval policy |
| **SAP S4HANA** | HTTP · OData V2 · communication user | business partners, sales orders, products, plus any released OData service (`odata_query`) | `update_business_partner` (with ETag), `create_sales_order` (off by default) |
| **SAP API Sandbox** | HTTP · `sandbox.api.sap.com` · API key | the same reads against SAP's public demo tenant | read-only |

## One-click sign-in (OAuth 2.0 + PKCE)

Salesforce connectors use the platform's OAuth flow. No token is ever pasted:

1. In the vendor, register an app with the **callback URL** shown in the connect dialog. The URL is
   `SCA_PUBLIC_BASE_URL` + `/api/oauth/callback`, so in production it must be your public **https** URL.
2. Enter the app's client ID and secret. They are stored encrypted.
3. Click **Connect**. The browser goes to the vendor's login and consent page, then returns to the
   integration signed in.
4. Run **Test connection**, then **Approve & activate**.

Under the hood:

- **PKCE S256:** every authorization uses PKCE.
- **State:** a random state, of which only a SHA-256 hash is stored, is valid once, for 10 minutes,
  and only for the person who started it.
- **Token storage:** tokens are kept in one encrypted secret per integration and never returned to the browser.
- **Salesforce API host:** Salesforce's `instance_url` becomes the integration's API host.
- **Refresh:** the platform refreshes tokens automatically, either when they expire or after a
  `401` (Salesforce issues no expiry time).
- **Rotating refresh tokens:** refreshes are serialized per integration, using a process lock plus a
  row lock, and committed in their own transaction. Salesforce External Client Apps rotate the
  refresh token on every use. A lost new token, or two concurrent refreshes, would otherwise disconnect the integration.
- **Revocation:** if the vendor revokes access, the integration shows **Sign-in expired** and agents
  get a clear "reconnect" error.
- **Disconnect:** this revokes the token at the vendor, when the vendor supports it, deletes the
  tokens and disables the integration.

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

- **Salesforce:** in Setup → *External Client App Manager*, create an app with OAuth enabled and
  the callback URL above. Require PKCE; Salesforce also requires refresh-token rotation for External
  Client Apps, which the platform handles. Use scopes `api` and `refresh_token` for the REST
  connector, or `mcp_api` and `refresh_token` for Hosted MCP (also enable JWT-based access tokens).
  Since Spring '26, Salesforce no longer allows creating classic Connected Apps.
- **SAP S/4HANA Cloud:** create a communication user and communication system, then a communication
  arrangement for each API: `SAP_COM_0008` for business partners, `SAP_COM_0109` for sales orders,
  `SAP_COM_0009` for products. Enter the API host and the communication user. The password is the
  credential. On-premise SAP Gateway hosts on a private network must also be listed in
  `SCA_ALLOWED_PRIVATE_HOSTS`.
- **SAP API Sandbox:** sign in at api.sap.com and use **Show API Key**.

## Safety controls these connectors rely on

- **SAP CSRF:** before any write, the gateway fetches `X-CSRF-Token` with SAP's session cookies,
  using the same HTTP client. If the token has expired, SAP answers `403`, and the gateway fetches a
  new one and retries once.
- **Header parameters:** an operation can map specific arguments to request headers, for example
  `if_match` → `If-Match` for SAP ETags. Credential headers such as `Authorization`, `Cookie`,
  `APIKey` and `X-CSRF-Token` can never be set this way.

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
- **Live calls with real accounts:** Salesforce was verified against the real login host up to client
  validation. The platform's authorization URL and token request reached `login.salesforce.com`,
  which answered `invalid_client_id` to a placeholder client. The SAP sandbox health check reached
  `sandbox.api.sap.com` and was rejected with an invalid key. The complete sign-in, refresh,
  rotation, revocation and CSRF flows are tested end to end against a local test double of the vendor.
- **Earlier connectors:** live end-to-end calls were verified only up to authentication. Each connector's
  *Test connection* reached the real vendor endpoint and correctly reported an invalid token as
  rejected. Successful calls need your real credentials.
