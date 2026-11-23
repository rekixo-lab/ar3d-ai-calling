# Automatic operations

The isolated Calling Worker uses one cron slot. Every minute it checks the customer calling gate before accessing the campaign queue. At the start of every hour, using the existing one-minute trigger, it removes at most 100 expired records per auth table: login sessions, MFA challenges, invitations and rate-limit artifacts. It does not delete customer CRM rows, opt-out evidence or recordings. It preserves client and CRM records.

The GitHub Actions monitor makes read-only requests to the custom hostname. It checks the health endpoint, portal and assets, the authentication barrier and the retired provider route. A manual check can also use `npm run smoke:main -- https://aicalling.ar3dstudio.in`.

See [production deployment](MAIN-DEPLOYMENT.md) and [customer campaign operation](CUSTOMER-CALLING.md).
