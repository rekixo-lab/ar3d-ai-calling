# AR3D AI Calling

[Open the client dashboard](https://aicalling.ar3dstudio.in/app). After account activation, clients use their email and password on this page.

AR3D runs the property questionnaire, validates answers and saves them to the tenant's CRM. Cloudflare Workers runs the application, D1 stores tenant and customer records, private R2 stores question prompts, and Workers AI converts short spoken answers to text. Plivo handles the telephone connection.

## Workflow

1. A Super Admin creates a client and sends its private invitation. The client sets a password and can return at any time via the dashboard.
2. The client previews and imports an Excel or CSV file with **Name** and **Mobile**, then creates a calling campaign. Importing data or creating a campaign does not call anyone.
3. A Super Admin runs an approved internal number through the seven-question test and verifies the CRM result. Customer campaigns require separate activation and tenant approval.
4. An authorized client can start or pause approved campaigns. The application runs the queue in the background and displays call status. Customers can opt out by pressing 2 or stating a supported stop request. Valid, complete answers update the CRM.

See [phone setup and pilot verification](docs/scripted-phone-pilot.md), [campaign operations](docs/CUSTOMER-CALLING.md), and [production deployment](docs/MAIN-DEPLOYMENT.md).

## Development verification

```sh
npm test
npm install --no-save --ignore-scripts playwright@1.56.1
CI=1 node scripts/browser-e2e.mjs
CI=1 node scripts/calling-browser-e2e.mjs
```

The browser tests use Chrome and localhost fixtures. The guarded deployment workflow verifies the isolated Cloudflare resources and runs public smoke checks. The pilot and customer calling are disabled in a fresh deployment.
