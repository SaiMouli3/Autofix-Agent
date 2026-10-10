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
_NUM = {"type": "integer", "minimum": 1}
_KEY_LONG = {"type": "string", "pattern": r"^[A-Za-z0-9_@.=+-]{1,200}$"}
_GH = {"type": "string", "pattern": r"^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$"}
_HS_TYPE = {"type": "string", "pattern": r"^[a-z0-9_]{2,40}$", "description": "contacts, companies, deals, tickets, …"}
_JIRA_KEY = {"type": "string", "pattern": r"^[A-Za-z0-9_-]{1,40}$", "description": "e.g. OPS-123"}
_STRIPE_ID = {"type": "string", "pattern": r"^[A-Za-z0-9_]{3,100}$"}


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
            "token rotation for External Client Apps). Paste its Consumer Key and Consumer Secret as the client ID and secret. A new app can take "
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

# --------------------------------------------------------------------------- Google Workspace

_GOOGLE_CLIENT = {
    "label": "Google OAuth client",
    "help": "In Google Cloud Console → APIs & Services: enable the API, configure the OAuth consent screen (Internal "
            "for apps used only inside your Workspace organization), then create an OAuth client of type Web "
            "application with the callback URL shown here. One client can serve Gmail, Calendar and Drive.",
}


# GitHub OAuth App (authorization code + PKCE; GitHub accepts S256 since July 2025). OAuth App tokens
# do not expire and come without a refresh token; disconnecting deletes the app grant.
_GITHUB_OAUTH = {"provider": "github",
                 "authorize_url": "https://github.com/login/oauth/authorize",
                 "token_url": "https://github.com/login/oauth/access_token",
                 "revoke_url": "https://api.github.com/applications/{client_id}/grant", "revoke_style": "github_grant",
                 "scopes": ["repo", "read:user"], "pkce": True}


def _google_oauth(scopes: list[str]) -> dict[str, Any]:
    return {"authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "revoke_url": "https://oauth2.googleapis.com/revoke",
            "scopes": scopes, "pkce": True,
            # offline + consent: Google only issues a refresh token on an explicit consent.
            "extra_authorize_params": {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}}


_EMAIL_FIELDS = {
    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipient addresses"},
    "cc": {"type": "array", "items": {"type": "string"}}, "bcc": {"type": "array", "items": {"type": "string"}},
    "subject": {"type": "string"}, "body": {"type": "string", "description": "Plain-text body"},
    "html": {"type": "string", "description": "Optional HTML alternative"},
    "thread_id": {"type": "string", "description": "Reply within this Gmail thread"},
    "in_reply_to": {"type": "string", "description": "Message-ID header of the message being answered"},
}

