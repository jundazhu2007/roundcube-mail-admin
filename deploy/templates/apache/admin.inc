# Admin panel (static frontend + API reverse proxy). Managed by the mail-admin installer.
Alias /admin @INSTALL_DIR@/frontend/dist
<Directory @INSTALL_DIR@/frontend/dist>
    Options -Indexes
    AllowOverride None
@ADMIN_REQUIRE@
    FallbackResource /admin/index.html
</Directory>
<Location /api>
@ADMIN_REQUIRE@
</Location>
ProxyPass /api http://127.0.0.1:@API_PORT@/api
ProxyPassReverse /api http://127.0.0.1:@API_PORT@/api
