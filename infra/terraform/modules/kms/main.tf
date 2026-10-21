# KMS module: customer-managed keys per data class (DESIGN.md §10.1, §12.4).
# The C4 key is separate so its key policy can be restricted to the crypto-module role.

variable "name_prefix" { type = string }

locals {
  keys = {
    c2c3 = "Standard data encryption (C2/C3): RDS, S3, Redis, backups"
    c4   = "Restricted field-level encryption (C4): phone, email, KYC refs — crypto module role only"
    logs = "Logs and audit (CloudTrail, audit_log export bucket)"
  }
}

resource "aws_kms_key" "data_class" {
  for_each                = local.keys
  description             = each.value
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = { Name = "${var.name_prefix}-kms-${each.key}", DataClass = each.key }
}

resource "aws_kms_alias" "data_class" {
  for_each      = local.keys
  name          = "alias/${var.name_prefix}-${each.key}"
  target_key_id = aws_kms_key.data_class[each.key].key_id
}

output "key_arns" { value = { for k, v in aws_kms_key.data_class : k => v.arn } }
output "c4_key_arn" { value = aws_kms_key.data_class["c4"].arn }