CONNECTORS += [
    {
        "key": "gmail", "name": "Gmail", "vendor": "Google", "type": "http", "category": "communication", "auth": "oauth2",
        "summary": "Search and read mail as clean text, read whole threads, and draft replies. Sending is approval-gated "
                   "and off by default.",
        "docs_url": "https://developers.google.com/workspace/gmail/api/reference/rest",
        "params": [],
        "credential": None,
        "oauth_client": {**_GOOGLE_CLIENT, "scopes": "gmail.readonly, gmail.compose"},
        "notes": "gmail.readonly is a restricted scope: public apps need Google verification and a security "
                 "assessment; an Internal app in your own Workspace does not.",
        "config": {
            "base_url": "https://gmail.googleapis.com/gmail/v1/users/me",
            "auth": {"type": "oauth2"},
            "oauth": _google_oauth(["https://www.googleapis.com/auth/gmail.readonly",
                                    "https://www.googleapis.com/auth/gmail.compose"]),
            "health_check_path": "/profile", "rate_limit_per_min": 120, "timeout_s": 30,
            "operations": [
                {"name": "search_messages", "description": "Find messages with Gmail search syntax, e.g. q='from:acme.com "
                                                           "is:unread newer_than:7d'. Returns ids; read them with get_message.",
                 "method": "GET", "path": "/messages", "default_query": {"maxResults": "20"},
                 "params_schema": _props(q=_STR, maxResults={"type": "integer", "maximum": 100}, pageToken=_STR,
                                         labelIds=_STR, includeSpamTrash={"type": "boolean"})},
                {"name": "get_message", "description": "One message with sender, recipients, subject, date, plain-text body "
                                                       "and attachment names.",
                 "method": "GET", "path": "/messages/{message_id}", "default_query": {"format": "full"},
                 "decode": "gmail_message", "params_schema": _props(["message_id"], message_id=_KEY_LONG)},
                {"name": "get_thread", "description": "A whole conversation, each message decoded to plain text.",
                 "method": "GET", "path": "/threads/{thread_id}", "default_query": {"format": "full"},
                 "decode": "gmail_thread", "params_schema": _props(["thread_id"], thread_id=_KEY_LONG)},
                {"name": "list_labels", "description": "Labels (folders) in the mailbox.", "method": "GET", "path": "/labels"},
                {"name": "create_draft", "description": "Create a draft for a person to review and send. Pass thread_id and "
                                                        "in_reply_to to draft a reply. Waits for human approval.",
                 "method": "POST", "path": "/drafts", "compose": "gmail_draft", "requires_approval": True,
                 "params_schema": _props(["to", "subject", "body"], **_EMAIL_FIELDS)},
                {"name": "send_message", "description": "Send an email from the connected account. Waits for human approval.",
                 "method": "POST", "path": "/messages/send", "compose": "gmail_raw", "requires_approval": True,
                 "enabled": False, "params_schema": _props(["to", "subject", "body"], **_EMAIL_FIELDS)},
            ],
        },
    },
    {
        "key": "google_calendar", "name": "Google Calendar", "vendor": "Google", "type": "http", "category": "business_api",
        "auth": "oauth2",
        "summary": "Read calendars and events, check free/busy across people, and create events (approval-gated).",
        "docs_url": "https://developers.google.com/workspace/calendar/api/v3/reference",
        "params": [], "credential": None,
        "oauth_client": {**_GOOGLE_CLIENT, "scopes": "calendar.readonly, calendar.events"},
        "config": {
            "base_url": "https://www.googleapis.com/calendar/v3",
            "auth": {"type": "oauth2"},
            "oauth": _google_oauth(["https://www.googleapis.com/auth/calendar.readonly",
                                    "https://www.googleapis.com/auth/calendar.events"]),
            "health_check_path": "/users/me/calendarList?maxResults=1", "rate_limit_per_min": 120, "timeout_s": 30,
            "operations": [
                {"name": "list_calendars", "description": "Calendars the user can see.", "method": "GET",
                 "path": "/users/me/calendarList"},
                {"name": "list_events", "description": "Events in a calendar (use calendar_id 'primary' for the user's own). "
                                                       "timeMin/timeMax are RFC 3339 timestamps.",
                 "method": "GET", "path": "/calendars/{calendar_id}/events",
                 "default_query": {"singleEvents": "true", "orderBy": "startTime", "maxResults": "50"},
                 "params_schema": _props(["calendar_id"], calendar_id=_STR, timeMin=_STR, timeMax=_STR, q=_STR, pageToken=_STR)},
                {"name": "free_busy", "description": "Busy intervals for calendars/people, e.g. body {timeMin, timeMax, "
                                                     "items: [{id: 'a@acme.com'}]}.",
                 "method": "POST", "path": "/freeBusy", "read_only": True, "params_schema": _props(["body"], body=_OBJ)},
                {"name": "create_event", "description": "Create an event; body {summary, start: {dateTime, timeZone}, end, "
                                                        "attendees: [{email}]}. Waits for human approval.",
                 "method": "POST", "path": "/calendars/{calendar_id}/events", "requires_approval": True,
                 "params_schema": _props(["calendar_id", "body"], calendar_id=_STR, body=_OBJ,
                                         sendUpdates={"type": "string", "enum": ["all", "externalOnly", "none"]})},
            ],
        },
    },
    {
        "key": "google_drive", "name": "Google Drive", "vendor": "Google", "type": "http", "category": "documents",
        "auth": "oauth2",
        "summary": "Search Drive and shared drives, read file details, and export Google Docs, Sheets and Slides as text. "
                   "Read-only.",
        "docs_url": "https://developers.google.com/workspace/drive/api/reference/rest/v3",
        "params": [], "credential": None,
        "oauth_client": {**_GOOGLE_CLIENT, "scopes": "drive.readonly"},
        "config": {
            "base_url": "https://www.googleapis.com/drive/v3",
            "auth": {"type": "oauth2"},
            "oauth": _google_oauth(["https://www.googleapis.com/auth/drive.readonly"]),
            "health_check_path": "/about?fields=user", "rate_limit_per_min": 120, "timeout_s": 60,
            "operations": [
                {"name": "search_files", "description": "Search with Drive query syntax, e.g. q=\"name contains 'pricing' and "
                                                        "mimeType = 'application/vnd.google-apps.document'\".",
                 "method": "GET", "path": "/files",
                 "default_query": {"pageSize": "25", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
                                   "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,owners(displayName),webViewLink)"},
                 "params_schema": _props(q=_STR, pageToken=_STR, orderBy=_STR, fields=_STR)},
                {"name": "get_file", "description": "File metadata.", "method": "GET", "path": "/files/{file_id}",
                 "default_query": {"supportsAllDrives": "true", "fields": "id,name,mimeType,size,modifiedTime,owners,webViewLink"},
                 "params_schema": _props(["file_id"], file_id=_KEY_LONG, fields=_STR)},
                {"name": "export_document", "description": "Export a Google Doc/Sheet/Slides file; mimeType text/plain for "
                                                           "Docs and Slides, text/csv for the first sheet of a Sheet.",
                 "method": "GET", "path": "/files/{file_id}/export", "default_query": {"mimeType": "text/plain"},
                 "params_schema": _props(["file_id"], file_id=_KEY_LONG, mimeType=_STR)},
                {"name": "download_file", "description": "Content of a non-Google file (text formats are most useful).",
                 "method": "GET", "path": "/files/{file_id}", "default_query": {"alt": "media", "supportsAllDrives": "true"},
                 "params_schema": _props(["file_id"], file_id=_KEY_LONG)},
            ],
        },
    },
]

# --------------------------------------------------------------------------- Microsoft 365

