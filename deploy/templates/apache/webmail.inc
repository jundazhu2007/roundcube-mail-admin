# Roundcube. Managed by the mail-admin installer.
Alias /roundcube /var/www/roundcube/public_html
<Directory /var/www/roundcube/public_html>
    Options -Indexes
    AllowOverride All
@WEBMAIL_REQUIRE@
</Directory>
