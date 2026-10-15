-- Tables the admin panel and Postfix read/write. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS domains (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id  INT UNSIGNED NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,            -- {SHA512-CRYPT} hash produced by `doveadm pw`
  quota_mb   INT UNSIGNED NOT NULL DEFAULT 10240,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_domain FOREIGN KEY (domain_id) REFERENCES domains(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aliases (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id   INT UNSIGNED NOT NULL,
  source      VARCHAR(255) NOT NULL UNIQUE,    -- the alias address
  destination VARCHAR(255) NOT NULL,           -- the mailbox it forwards to
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aliases_domain FOREIGN KEY (domain_id) REFERENCES domains(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
