# Cache module: ElastiCache Redis with TLS + AUTH (DESIGN.md §4, §12.4).

variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "isolated_subnet_ids" { type = list(string) }
variable "ecs_sg_id" { type = string }
variable "kms_key_arn" { type = string }
variable "node_type" { type = string }

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.isolated_subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis"
  description = "Redis: inbound 6379 from ECS tasks only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from ECS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.ecs_sg_id]
  }
}

resource "random_password" "redis_auth" {
  length  = 64
  special = false # AUTH tokens disallow some special chars
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name       = "${var.name_prefix}/redis/auth-token"
  kms_key_id = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Saath Redis (rate limits, OTP state, token budgets)"

  node_type          = var.node_type
  num_cache_clusters = 1
  engine_version     = "7.1"
  port               = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  automatic_failover_enabled = false # single node in dev; staging/prod enable
  snapshot_retention_limit   = 1

  tags = { Name = "${var.name_prefix}-redis" }
}

output "endpoint" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
