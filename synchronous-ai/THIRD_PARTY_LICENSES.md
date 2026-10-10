# Third-party licenses

Synchronous Consulting AI depends on the open-source components below. Only the
license of the agent runtime it is built on is reproduced in full; for all other
packages consult the license file shipped inside each installed distribution
(`pip show -f <pkg>` / `node_modules/<pkg>/LICENSE`).

## OpenHands Software Agent SDK (openhands-sdk, openhands-tools, openhands-workspace 1.53.0) and the OpenHands agent-server container image

Source: https://github.com/OpenHands/software-agent-sdk

```
MIT License

Copyright (c) 2026 OpenHands contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other direct dependencies

| Component | License |
|---|---|
| FastAPI, Starlette, Uvicorn | MIT / BSD-3-Clause |
| SQLAlchemy, Alembic | MIT |
| LiteLLM (via the OpenHands SDK) | MIT |
| FastMCP, MCP Python SDK | Apache-2.0 / MIT |
| cryptography | Apache-2.0 OR BSD-3-Clause |
| argon2-cffi | MIT |
| httpx | BSD-3-Clause |
| croniter | MIT |
| pypdf | BSD-3-Clause |
| python-docx | MIT |
| beautifulsoup4 | MIT |
| openpyxl | MIT |
| Pillow | MIT-CMU (HPND) |
| numpy | BSD-3-Clause |
| psutil | BSD-3-Clause |
| psycopg | LGPL-3.0 (dynamically linked, unmodified) |
| React, React DOM | MIT |
| React Router | MIT |
| TanStack Query | MIT |
| lucide-react | ISC |
| react-markdown, remark-gfm | MIT |
| Inter, JetBrains Mono (self-hosted via @fontsource-variable) | SIL Open Font License 1.1 |
| Simple Icons 16.32.0 (connector logos, bundled) | CC0-1.0 |
| Vite, TypeScript, Playwright | MIT / Apache-2.0 |

### Brand logos

Connector logos come from Simple Icons, CC0-1.0. The logos themselves are trademarks of their
respective owners: Google, Meta, Shopify, SAP, HubSpot, Atlassian, GitHub, Stripe, Notion, Airtable,
Zendesk and others. They are shown only to identify the service a connector connects to. This does
not imply endorsement or affiliation. Each owner's brand guidelines apply; Simple Icons links them
per icon. Brands whose owners asked Simple Icons to remove their marks (for example Salesforce,
Microsoft and Slack) are deliberately not shown, and use a neutral monogram instead.
The Salesforce, Slack and Microsoft 365 logos in `frontend/src/assets/brand-logos/` are included
with the repository owner's permission from those companies. They are unmodified vendor files; see
the README in that folder for sources. Anyone redistributing this code needs their own permission,
or must remove those files.
