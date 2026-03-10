CREATE TABLE IF NOT EXISTS group_competition_config (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT NOT NULL UNIQUE,
  groups_json JSON NULL,
  organizers_json JSON NULL,
  scrambler_pool_json JSON NULL,
  published TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_assignment (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT NOT NULL,
  event_name VARCHAR(120) NOT NULL,
  round_name VARCHAR(80) NOT NULL,
  group_name VARCHAR(40) NOT NULL,
  role_name VARCHAR(40) NOT NULL,
  cck_id VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_group_assignment_competition (competition_id)
);
