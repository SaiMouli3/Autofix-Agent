"""Prebuilt connectors for common business systems.

A connector is a parameterised integration definition. Instantiating one produces an ordinary
integration in the ``proposed`` state: an administrator still attaches the credential, runs a live
connection test, reviews the operations and activates it. Connectors never ship credentials and
never mark anything as connected.

Endpoints and versions were checked against the vendors' public APIs on 2026-10-09:
Shopify Admin API 2026-07 (latest stable), Meta Graph / Marketing API v26.0 (released 2026-07-29),
WhatsApp Cloud API on the Graph API, and Meta's hosted Ads MCP server (OAuth-protected resource
at https://mcp.facebook.com/ads).
"""

from __future__ import annotations

import copy
import re
from typing import Any

from sca.config import get_settings

_STR = {"type": "string"}
_OBJ = {"type": "object"}


def _props(required: list[str] | None = None, **props: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


_GRAPH_PAGING = {
    "limit": {"type": "integer", "description": "Page size (Graph API default 25)."},
    "after": {"type": "string", "description": "Cursor from paging.cursors.after of the previous page."},
}
_INSIGHT_ARGS = {
    "date_preset": {"type": "string", "description": "e.g. today, yesterday, last_7d, last_30d, this_month, last_month, maximum"},
    "time_range": {"type": "string", "description": 'JSON string, e.g. {"since":"2026-09-01","until":"2026-09-30"}; overrides date_preset'},
    "level": {"type": "string", "enum": ["account", "campaign", "adset", "ad"]},
    "breakdowns": {"type": "string", "description": "Comma-separated, e.g. age,gender or publisher_platform"},
    "time_increment": {"type": "string", "description": "1 for daily rows, monthly, or all_days"},
    "fields": {"type": "string", "description": "Override the default metric list"},
    **_GRAPH_PAGING,
}
_INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas"
_GRAPH_VERSION = {"key": "api_version", "label": "Graph API version", "default": "v26.0", "pattern": r"^v\d{2}\.\d$",
                  "help": "Meta releases a new version roughly twice a year; each is supported for about two years."}

CONNECTORS: list[dict[str, Any]] = [
    {
        "key": "shopify_admin",
        "name": "Shopify Admin",
        "vendor": "Shopify",
        "type": "http",
        "category": "business_api",
        "summary": "Products, orders, customers, inventory and fulfilment through the Shopify Admin GraphQL API.",
        "docs_url": "https://shopify.dev/docs/api/admin-graphql",
        "params": [
            {"key": "shop", "label": "Store handle", "pattern": r"^[a-z0-9][a-z0-9-]{0,60}$",
             "help": "The part before .myshopify.com, e.g. acme-store for acme-store.myshopify.com.",
             "normalize": "shopify_shop"},
            {"key": "api_version", "label": "API version", "default": "2026-07", "pattern": r"^\d{4}-(01|04|07|10)$",
             "help": "Shopify's latest stable version on 2026-10-09 was 2026-07."},
        ],
        "credential": {
            "label": "Admin API access token",
            "help": "Create a custom app in Shopify admin (Settings → Apps and sales channels → Develop apps), grant "
                    "only the Admin API scopes the agents need (for example read_products, read_orders, read_customers, "
                    "read_inventory) and paste its Admin API access token (starts with shpat_).",
        },
        "config": {
            "base_url": "https://{{shop}}.myshopify.com/admin/api/{{api_version}}",
            "auth": {"type": "api_key_header", "header_name": "X-Shopify-Access-Token"},
            "health_check_path": "/shop.json",
            "rate_limit_per_min": 120,
            "timeout_s": 30,
            "operations": [
                {
                    "name": "graphql_query",
                    "description": "Run a read-only Admin GraphQL query (mutations are rejected by the gateway). Examples: "
                                   "{ orders(first: 20, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt "
                                   "displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } } } } — "
                                   "{ products(first: 20, query: \"status:active\") { nodes { title totalInventory } } }. "
                                   "Paginate with pageInfo { hasNextPage endCursor } and after:.",
                    "method": "POST", "path": "/graphql.json", "graphql": "query",
                    "params_schema": _props(["query"], query={"type": "string", "description": "GraphQL query document"},
                                            variables={"type": "object", "description": "GraphQL variables"}),
                },
                {
                    "name": "graphql_mutation",
                    "description": "Run an Admin GraphQL mutation (creates, updates or deletes store data). Every call "
                                   "waits for human approval. Check userErrors in the response.",
                    "method": "POST", "path": "/graphql.json", "graphql": "mutation",
                    "requires_approval": True, "enabled": False,
                    "params_schema": _props(["query"], query={"type": "string", "description": "GraphQL mutation document"},
                                            variables={"type": "object"}),
                },
            ],
        },
    },
    {
        "key": "meta_marketing",
        "name": "Meta Ads",
        "vendor": "Meta",
        "type": "http",
        "category": "business_api",
        "summary": "Campaign, ad set and ad reporting for one ad account through the Meta Marketing API, plus "
                   "approval-gated pause/resume and budget changes.",
        "docs_url": "https://developers.facebook.com/docs/marketing-api",
        "params": [
            {"key": "ad_account_id", "label": "Ad account ID", "pattern": r"^\d{5,20}$",
             "help": "Numeric ID from Ads Manager; the act_ prefix is optional.", "normalize": "strip_act"},
            _GRAPH_VERSION,
        ],
        "credential": {
            "label": "Access token",
            "help": "A System User access token from Meta Business Settings with ads_read (reporting) and, only if you "
                    "enable the change operations, ads_management. System User tokens do not expire like user tokens.",
        },
        "config": {
            "base_url": "https://graph.facebook.com/{{api_version}}",
            "auth": {"type": "bearer"},
            "health_check_path": "/act_{{ad_account_id}}?fields=name,account_status,currency",
            "rate_limit_per_min": 60,
            "timeout_s": 60,
            "operations": [
                {"name": "get_ad_account", "description": "Ad account name, status, currency, time zone and lifetime spend.",
                 "method": "GET", "path": "/act_{{ad_account_id}}",
                 "default_query": {"fields": "name,account_status,currency,timezone_name,amount_spent,spend_cap"},
                 "params_schema": _props(fields=_STR)},
                {"name": "list_campaigns", "description": "Campaigns with status, objective and budgets (budgets are in "
                                                          "the account currency's minor unit, e.g. cents).",
                 "method": "GET", "path": "/act_{{ad_account_id}}/campaigns",
                 "default_query": {"fields": "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time"},
                 "params_schema": _props(fields=_STR, effective_status={"type": "string", "description": 'JSON array, e.g. ["ACTIVE","PAUSED"]'}, **_GRAPH_PAGING)},
                {"name": "list_adsets", "description": "Ad sets with status, budgets, optimisation goal and campaign.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/adsets",
                 "default_query": {"fields": "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy"},
                 "params_schema": _props(fields=_STR, effective_status=_STR, **_GRAPH_PAGING)},
                {"name": "list_ads", "description": "Ads with status and parent ad set / campaign.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/ads",
                 "default_query": {"fields": "id,name,status,effective_status,adset_id,campaign_id,created_time"},
                 "params_schema": _props(fields=_STR, effective_status=_STR, **_GRAPH_PAGING)},
                {"name": "get_account_insights", "description": "Performance metrics for the ad account; use level to "
                                                                "break down by campaign, adset or ad.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/insights",
                 "default_query": {"fields": _INSIGHT_FIELDS, "date_preset": "last_7d"},
                 "params_schema": _props(**_INSIGHT_ARGS)},
                {"name": "get_object_insights", "description": "Performance metrics for one campaign, ad set or ad.",
                 "method": "GET", "path": "/{object_id}/insights",
                 "default_query": {"fields": _INSIGHT_FIELDS, "date_preset": "last_7d"},
                 "params_schema": _props(["object_id"], object_id={"type": "string", "description": "Campaign, ad set or ad ID"}, **_INSIGHT_ARGS)},
                {"name": "set_status", "description": "Pause or activate a campaign, ad set or ad. Waits for human approval.",
                 "method": "POST", "path": "/{object_id}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["object_id", "status"], object_id=_STR,
                                         status={"type": "string", "enum": ["ACTIVE", "PAUSED"]})},
                {"name": "set_daily_budget", "description": "Change the daily budget of a campaign or ad set, in the "
                                                            "currency's minor unit (e.g. 5000 = 50.00). Waits for human approval.",
                 "method": "POST", "path": "/{object_id}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["object_id", "daily_budget"], object_id=_STR,
                                         daily_budget={"type": "integer", "minimum": 1})},
            ],
        },
    },
    {
        "key": "whatsapp_cloud",
        "name": "WhatsApp Business",
        "vendor": "Meta",
        "type": "http",
        "category": "communication",
        "summary": "Send WhatsApp messages and list approved templates through the WhatsApp Cloud API. Every send "
                   "waits for human approval.",
        "docs_url": "https://developers.facebook.com/docs/whatsapp/cloud-api",
        "params": [
            {"key": "phone_number_id", "label": "Phone number ID", "pattern": r"^\d{5,25}$",
             "help": "From WhatsApp Manager → API setup (not the phone number itself)."},
            {"key": "waba_id", "label": "WhatsApp Business Account ID", "pattern": r"^\d{5,25}$",
             "help": "Needed to list message templates."},
            _GRAPH_VERSION,
        ],
        "credential": {
            "label": "Access token",
            "help": "A System User access token with whatsapp_business_messaging and whatsapp_business_management, "
                    "assigned to this WhatsApp Business Account.",
        },
        "config": {
            "base_url": "https://graph.facebook.com/{{api_version}}",
            "auth": {"type": "bearer"},
            "health_check_path": "/{{phone_number_id}}?fields=display_phone_number,verified_name,quality_rating",
            "rate_limit_per_min": 60,
            "timeout_s": 30,
            "operations": [
                {"name": "get_phone_number", "description": "Display number, verified name, quality rating and messaging limit.",
                 "method": "GET", "path": "/{{phone_number_id}}",
                 "default_query": {"fields": "display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status"},
                 "params_schema": _props(fields=_STR)},
                {"name": "list_message_templates", "description": "Message templates with approval status, language and components.",
                 "method": "GET", "path": "/{{waba_id}}/message_templates",
                 "default_query": {"fields": "name,status,language,category,components"},
                 "params_schema": _props(status={"type": "string", "description": "APPROVED, PENDING or REJECTED"}, **_GRAPH_PAGING)},
                {"name": "send_text_message",
                 "description": "Send a free-form text. WhatsApp only delivers these within 24 hours of the customer's last "
                                "message; otherwise use send_template_message. Waits for human approval.",
                 "method": "POST", "path": "/{{phone_number_id}}/messages", "requires_approval": True,
                 "fixed_body": {"messaging_product": "whatsapp", "recipient_type": "individual", "type": "text"},
                 "params_schema": _props(["to", "text"],
                                         to={"type": "string", "pattern": r"^\+?[0-9]{6,15}$", "description": "E.164 number, e.g. 447700900123"},
                                         text=_props(["body"], body={"type": "string", "maxLength": 4096}, preview_url={"type": "boolean"}))},
                {"name": "send_template_message",
                 "description": "Send an approved template (works outside the 24-hour window). Waits for human approval.",
                 "method": "POST", "path": "/{{phone_number_id}}/messages", "requires_approval": True,
                 "fixed_body": {"messaging_product": "whatsapp", "recipient_type": "individual", "type": "template"},
                 "params_schema": _props(["to", "template"],
                                         to={"type": "string", "pattern": r"^\+?[0-9]{6,15}$"},
                                         template=_props(["name", "language"], name=_STR,
                                                         language=_props(["code"], code={"type": "string", "description": "e.g. en_US"}),
                                                         components={"type": "array", "description": "Header/body/button parameters"}))},
            ],
        },
    },
    {
        "key": "meta_ads_mcp",
        "name": "Meta Ads MCP",
        "vendor": "Meta",
        "type": "mcp",
        "category": "business_api",
        "summary": "Meta's hosted Ads MCP server: reporting, campaign management, catalogs and signal diagnostics as "
                   "MCP tools. Tool calls follow the agent's approval policy.",
        "docs_url": "https://developers.facebook.com/docs/marketing-api",
        "params": [],
        "credential": {
            "label": "OAuth access token",
            "help": "The server is an OAuth-protected resource (authorization server www.facebook.com/ads; scopes such "
                    "as ads_read, ads_management, ads_mcp_management). This platform does not run the interactive OAuth "
                    "sign-in, so paste an access token issued for those scopes. Use Test connection to confirm Meta "
                    "accepts it before activating.",
        },
        "notes": "Beta service from Meta; tool names and behaviour may change. Use Allowed tools to restrict what agents can call.",
        "config": {"transport": "http", "url": "https://mcp.facebook.com/ads", "auth_header": "Authorization",
                   "auth_scheme": "Bearer", "timeout_s": 120},
    },
    {
        "key": "shopify_dev_mcp",
        "name": "Shopify Dev MCP",
        "vendor": "Shopify",
        "type": "mcp",
        "category": "developer_tools",
        "summary": "Shopify documentation search and Admin GraphQL schema exploration for developer agents. No store "
                   "data and no credential. Runs locally with npx.",
        "docs_url": "https://shopify.dev/docs/apps/build/devmcp",
        "params": [],
        "credential": None,
        "notes": "stdio servers run on the platform host and are disabled unless SCA_ALLOW_STDIO_MCP=true; requires Node.js 18+.",
        "config": {"transport": "stdio", "command": "npx", "args": ["-y", "@shopify/dev-mcp@1.16.0"], "timeout_s": 120},
    },
]

