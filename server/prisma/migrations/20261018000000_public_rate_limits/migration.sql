CREATE TABLE `PublicRateBucket` (
  `key` VARCHAR(120) NOT NULL,
  `hits` INTEGER NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `PublicRateBucket_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