CONNECTORS += [
    {
        "key": "microsoft_365", "name": "Microsoft 365", "vendor": "Microsoft", "type": "http", "category": "communication",
        "auth": "oauth2",
        "summary": "Outlook mail and calendar, OneDrive/SharePoint file search and Teams channels through Microsoft "
                   "Graph. Sending mail, creating events and posting to Teams wait for approval.",
        "docs_url": "https://learn.microsoft.com/graph/api/overview",
        "params": [
            {"key": "tenant", "label": "Directory (tenant) ID", "default": "organizations",
             "pattern": r"^[A-Za-z0-9][A-Za-z0-9.-]{1,63}$",
             "help": "Your Entra ID tenant ID or domain (e.g. acme.onmicrosoft.com). 'organizations' accepts any work account."},
        ],
        "credential": None,
        "oauth_client": {
            "label": "Entra ID app registration",
            "help": "In the Microsoft Entra admin center → App registrations → New registration: add a Web redirect URI "
                    "with the callback URL shown here, create a client secret, and add the delegated Microsoft Graph "
                    "permissions listed below (grant admin consent if your tenant requires it).",
            "scopes": "offline_access, User.Read, Mail.Read, Mail.Send, Calendars.ReadWrite, Files.Read.All, "
                      "Team.ReadBasic.All, Channel.ReadBasic.All, ChannelMessage.Send",
        },
        "config": {
            "base_url": "https://graph.microsoft.com/v1.0",
            "auth": {"type": "oauth2"},
            "oauth": {"authorize_url": "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/authorize",
                      "token_url": "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/token",
                      "scopes": ["offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.ReadWrite",
                                 "Files.Read.All", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"],
                      "pkce": True},
            "default_headers": {"Prefer": 'outlook.body-content-type="text"'},
            "health_check_path": "/me?$select=displayName,mail", "rate_limit_per_min": 120, "timeout_s": 30,
            "operations": [
                {"name": "list_messages", "description": "Recent mail. Use $search (e.g. \"\\\"invoice\\\"\") or $filter "
                                                         "(e.g. isRead eq false); $search cannot be combined with $orderby.",
                 "method": "GET", "path": "/me/messages",
                 "default_query": {"$top": "25", "$select": "id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId"},
                 "params_schema": _props(**{"$search": _STR, "$filter": _STR, "$top": {"type": "integer"}, "$skip": {"type": "integer"},
                                            "$orderby": _STR})},
                {"name": "get_message", "description": "One message with its plain-text body.", "method": "GET",
                 "path": "/me/messages/{message_id}",
                 "default_query": {"$select": "subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,internetMessageId"},
                 "params_schema": _props(["message_id"], message_id=_KEY_LONG)},
                {"name": "create_reply_draft", "description": "Create a reply draft (in Drafts) for a person to review; body "
                                                              "{comment}. Waits for human approval.",
                 "method": "POST", "path": "/me/messages/{message_id}/createReply", "requires_approval": True,
                 "params_schema": _props(["message_id", "body"], message_id=_KEY_LONG, body=_OBJ)},
                {"name": "send_mail", "description": "Send mail; body {message: {subject, body: {contentType: 'Text', content}, "
                                                     "toRecipients: [{emailAddress: {address}}]}}. Waits for human approval.",
                 "method": "POST", "path": "/me/sendMail", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["body"], body=_OBJ)},
                {"name": "calendar_view", "description": "Events between two ISO 8601 times (expands recurring events).",
                 "method": "GET", "path": "/me/calendarView",
                 "default_query": {"$top": "50", "$orderby": "start/dateTime",
                                   "$select": "subject,start,end,location,organizer,attendees,isOnlineMeeting"},
                 "params_schema": _props(["startDateTime", "endDateTime"], startDateTime=_STR, endDateTime=_STR)},
                {"name": "create_event", "description": "Create an event; body {subject, start: {dateTime, timeZone}, end, "
                                                        "attendees: [{emailAddress: {address}, type: 'required'}]}. Waits for human approval.",
                 "method": "POST", "path": "/me/events", "requires_approval": True, "params_schema": _props(["body"], body=_OBJ)},
                {"name": "search_files", "description": "Search the user's OneDrive (and shared files) by name and content.",
                 "method": "GET", "path": "/me/drive/root/search(q='{query}')",
                 "default_query": {"$select": "id,name,webUrl,lastModifiedDateTime,size,file"},
                 "params_schema": _props(["query"], query={"type": "string", "pattern": r"^[^'\n]{1,200}$"})},
                {"name": "list_teams", "description": "Teams the user belongs to.", "method": "GET", "path": "/me/joinedTeams"},
                {"name": "list_channels", "description": "Channels of a team.", "method": "GET", "path": "/teams/{team_id}/channels",
                 "params_schema": _props(["team_id"], team_id=_KEY_LONG)},
                {"name": "post_channel_message", "description": "Post to a Teams channel; body {body: {content}}. Waits for "
                                                                "human approval.",
                 "method": "POST", "path": "/teams/{team_id}/channels/{channel_id}/messages", "requires_approval": True,
                 "params_schema": _props(["team_id", "channel_id", "body"], team_id=_KEY_LONG, channel_id=_KEY_LONG, body=_OBJ)},
            ],
        },
    },
]

# --------------------------------------------------------------------------- Slack, Notion, Airtable