# --------------------------------------------------------------------------- Salesforce

_SF_LOGIN_HOST = {"key": "login_host", "label": "Login host", "default": "login.salesforce.com",
                  "pattern": r"^[a-z0-9-]+(\.[a-z0-9-]+)*\.(salesforce|force)\.com$",
                  "help": "login.salesforce.com for production, test.salesforce.com for sandboxes, or your My Domain "
                          "(e.g. acme.my.salesforce.com).", "normalize": "host"}
_SF_OAUTH_CLIENT = {
    "label": "External Client App",
    "help": "In Salesforce Setup → External Client App Manager, create an app with OAuth enabled, add the callback URL "
            "shown here, select the scopes listed below, and require PKCE (Salesforce now requires PKCE and refresh "
            "token rotation for External Client Apps). Paste its Consumer Key and Consumer Secret. A new app can take "
            "up to 30 minutes to become usable.",
}
_SF_PATH = {"type": "string", "pattern": r"^[A-Za-z0-9_]{1,80}$"}
_SF_ID = {"type": "string", "pattern": r"^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$", "description": "15- or 18-character record ID"}


def _salesforce_oauth(scopes: list[str]) -> dict[str, Any]:
    return {"authorize_url": "https://{{login_host}}/services/oauth2/authorize",
            "token_url": "https://{{login_host}}/services/oauth2/token",
            "revoke_url": "https://{{login_host}}/services/oauth2/revoke",
            "scopes": scopes, "pkce": True}


