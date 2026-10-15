<?php
// Managed by the mail-admin installer. Re-running the installer rewrites this file.
$config = [];

$config['db_dsnw'] = 'mysql://roundcube:@RC_DB_PASS@@unix(/run/mysqld/mysqld.sock)/roundcube';

// Dovecot / Postfix on this host. The certificate is checked against the public hostname even though
// we connect over loopback.
$config['imap_host'] = 'ssl://127.0.0.1:993';
$config['smtp_host'] = 'tls://127.0.0.1:587';
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';
$config['imap_conn_options'] = [
    'ssl' => [
        'verify_peer' => @RC_SSL_VERIFY@,
        'verify_peer_name' => @RC_SSL_VERIFY@,
        'peer_name' => '@MAIL_HOSTNAME@',
    ],
];
$config['smtp_conn_options'] = $config['imap_conn_options'];

$config['des_key'] = '@RC_DES_KEY@';
$config['product_name'] = '@WEBMAIL_NAME@';
$config['support_url'] = '';
$config['skin'] = '@ROUNDCUBE_SKIN@';
$config['language'] = '@WEBMAIL_LANGUAGE@';
$config['plugins'] = [@RC_PLUGINS_PHP@];
$config['max_message_size'] = '@MAX_MESSAGE_MB@M';
$config['enable_installer'] = false;
$config['temp_dir'] = '/var/lib/roundcube/temp/';

// The admin panel's "Webmail logins" page reads this file.
$config['log_logins'] = true;
$config['log_dir'] = '/var/log/roundcube/';
@RC_PROXY_LINES@
