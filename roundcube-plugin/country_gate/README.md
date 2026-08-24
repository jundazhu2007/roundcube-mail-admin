# country_gate (Roundcube plugin)

Enforces the country allow/blacklist configured on the mail-admin **Webmail
Policy** page (`PageWebmailPolicy.jsx` → `/api/webmail-policy`). On every
Roundcube login attempt it calls the mail-admin API's `/api/webmail-policy/check`
endpoint (localhost only, no auth needed) with the client IP, and rejects the
login if the API says the IP's country isn't allowed.

**Fail-open by design**: if the API is slow, down, or returns something
unexpected, the plugin lets the login through. A misbehaving policy check must
never be able to lock every user out of webmail.

## Install

```bash
cp -r roundcube-plugin/country_gate /var/www/roundcube/plugins/country_gate
```

Then add `'country_gate'` to `$config['plugins']` in Roundcube's
`config/config.inc.php`.

Requires the mail-admin API to be running on `127.0.0.1:8000` (the default).
If you run it elsewhere, edit the URL in `country_gate.php`.