CONNECTORS += [
    {
        "key": "slack", "name": "Slack", "vendor": "Slack", "type": "http", "category": "communication", "auth": "oauth2",
        "summary": "Read channels, history and threads, look up people, and post messages (approval-gated) as your Slack app.",
        "docs_url": "https://docs.slack.dev/reference/methods",
        "params": [], "credential": None,
        "oauth_client": {
            "label": "Slack app",
            "help": "At api.slack.com/apps → Create New App: under OAuth & Permissions add the redirect URL shown here and "
                    "the bot token scopes below. Enabling token rotation is recommended; the platform handles the "
                    "12-hour refresh. Invite the bot to the channels it should read.",
            "scopes": "channels:read, channels:history, groups:read, groups:history, users:read, chat:write",
        },
        "config": {
            "base_url": "https://slack.com/api",
            "auth": {"type": "oauth2"},
            "oauth": {"authorize_url": "https://slack.com/oauth/v2/authorize",
                      "token_url": "https://slack.com/api/oauth.v2.access",
                      "scopes": ["channels:read", "channels:history", "groups:read", "groups:history", "users:read", "chat:write"],
                      "scope_separator": ",", "pkce": False},
            "health_check_path": "/auth.test", "health_ok_field": "ok", "rate_limit_per_min": 50, "timeout_s": 30,
            "operations": [
                {"name": "list_channels", "description": "Channels the bot can see.", "method": "GET", "path": "/conversations.list",
                 "default_query": {"exclude_archived": "true", "limit": "200", "types": "public_channel,private_channel"},
                 "params_schema": _props(cursor=_STR, types=_STR)},
                {"name": "channel_history", "description": "Recent messages in a channel (oldest/latest are Unix timestamps).",
                 "method": "GET", "path": "/conversations.history", "default_query": {"limit": "50"},
                 "params_schema": _props(["channel"], channel=_STR, oldest=_STR, latest=_STR, cursor=_STR)},
                {"name": "thread_replies", "description": "Replies in a thread (ts of the parent message).",
                 "method": "GET", "path": "/conversations.replies",
                 "params_schema": _props(["channel", "ts"], channel=_STR, ts=_STR, cursor=_STR)},
                {"name": "user_info", "description": "Name, title and time zone of a user ID.", "method": "GET",
                 "path": "/users.info", "params_schema": _props(["user"], user=_STR)},
                {"name": "post_message", "description": "Post a message; body {channel, text, thread_ts?}. Waits for human approval.",
                 "method": "POST", "path": "/chat.postMessage", "requires_approval": True,
                 "params_schema": _props(["body"], body=_OBJ)},
            ],
        },
    },
    {
        "key": "notion", "name": "Notion", "vendor": "Notion", "type": "http", "category": "documents",
        "summary": "Search pages and databases, read page content, and query databases; create pages and append content "
                   "with approval.",
        "docs_url": "https://developers.notion.com/reference/intro",
        "params": [
            {"key": "notion_version", "label": "Notion API version", "default": "2025-09-03",
             "pattern": r"^\d{4}-\d{2}-\d{2}$", "help": "Sent as the Notion-Version header on every request."},
        ],
        "credential": {"label": "Internal integration secret",
                       "help": "At notion.so/profile/integrations create an internal integration for your workspace, copy "
                               "its secret, then share the pages or databases agents may use with the integration "
                               "(… menu → Connections)."},
        "config": {
            "base_url": "https://api.notion.com/v1",
            "auth": {"type": "bearer"},
            "default_headers": {"Notion-Version": "{{notion_version}}"},
            "health_check_path": "/users/me", "rate_limit_per_min": 150, "timeout_s": 30,
            "operations": [
                {"name": "search", "description": "Search shared pages and databases by title; body {query, filter?, page_size?}.",
                 "method": "POST", "path": "/search", "read_only": True, "params_schema": _props(body=_OBJ)},
                {"name": "get_page", "description": "Page properties.", "method": "GET", "path": "/pages/{page_id}",
                 "params_schema": _props(["page_id"], page_id=_KEY_LONG)},
                {"name": "get_page_content", "description": "Blocks (paragraphs, headings, lists…) of a page or block.",
                 "method": "GET", "path": "/blocks/{block_id}/children", "default_query": {"page_size": "100"},
                 "params_schema": _props(["block_id"], block_id=_KEY_LONG, start_cursor=_STR)},
                {"name": "query_data_source", "description": "Rows of a database (data source) with filter/sorts in body.",
                 "method": "POST", "path": "/data_sources/{data_source_id}/query", "read_only": True,
                 "params_schema": _props(["data_source_id"], data_source_id=_KEY_LONG, body=_OBJ)},
                {"name": "create_page", "description": "Create a page under a page or database; body {parent, properties, "
                                                       "children?}. Waits for human approval.",
                 "method": "POST", "path": "/pages", "requires_approval": True, "params_schema": _props(["body"], body=_OBJ)},
                {"name": "append_content", "description": "Append blocks to a page; body {children: [...]}. Waits for human approval.",
                 "method": "PATCH", "path": "/blocks/{block_id}/children", "requires_approval": True,
                 "params_schema": _props(["block_id", "body"], block_id=_KEY_LONG, body=_OBJ)},
            ],
        },
    },
    {
        "key": "airtable", "name": "Airtable", "vendor": "Airtable", "type": "http", "category": "database",
        "summary": "List bases and table schemas and read records with formulas and views; create and update records "
                   "with approval.",
        "docs_url": "https://airtable.com/developers/web/api/introduction",
        "params": [],
        "credential": {"label": "Personal access token",
                       "help": "At airtable.com/create/tokens create a token with data.records:read, schema.bases:read "
                               "(and data.records:write if you enable changes), limited to the bases agents need."},
        "config": {
            "base_url": "https://api.airtable.com/v0",
            "auth": {"type": "bearer"},
            "health_check_path": "/meta/whoami", "rate_limit_per_min": 250, "timeout_s": 30,
            "operations": [
                {"name": "list_bases", "description": "Bases the token can access.", "method": "GET", "path": "/meta/bases"},
                {"name": "get_base_schema", "description": "Tables and fields of a base.", "method": "GET",
                 "path": "/meta/bases/{base_id}/tables", "params_schema": _props(["base_id"], base_id=_KEY)},
                {"name": "list_records", "description": "Records of a table; filterByFormula, view, maxRecords, offset.",
                 "method": "GET", "path": "/{base_id}/{table}", "default_query": {"pageSize": "100"},
                 "params_schema": _props(["base_id", "table"], base_id=_KEY, table=_STR, filterByFormula=_STR, view=_STR,
                                         maxRecords={"type": "integer"}, offset=_STR)},
                {"name": "create_records", "description": "Create up to 10 records; body {records: [{fields: {...}}]}. Waits "
                                                          "for human approval.",
                 "method": "POST", "path": "/{base_id}/{table}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["base_id", "table", "body"], base_id=_KEY, table=_STR, body=_OBJ)},
                {"name": "update_records", "description": "Update up to 10 records; body {records: [{id, fields}]}. Waits for "
                                                          "human approval.",
                 "method": "PATCH", "path": "/{base_id}/{table}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["base_id", "table", "body"], base_id=_KEY, table=_STR, body=_OBJ)},
            ],
        },
    },
]

# --------------------------------------------------------------------------- CRM, support, dev, payments

CONNECTORS += [
    {
        "key": "hubspot", "name": "HubSpot", "vendor": "HubSpot", "type": "http", "category": "business_api",
        "summary": "Contacts, companies, deals and tickets through the HubSpot CRM API: list, search and read; create and "
                   "update with approval.",
        "docs_url": "https://developers.hubspot.com/docs/api/crm/understanding-the-crm",
        "params": [],
        "credential": {"label": "Private app access token",
                       "help": "In HubSpot → Settings → Integrations → Private Apps, create an app with the crm.objects.*.read "
                               "scopes (and .write if you enable changes) and copy its access token."},
        "config": {
            "base_url": "https://api.hubapi.com",
            "auth": {"type": "bearer"},
            "health_check_path": "/crm/v3/objects/contacts?limit=1", "rate_limit_per_min": 100, "timeout_s": 30,
            "operations": [
                {"name": "list_objects", "description": "Records of a type (contacts, companies, deals, tickets); properties "
                                                        "is a comma-separated list.",
                 "method": "GET", "path": "/crm/v3/objects/{object_type}", "default_query": {"limit": "50"},
                 "params_schema": _props(["object_type"], object_type=_HS_TYPE, properties=_STR, after=_STR)},
                {"name": "search_objects", "description": "Search records; body {filterGroups, sorts, properties, limit}, e.g. "
                                                          "deals with dealstage = closedwon.",
                 "method": "POST", "path": "/crm/v3/objects/{object_type}/search", "read_only": True,
                 "params_schema": _props(["object_type", "body"], object_type=_HS_TYPE, body=_OBJ)},
                {"name": "get_object", "description": "One record with chosen properties and associations.",
                 "method": "GET", "path": "/crm/v3/objects/{object_type}/{object_id}",
                 "params_schema": _props(["object_type", "object_id"], object_type=_HS_TYPE, object_id=_KEY,
                                         properties=_STR, associations=_STR)},
                {"name": "create_object", "description": "Create a record; body {properties: {...}}. Waits for human approval.",
                 "method": "POST", "path": "/crm/v3/objects/{object_type}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["object_type", "body"], object_type=_HS_TYPE, body=_OBJ)},
                {"name": "update_object", "description": "Update a record; body {properties: {...}}. Waits for human approval.",
                 "method": "PATCH", "path": "/crm/v3/objects/{object_type}/{object_id}", "requires_approval": True,
                 "enabled": False,
                 "params_schema": _props(["object_type", "object_id", "body"], object_type=_HS_TYPE, object_id=_KEY, body=_OBJ)},
            ],
        },
    },
    {
        "key": "zendesk", "name": "Zendesk", "vendor": "Zendesk", "type": "http", "category": "business_api",
        "summary": "Search and read tickets and their conversations; add comments or change status with approval.",
        "docs_url": "https://developer.zendesk.com/api-reference/ticketing/introduction/",
        "params": [
            {"key": "subdomain", "label": "Zendesk subdomain", "pattern": r"^[a-z0-9][a-z0-9-]{0,62}$",
             "help": "acme for acme.zendesk.com."},
            {"key": "email", "label": "Agent email", "pattern": r"^[^@\s/]+@[^@\s/]+\.[^@\s/]+$",
             "help": "The Zendesk agent the API token belongs to."},
        ],
        "credential": {"label": "API token", "help": "Admin Center → Apps and integrations → Zendesk API → add an API token."},
        "config": {
            "base_url": "https://{{subdomain}}.zendesk.com/api/v2",
            "auth": {"type": "basic", "username": "{{email}}/token"},
            "health_check_path": "/users/me.json", "rate_limit_per_min": 200, "timeout_s": 30,
            "operations": [
                {"name": "search", "description": "Search with Zendesk syntax, e.g. query='type:ticket status<solved "
                                                  "priority:urgent'.",
                 "method": "GET", "path": "/search.json", "params_schema": _props(["query"], query=_STR, page=_STR)},
                {"name": "get_ticket", "description": "One ticket.", "method": "GET", "path": "/tickets/{ticket_id}.json",
                 "params_schema": _props(["ticket_id"], ticket_id=_NUM)},
                {"name": "ticket_comments", "description": "The conversation on a ticket.", "method": "GET",
                 "path": "/tickets/{ticket_id}/comments.json", "params_schema": _props(["ticket_id"], ticket_id=_NUM)},
                {"name": "update_ticket", "description": "Add a comment and/or change fields; body {ticket: {comment: {body, "
                                                         "public}, status?}}. Use public=false for internal notes. Waits for "
                                                         "human approval.",
                 "method": "PUT", "path": "/tickets/{ticket_id}.json", "requires_approval": True,
                 "params_schema": _props(["ticket_id", "body"], ticket_id=_NUM, body=_OBJ)},
            ],
        },
    },
    {
        "key": "jira", "name": "Jira", "vendor": "Atlassian", "type": "http", "category": "developer_tools",
        "summary": "Search issues with JQL, read issues and transitions; create issues, comment and move status with approval.",
        "docs_url": "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
        "params": [
            {"key": "site", "label": "Site", "pattern": r"^[a-z0-9][a-z0-9-]{0,62}$", "help": "acme for acme.atlassian.net."},
            {"key": "email", "label": "Account email", "pattern": r"^[^@\s/]+@[^@\s/]+\.[^@\s/]+$",
             "help": "The Atlassian account the API token belongs to."},
        ],
        "credential": {"label": "API token",
                       "help": "Create one at id.atlassian.com/manage-profile/security/api-tokens (agents act with that "
                               "account's Jira permissions; consider a dedicated service account)."},
        "config": {
            "base_url": "https://{{site}}.atlassian.net/rest/api/3",
            "auth": {"type": "basic", "username": "{{email}}"},
            "default_headers": {"Accept": "application/json"},
            "health_check_path": "/myself", "rate_limit_per_min": 100, "timeout_s": 30,
            "operations": [
                {"name": "search_issues", "description": "Search with JQL, e.g. project = OPS AND statusCategory != Done ORDER "
                                                         "BY priority DESC. Paginate with nextPageToken.",
                 "method": "GET", "path": "/search/jql",
                 "default_query": {"maxResults": "50", "fields": "summary,status,assignee,priority,updated,issuetype"},
                 "params_schema": _props(["jql"], jql=_STR, fields=_STR, nextPageToken=_STR)},
                {"name": "get_issue", "description": "One issue with its fields.", "method": "GET", "path": "/issue/{issue_key}",
                 "params_schema": _props(["issue_key"], issue_key=_JIRA_KEY, fields=_STR)},
                {"name": "get_transitions", "description": "Status changes available for an issue.", "method": "GET",
                 "path": "/issue/{issue_key}/transitions", "params_schema": _props(["issue_key"], issue_key=_JIRA_KEY)},
                {"name": "create_issue", "description": "Create an issue; body {fields: {project: {key}, summary, issuetype: "
                                                        "{name}, description (Atlassian Document Format)}}. Waits for human approval.",
                 "method": "POST", "path": "/issue", "requires_approval": True, "params_schema": _props(["body"], body=_OBJ)},
                {"name": "add_comment", "description": "Comment on an issue; body {body: {type: 'doc', version: 1, content: "
                                                       "[{type: 'paragraph', content: [{type: 'text', text}]}]}}. Waits for "
                                                       "human approval.",
                 "method": "POST", "path": "/issue/{issue_key}/comment", "requires_approval": True,
                 "params_schema": _props(["issue_key", "body"], issue_key=_JIRA_KEY, body=_OBJ)},
                {"name": "transition_issue", "description": "Move an issue; body {transition: {id}} from get_transitions. Waits "
                                                            "for human approval.",
                 "method": "POST", "path": "/issue/{issue_key}/transitions", "requires_approval": True,
                 "params_schema": _props(["issue_key", "body"], issue_key=_JIRA_KEY, body=_OBJ)},
            ],
        },
    },
    {
        "key": "github", "name": "GitHub", "vendor": "GitHub", "type": "http", "category": "developer_tools",
        "auth": "oauth2",
        "summary": "Sign in with GitHub, then search and read issues and pull requests across your repositories; open "
                   "issues and comment with approval.",
        "docs_url": "https://docs.github.com/rest",
        "params": [],
        "credential": None,
        "oauth_client": {"label": "GitHub OAuth App",
                         "help": "Usually set once for the whole organization in Settings → Sign-in apps. GitHub → "
                                 "Settings → Developer settings → OAuth Apps → New OAuth App, with the callback URL "
                                 "shown here.",
                         "scopes": "repo, read:user"},
        "config": {
            "base_url": "https://api.github.com",
            "auth": {"type": "oauth2"},
            "oauth": _GITHUB_OAUTH,
            "default_headers": {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
            "health_check_path": "/user", "rate_limit_per_min": 80, "timeout_s": 30,
            "operations": [
                {"name": "search_issues", "description": "Search issues and PRs, e.g. q='repo:acme/api is:open is:pr "
                                                         "review-requested:@me'.",
                 "method": "GET", "path": "/search/issues", "default_query": {"per_page": "30"},
                 "params_schema": _props(["q"], q=_STR, page={"type": "integer"})},
                {"name": "list_issues", "description": "Issues of a repository (state=open|closed|all).", "method": "GET",
                 "path": "/repos/{owner}/{repo}/issues", "default_query": {"per_page": "30", "state": "open"},
                 "params_schema": _props(["owner", "repo"], owner=_GH, repo=_GH, state=_STR, labels=_STR, page={"type": "integer"})},
                {"name": "get_issue", "description": "One issue or PR summary.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/issues/{number}",
                 "params_schema": _props(["owner", "repo", "number"], owner=_GH, repo=_GH, number=_NUM)},
                {"name": "list_pull_requests", "description": "Pull requests of a repository.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/pulls", "default_query": {"per_page": "30", "state": "open"},
                 "params_schema": _props(["owner", "repo"], owner=_GH, repo=_GH, state=_STR)},
                {"name": "list_pr_files", "description": "Files changed in a pull request, with patches.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/pulls/{number}/files",
                 "params_schema": _props(["owner", "repo", "number"], owner=_GH, repo=_GH, number=_NUM)},
                {"name": "create_issue", "description": "Open an issue; body {title, body, labels?}. Waits for human approval.",
                 "method": "POST", "path": "/repos/{owner}/{repo}/issues", "requires_approval": True,
                 "params_schema": _props(["owner", "repo", "body"], owner=_GH, repo=_GH, body=_OBJ)},
                {"name": "comment", "description": "Comment on an issue or PR; body {body}. Waits for human approval.",
                 "method": "POST", "path": "/repos/{owner}/{repo}/issues/{number}/comments", "requires_approval": True,
                 "params_schema": _props(["owner", "repo", "number", "body"], owner=_GH, repo=_GH, number=_NUM, body=_OBJ)},
            ],
        },
    },
    {
        "key": "github_pat", "name": "GitHub (access token)", "vendor": "GitHub", "type": "http", "category": "developer_tools",
        "summary": "For automation accounts: a fine-grained personal access token instead of sign-in. Search and read issues and pull requests across repositories; open issues and comment with approval.",
        "docs_url": "https://docs.github.com/rest",
        "params": [],
        "credential": {"label": "Fine-grained personal access token",
                       "help": "github.com/settings/personal-access-tokens: limit it to the repositories agents need, with "
                               "Issues and Pull requests read (and write if you enable changes)."},
        "config": {
            "base_url": "https://api.github.com",
            "auth": {"type": "bearer"},
            "default_headers": {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
            "health_check_path": "/user", "rate_limit_per_min": 80, "timeout_s": 30,
            "operations": [
                {"name": "search_issues", "description": "Search issues and PRs, e.g. q='repo:acme/api is:open is:pr "
                                                         "review-requested:@me'.",
                 "method": "GET", "path": "/search/issues", "default_query": {"per_page": "30"},
                 "params_schema": _props(["q"], q=_STR, page={"type": "integer"})},
                {"name": "list_issues", "description": "Issues of a repository (state=open|closed|all).", "method": "GET",
                 "path": "/repos/{owner}/{repo}/issues", "default_query": {"per_page": "30", "state": "open"},
                 "params_schema": _props(["owner", "repo"], owner=_GH, repo=_GH, state=_STR, labels=_STR, page={"type": "integer"})},
                {"name": "get_issue", "description": "One issue or PR summary.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/issues/{number}",
                 "params_schema": _props(["owner", "repo", "number"], owner=_GH, repo=_GH, number=_NUM)},
                {"name": "list_pull_requests", "description": "Pull requests of a repository.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/pulls", "default_query": {"per_page": "30", "state": "open"},
                 "params_schema": _props(["owner", "repo"], owner=_GH, repo=_GH, state=_STR)},
                {"name": "list_pr_files", "description": "Files changed in a pull request, with patches.", "method": "GET",
                 "path": "/repos/{owner}/{repo}/pulls/{number}/files",
                 "params_schema": _props(["owner", "repo", "number"], owner=_GH, repo=_GH, number=_NUM)},
                {"name": "create_issue", "description": "Open an issue; body {title, body, labels?}. Waits for human approval.",
                 "method": "POST", "path": "/repos/{owner}/{repo}/issues", "requires_approval": True,
                 "params_schema": _props(["owner", "repo", "body"], owner=_GH, repo=_GH, body=_OBJ)},
                {"name": "comment", "description": "Comment on an issue or PR; body {body}. Waits for human approval.",
                 "method": "POST", "path": "/repos/{owner}/{repo}/issues/{number}/comments", "requires_approval": True,
                 "params_schema": _props(["owner", "repo", "number", "body"], owner=_GH, repo=_GH, number=_NUM, body=_OBJ)},
            ],
        },
    },
    {
        "key": "github_mcp", "name": "GitHub MCP", "vendor": "GitHub", "type": "mcp", "category": "developer_tools",
        "summary": "GitHub's official remote MCP server: repositories, code, issues, pull requests, Actions and more as MCP tools.",
        "docs_url": "https://github.com/github/github-mcp-server",
        "params": [],
        "credential": {"label": "Fine-grained personal access token",
                       "help": "Scope it to the repositories and permissions agents should have; the server enforces them. "
                               "Use Allowed tools to restrict write tools."},
        "config": {"transport": "http", "url": "https://api.githubcopilot.com/mcp/", "auth_header": "Authorization",
                   "auth_scheme": "Bearer", "timeout_s": 120},
    },
    {
        "key": "stripe", "name": "Stripe", "vendor": "Stripe", "type": "http", "category": "business_api",
        "summary": "Balance, customers, payments, invoices and subscriptions from Stripe, read-only.",
        "docs_url": "https://docs.stripe.com/api",
        "params": [],
        "credential": {"label": "Restricted API key",
                       "help": "Dashboard → Developers → API keys → Create restricted key with Read access only to the "
                               "resources agents need (rk_live_… or rk_test_…). Never use the secret key."},
        "notes": "Read-only by design: payment-changing operations are not offered.",
        "config": {
            "base_url": "https://api.stripe.com/v1",
            "auth": {"type": "bearer"},
            "health_check_path": "/balance", "rate_limit_per_min": 100, "timeout_s": 30,
            "operations": [
                {"name": "get_balance", "description": "Available and pending balance per currency.", "method": "GET", "path": "/balance"},
                {"name": "search_customers", "description": "Search customers, e.g. query=\"email:'jo@acme.com'\".",
                 "method": "GET", "path": "/customers/search", "params_schema": _props(["query"], query=_STR, limit={"type": "integer"}, page=_STR)},
                {"name": "get_customer", "description": "One customer.", "method": "GET", "path": "/customers/{customer_id}",
                 "params_schema": _props(["customer_id"], customer_id=_STRIPE_ID)},
                {"name": "list_payment_intents", "description": "Payments, newest first (customer, created[gte] filters).",
                 "method": "GET", "path": "/payment_intents", "default_query": {"limit": "25"},
                 "params_schema": _props(customer=_STR, starting_after=_STR)},
                {"name": "list_invoices", "description": "Invoices (customer, status=draft|open|paid|uncollectible|void).",
                 "method": "GET", "path": "/invoices", "default_query": {"limit": "25"},
                 "params_schema": _props(customer=_STR, status=_STR, starting_after=_STR)},
                {"name": "list_subscriptions", "description": "Subscriptions (customer, status).", "method": "GET",
                 "path": "/subscriptions", "default_query": {"limit": "25"},
                 "params_schema": _props(customer=_STR, status=_STR, starting_after=_STR)},
            ],
        },
    },
    {
        "key": "stripe_mcp", "name": "Stripe MCP", "vendor": "Stripe", "type": "mcp", "category": "business_api",
        "summary": "Stripe's official MCP server; the tools available follow the permissions of the restricted key you use.",
        "docs_url": "https://docs.stripe.com/mcp",
        "params": [],
        "credential": {"label": "Restricted API key",
                       "help": "Create a restricted key with only the permissions agents need; Stripe's server exposes tools "
                               "accordingly."},
        "config": {"transport": "http", "url": "https://mcp.stripe.com", "auth_header": "Authorization",
                   "auth_scheme": "Bearer", "timeout_s": 120},
    },
]

# --------------------------------------------------------------------------- gallery metadata

# group: gallery section · popularity: ordering in "Popular" · suggest_for: agent categories it suits
_GALLERY: dict[str, tuple[str, int, list[str]]] = {
    "gmail": ("communication", 100, ["sales", "support", "research", "operations"]),
    "microsoft_365": ("communication", 98, ["sales", "support", "operations", "finance"]),
    "slack": ("communication", 96, ["support", "engineering", "operations", "sales"]),
    "google_calendar": ("productivity", 90, ["sales", "operations"]),
    "google_drive": ("productivity", 92, ["research", "finance", "analytics", "operations"]),
    "notion": ("productivity", 86, ["research", "operations", "engineering", "support"]),
    "salesforce": ("crm", 94, ["sales", "support", "analytics"]),
    "hubspot": ("crm", 88, ["sales", "marketing", "analytics"]),
    "zendesk": ("support", 80, ["support"]),
    "jira": ("developer", 85, ["engineering", "operations"]),
    "github": ("developer", 87, ["engineering"]),
    "github_pat": ("developer", 50, []),
    "github_mcp": ("developer", 70, ["engineering"]),
    "stripe": ("finance", 82, ["finance", "analytics", "sales"]),
    "stripe_mcp": ("finance", 60, ["finance"]),
    "shopify_admin": ("commerce", 84, ["sales", "operations", "analytics", "marketing"]),
    "meta_marketing": ("marketing", 78, ["marketing", "analytics"]),
    "meta_ads_mcp": ("marketing", 62, ["marketing"]),
    "whatsapp_cloud": ("communication", 76, ["support", "sales"]),
    "sap_s4hana": ("erp", 74, ["finance", "operations"]),
    "sap_api_sandbox": ("erp", 40, ["finance", "operations"]),
    "airtable": ("data", 72, ["operations", "analytics"]),
    "salesforce_mcp": ("crm", 66, ["sales", "support"]),
    "shopify_dev_mcp": ("developer", 45, ["engineering"]),
}
GROUPS = {"communication": "Email & chat", "productivity": "Productivity", "crm": "CRM & sales", "support": "Support",
          "developer": "Developer", "finance": "Payments & finance", "commerce": "Commerce", "marketing": "Marketing",
          "erp": "ERP", "data": "Data"}
for _c in CONNECTORS:
    _c["group"], _c["popularity"], _c["suggest_for"] = _GALLERY[_c["key"]]

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
        item["group"], item["group_label"] = c["group"], GROUPS[c["group"]]
        item["popularity"], item["suggest_for"] = c["popularity"], c["suggest_for"]
        item["available"], item["unavailable_reason"] = True, ""
        if c["type"] == "mcp" and c["config"].get("transport") == "stdio" and not get_settings().allow_stdio_mcp:
            item["available"] = False
            item["unavailable_reason"] = "Local (stdio) MCP servers are disabled on this deployment (SCA_ALLOW_STDIO_MCP=false)."
        if c["type"] == "http":
            item["operations"] = [
                {"name": o["name"], "method": o["method"], "description": o["description"],
                 # effective values, as validate_config enforces them (DELETE is always destructive + approval)
                 "requires_approval": bool(o.get("requires_approval") or o.get("destructive") or o["method"] == "DELETE"),
                 "destructive": bool(o.get("destructive") or o["method"] == "DELETE"),
                 "enabled": o.get("enabled", True),
                 "read_only": o.get("graphql") == "query" or bool(o.get("read_only")) or o["method"] == "GET"}
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


_ROLE_WORDS = [
    ("sales", ("sales", "account", "revenue", "business development", "crm")),
    ("support", ("support", "customer", "service", "helpdesk", "success")),
    ("finance", ("finance", "accounting", "billing", "procurement")),
    ("operations", ("operations", "ops", "admin", "logistics", "supply")),
    ("engineering", ("engineering", "software", "devops", "developer", "it ", "platform")),
    ("analytics", ("analytics", "analysis", "data", "insight", "bi")),
    ("research", ("research", "analyst", "strategy", "consult")),
    ("marketing", ("marketing", "growth", "ads", "brand", "content")),
]


def role_of(text: str) -> str | None:
    t = f" {text.lower()} "
    for role, words in _ROLE_WORDS:
        if any(w in t for w in words):
            return role
    return None


def rank_suggestions(agents: list[tuple[str, str]], connected: set[str], limit: int = 6) -> dict[str, str]:
    """Suggest connectors for the organization's agents.

    ``agents`` is ``[(name, category)]``. A connector scores one point per agent whose role it suits;
    popularity breaks ties. Connectors already in use are skipped. With no agents yet, the most
    widely used general-purpose connectors are suggested instead. Returns ``{key: reason}`` in rank order.
    """
    roles: dict[str, list[str]] = {}
    for name, category in agents:
        role = role_of(category or "") or role_of(name or "")
        if role:
            roles.setdefault(role, []).append(name)
    scored = []
    for c in CONNECTORS:
        if c["key"] in connected:
            continue
        hits = [r for r in c["suggest_for"] if r in roles]
        if roles and not hits:
            continue
        n = sum(len(roles[r]) for r in hits)
        scored.append((n, c["popularity"], c, hits))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out: dict[str, str] = {}
    vendors: set[str] = set()
    picked = []
    for item in scored:  # one suggestion per vendor (e.g. Salesforce, not also Salesforce MCP)
        if item[2]["vendor"] in vendors and item[2]["key"] not in ("google_calendar", "google_drive", "gmail"):
            continue
        vendors.add(item[2]["vendor"])
        picked.append(item)
    for n, _pop, c, hits in picked[:limit]:
        if hits:
            names = [a for r in hits for a in roles[r]]
            shown = ", ".join(dict.fromkeys(names[:3]))
            more = len(set(names)) - len(dict.fromkeys(names[:3]))
            out[c["key"]] = f"Fits {shown}{f' and {more} more' if more > 0 else ''}"
        else:
            out[c["key"]] = "Widely used starting point"
    return out