CONNECTORS += [
    {
        "key": "salesforce",
        "name": "Salesforce",
        "vendor": "Salesforce",
        "type": "http",
        "category": "business_api",
        "auth": "oauth2",
        "summary": "Accounts, contacts, leads, opportunities, cases and any custom object through the Salesforce REST "
                   "API: SOQL queries, search, record reads, and approval-gated create, update and delete.",
        "docs_url": "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",
        "params": [
            _SF_LOGIN_HOST,
            {"key": "api_version", "label": "API version", "default": "v67.0", "pattern": r"^v\d{2}\.0$",
             "help": "v67.0 is Summer '26; Winter '27 (v68.0) was still in preview on 2026-10-09."},
        ],
        "credential": None,
        "oauth_client": {**_SF_OAUTH_CLIENT, "scopes": "api, refresh_token (offline_access)"},
        "config": {
            "base_url": "https://{{login_host}}/services/data/{{api_version}}",
            "auth": {"type": "oauth2"},
            "oauth": {**_salesforce_oauth(["api", "refresh_token"]), "base_url_from_token": "instance_url"},
            "default_headers": {"Accept": "application/json"},
            "health_check_path": "/limits",
            "rate_limit_per_min": 120,
            "timeout_s": 60,
            "operations": [
                {"name": "soql_query", "description": "Run a SOQL query (always read-only), e.g. SELECT Id, Name, Amount, "
                                                      "StageName FROM Opportunity WHERE IsClosed = false ORDER BY Amount DESC "
                                                      "LIMIT 20. If done is false, pass nextRecordsUrl's last segment to query_next_page.",
                 "method": "GET", "path": "/query", "params_schema": _props(["q"], q={"type": "string", "description": "SOQL query"})},
                {"name": "query_next_page", "description": "Next page of a SOQL result (the locator after /query/ in nextRecordsUrl).",
                 "method": "GET", "path": "/query/{locator}",
                 "params_schema": _props(["locator"], locator={"type": "string", "pattern": r"^[A-Za-z0-9-]{10,40}$"})},
                {"name": "sosl_search", "description": "Full-text search across objects with SOSL, e.g. FIND {Acme} IN NAME "
                                                       "FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email).",
                 "method": "GET", "path": "/search", "params_schema": _props(["q"], q={"type": "string"})},
                {"name": "list_objects", "description": "All objects available to the connected user (standard and custom).",
                 "method": "GET", "path": "/sobjects"},
                {"name": "describe_object", "description": "Fields, types, picklist values and relationships of an object.",
                 "method": "GET", "path": "/sobjects/{sobject}/describe", "params_schema": _props(["sobject"], sobject=_SF_PATH)},
                {"name": "get_record", "description": "One record by ID; pass fields (comma-separated) to limit the response.",
                 "method": "GET", "path": "/sobjects/{sobject}/{record_id}",
                 "params_schema": _props(["sobject", "record_id"], sobject=_SF_PATH, record_id=_SF_ID, fields=_STR)},
                {"name": "get_limits", "description": "Org API limits and current usage.", "method": "GET", "path": "/limits"},
                {"name": "create_record", "description": "Create a record; body holds field values, e.g. {\"Name\": \"Acme\"}. "
                                                         "Waits for human approval.",
                 "method": "POST", "path": "/sobjects/{sobject}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["sobject", "body"], sobject=_SF_PATH, body=_OBJ)},
                {"name": "update_record", "description": "Update fields of a record (PATCH). Waits for human approval.",
                 "method": "PATCH", "path": "/sobjects/{sobject}/{record_id}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["sobject", "record_id", "body"], sobject=_SF_PATH, record_id=_SF_ID, body=_OBJ)},
                {"name": "delete_record", "description": "Delete a record (moves it to the Recycle Bin). Waits for human approval.",
                 "method": "DELETE", "path": "/sobjects/{sobject}/{record_id}", "enabled": False,
                 "params_schema": _props(["sobject", "record_id"], sobject=_SF_PATH, record_id=_SF_ID)},
            ],
        },
    },
    {
        "key": "salesforce_mcp",
        "name": "Salesforce Hosted MCP",
        "vendor": "Salesforce",
        "type": "mcp",
        "category": "business_api",
        "auth": "oauth2",
        "summary": "Salesforce's hosted MCP servers (generally available since April 2026): record tools that respect the "
                   "connected user's permissions, plus flows, invocable actions and more, depending on the server.",
        "docs_url": "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide",
        "params": [
            _SF_LOGIN_HOST,
            {"key": "environment", "label": "Environment", "default": "platform", "pattern": r"^(platform|sandbox)$",
             "help": "platform for production orgs, sandbox for sandbox and scratch orgs."},
            {"key": "server", "label": "Server", "default": "sobject-reads", "pattern": r"^[a-z0-9][a-z0-9-]{1,60}$",
             "help": "Enable it first in Setup → API Catalog → MCP Servers, e.g. sobject-reads, sobject-all, flows."},
        ],
        "credential": None,
        "oauth_client": {**_SF_OAUTH_CLIENT, "scopes": "mcp_api, refresh_token (offline_access) — not api",
                         "help": _SF_OAUTH_CLIENT["help"] + " For hosted MCP, also select 'Issue JSON Web Token (JWT)-based "
                                 "access tokens for named users'."},
        "notes": "Tokens are refreshed when each agent session starts; a session longer than the token lifetime may need a retry.",
        "config": {"transport": "http", "url": "https://api.salesforce.com/platform/mcp/v1/{{environment}}/{{server}}",
                   "auth_header": "Authorization", "auth_scheme": "Bearer", "timeout_s": 120, "auth_type": "oauth2",
                   "oauth": _salesforce_oauth(["mcp_api", "refresh_token"])},
    },
]

# --------------------------------------------------------------------------- SAP

_ODATA_QUERY = {
    "$filter": {"type": "string", "description": "OData filter, e.g. CreationDate ge datetime'2026-01-01T00:00:00'"},
    "$select": {"type": "string", "description": "Comma-separated properties"},
    "$orderby": _STR, "$expand": _STR,
    "$top": {"type": "integer", "maximum": 1000}, "$skip": {"type": "integer"},
    "$inlinecount": {"type": "string", "enum": ["allpages", "none"]},
}
_SAP_SERVICE = {"type": "string", "pattern": r"^[A-Z][A-Z0-9_]{2,60}$", "description": "OData service, e.g. API_BUSINESS_PARTNER"}
_SAP_ENTITY = {"type": "string", "pattern": r"^[A-Za-z][A-Za-z0-9_]{1,60}$", "description": "Entity set, e.g. A_BusinessPartner"}
_KEY = {"type": "string", "pattern": r"^[A-Za-z0-9_-]{1,40}$"}
_JSON = {"$format": "json"}


def _sap_read_ops() -> list[dict[str, Any]]:
    return [
        {"name": "odata_query", "description": "Read any entity set of an OData V2 service the communication arrangement "
                                               "exposes, with $filter/$select/$top paging.",
         "method": "GET", "path": "/{service}/{entity_set}", "default_query": {**_JSON, "$top": "50"},
         "params_schema": _props(["service", "entity_set"], service=_SAP_SERVICE, entity_set=_SAP_ENTITY, **_ODATA_QUERY)},
        {"name": "list_business_partners", "description": "Business partners (customers, suppliers, contacts).",
         "method": "GET", "path": "/API_BUSINESS_PARTNER/A_BusinessPartner",
         "default_query": {**_JSON, "$top": "50", "$select": "BusinessPartner,BusinessPartnerFullName,BusinessPartnerCategory,"
                                                              "BusinessPartnerGrouping,CreationDate"},
         "params_schema": _props(**_ODATA_QUERY)},
        {"name": "get_business_partner", "description": "One business partner; $expand=to_BusinessPartnerAddress for addresses.",
         "method": "GET", "path": "/API_BUSINESS_PARTNER/A_BusinessPartner('{business_partner}')", "default_query": _JSON,
         "params_schema": _props(["business_partner"], business_partner=_KEY, **{"$select": _STR, "$expand": _STR})},
        {"name": "list_sales_orders", "description": "Sales orders with sold-to party, amounts and processing status.",
         "method": "GET", "path": "/API_SALES_ORDER_SRV/A_SalesOrder",
         "default_query": {**_JSON, "$top": "50", "$select": "SalesOrder,SalesOrderType,SoldToParty,TotalNetAmount,"
                                                              "TransactionCurrency,OverallSDProcessStatus,CreationDate"},
         "params_schema": _props(**_ODATA_QUERY)},
        {"name": "get_sales_order", "description": "One sales order; $expand=to_Item for its items.",
         "method": "GET", "path": "/API_SALES_ORDER_SRV/A_SalesOrder('{sales_order}')", "default_query": _JSON,
         "params_schema": _props(["sales_order"], sales_order=_KEY, **{"$select": _STR, "$expand": _STR})},
        {"name": "list_products", "description": "Product master data.",
         "method": "GET", "path": "/API_PRODUCT_SRV/A_Product",
         "default_query": {**_JSON, "$top": "50", "$select": "Product,ProductType,ProductGroup,BaseUnit,CreationDate"},
         "params_schema": _props(**_ODATA_QUERY)},
    ]


CONNECTORS += [
    {
        "key": "sap_s4hana",
        "name": "SAP S4HANA",
        "vendor": "SAP",
        "type": "http",
        "category": "business_api",
        "summary": "Business partners, sales orders, products and any other released OData V2 API of SAP S/4HANA Cloud "
                   "(or on-premise via SAP Gateway). Writes use SAP's CSRF-token handshake and wait for approval.",
        "docs_url": "https://api.sap.com/products/SAPS4HANACloud/apis/ODATA",
        "params": [
            {"key": "host", "label": "API host", "normalize": "host",
             "pattern": r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$",
             "help": "e.g. my123456-api.s4hana.cloud.sap. On-premise hosts on a private network must also be listed in "
                     "SCA_ALLOWED_PRIVATE_HOSTS."},
            {"key": "username", "label": "Communication user", "pattern": r"^[A-Za-z0-9_.@-]{1,64}$",
             "help": "The communication user of the communication arrangement (e.g. SAP_COM_0008 for business partners, "
                     "SAP_COM_0109 for sales orders, SAP_COM_0009 for products)."},
        ],
        "credential": {"label": "Communication user password",
                       "help": "Stored encrypted. Grant the communication user only the arrangements the agents need."},
        "notes": "Basic authentication with a communication user is SAP's standard for S/4HANA Cloud communication "
                 "arrangements. Updates need the entity's ETag: read the record first and pass __metadata.etag as if_match.",
        "config": {
            "base_url": "https://{{host}}/sap/opu/odata/sap",
            "auth": {"type": "basic", "username": "{{username}}"},
            "default_headers": {"Accept": "application/json"},
            "csrf": {"header": "X-CSRF-Token", "fetch_path": "/API_BUSINESS_PARTNER/"},
            "health_check_path": "/API_BUSINESS_PARTNER/A_BusinessPartner?$top=1&$format=json",
            "rate_limit_per_min": 120,
            "timeout_s": 60,
            "operations": _sap_read_ops() + [
                {"name": "update_business_partner", "description": "Change fields of a business partner (PATCH). Pass the "
                                                                   "ETag from a prior read as if_match. Waits for human approval.",
                 "method": "PATCH", "path": "/API_BUSINESS_PARTNER/A_BusinessPartner('{business_partner}')",
                 "requires_approval": True, "enabled": False, "header_params": {"if_match": "If-Match"},
                 "params_schema": _props(["business_partner", "if_match", "body"], business_partner=_KEY,
                                         if_match={"type": "string"}, body=_OBJ)},
                {"name": "create_sales_order", "description": "Create a sales order with items (deep insert via to_Item). "
                                                              "Waits for human approval.",
                 "method": "POST", "path": "/API_SALES_ORDER_SRV/A_SalesOrder", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["body"], body=_OBJ)},
            ],
        },
    },
    {
        "key": "sap_api_sandbox",
        "name": "SAP API Sandbox",
        "vendor": "SAP",
        "type": "http",
        "category": "business_api",
        "summary": "SAP's public S/4HANA Cloud sandbox on the Business Accelerator Hub: realistic demo data, read-only. "
                   "Useful for trying SAP agents before connecting a real system.",
        "docs_url": "https://api.sap.com/api/API_BUSINESS_PARTNER/tryout",
        "params": [],
        "credential": {"label": "API key",
                       "help": "Sign in at api.sap.com and copy your API key (Show API Key on any API page)."},
        "config": {
            "base_url": "https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap",
            "auth": {"type": "api_key_header", "header_name": "APIKey"},
            "default_headers": {"Accept": "application/json"},
            "health_check_path": "/API_BUSINESS_PARTNER/A_BusinessPartner?$top=1&$format=json",
            "rate_limit_per_min": 60,
            "timeout_s": 60,
            "operations": _sap_read_ops(),
        },
    },
]

_BY_KEY = {c["key"]: c for c in CONNECTORS}


class ConnectorError(ValueError):
    pass


def public_catalog() -> list[dict[str, Any]]:
    """Connector metadata for the UI (no config internals beyond what helps a reviewer)."""
    out = []
    for c in CONNECTORS:
        item = {k: c[k] for k in ("key", "name", "vendor", "type", "category", "summary", "docs_url", "params", "credential")}
        item["notes"] = c.get("notes", "")
        item["auth"] = c.get("auth", "credential" if c.get("credential") else "none")
        item["oauth_client"] = c.get("oauth_client")
        item["available"], item["unavailable_reason"] = True, ""
        if c["type"] == "mcp" and c["config"].get("transport") == "stdio" and not get_settings().allow_stdio_mcp:
            item["available"] = False
            item["unavailable_reason"] = "Local (stdio) MCP servers are disabled on this deployment (SCA_ALLOW_STDIO_MCP=false)."
        if c["type"] == "http":
            item["operations"] = [
                {"name": o["name"], "method": o["method"], "description": o["description"],
                 "requires_approval": bool(o.get("requires_approval")), "enabled": o.get("enabled", True),
                 "read_only": o.get("graphql") == "query" or o["method"] == "GET"}
                for o in c["config"]["operations"]]
        out.append(item)
    return out


def _normalize(kind: str | None, value: str) -> str:
    v = value.strip()
    if kind == "shopify_shop":
        v = re.sub(r"^https?://", "", v.lower()).split("/")[0]
        v = v.removesuffix(".myshopify.com")
    elif kind == "host":
        v = re.sub(r"^https?://", "", v.lower()).split("/")[0]
    elif kind == "strip_act":
        v = v.removeprefix("act_")
    return v


def _fill(obj: Any, values: dict[str, str]) -> Any:
    if isinstance(obj, str):
        return re.sub(r"\{\{([a-z_]+)\}\}", lambda m: values[m.group(1)], obj)
    if isinstance(obj, list):
        return [_fill(x, values) for x in obj]
    if isinstance(obj, dict):
        return {k: _fill(v, values) for k, v in obj.items()}
    return obj


def instantiate(key: str, params: dict[str, Any]) -> dict[str, Any]:
    """Return ``{name, description, type, category, config}`` for an integration built from a connector."""
    c = _BY_KEY.get(key)
    if c is None:
        raise ConnectorError(f"unknown connector '{key}'")
    values: dict[str, str] = {}
    for p in c["params"]:
        raw = params.get(p["key"])
        raw = p.get("default", "") if raw in (None, "") else str(raw)
        v = _normalize(p.get("normalize"), raw)
        if not re.fullmatch(p["pattern"], v):
            raise ConnectorError(f"{p['label']}: '{v}' is not valid")
        values[p["key"]] = v
    unknown = set(params) - {p["key"] for p in c["params"]}
    if unknown:
        raise ConnectorError(f"unknown parameters: {sorted(unknown)}")
    config = _fill(copy.deepcopy(c["config"]), values)
    desc = c["summary"]
    if values:
        desc += " (" + ", ".join(f"{p['label']}: {values[p['key']]}" for p in c["params"]) + ")"
    return {"name": c["name"], "description": desc, "type": c["type"], "category": c["category"], "config": config}
