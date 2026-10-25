-- P2-04: A3 risk scoring reads KYC outcomes (and writes its own rows) in the
-- 'risk' service context — allow it alongside 'verification' on kyc_checks.

DROP POLICY kyc_checks_service_all ON "kyc_checks";

CREATE POLICY kyc_checks_service_all ON "kyc_checks" FOR ALL
  USING (current_setting('app.service', true) IN ('verification', 'risk'))
  WITH CHECK (current_setting('app.service', true) IN ('verification', 'risk'));
