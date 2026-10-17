ALTER TABLE `User`
  ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `demoExpiresAt` DATETIME(3) NULL;

CREATE INDEX `User_isDemo_demoExpiresAt_idx` ON `User`(`isDemo`, `demoExpiresAt`);
