locals {
  name_prefix = "saath-staging"
  azs         = ["ap-south-1a", "ap-south-1b"]
}

module "network" {
  source = "../../modules/network"

  name_prefix           = local.name_prefix
  cidr                  = "10.20.0.0/16"
  azs                   = local.azs
  public_subnet_cidrs   = ["10.20.0.0/24", "10.20.1.0/24"]
  private_subnet_cidrs  = ["10.20.10.0/24", "10.20.11.0/24"]
  isolated_subnet_cidrs = ["10.20.20.0/24", "10.20.21.0/24"]
}

module "kms" {
  source = "../../modules/kms"

  name_prefix = local.name_prefix
}

module "database" {
  source = "../../modules/database"

  name_prefix         = local.name_prefix
  vpc_id              = module.network.vpc_id
  isolated_subnet_ids = module.network.isolated_subnet_ids
  ecs_sg_id           = module.network.ecs_sg_id
  kms_key_arn         = module.kms.key_arns["c2c3"]

  instance_class    = "db.t4g.small"
  multi_az          = true # staging mirrors prod topology; runs on anonymised seed data only
  allocated_storage = 20
}

module "cache" {
  source = "../../modules/cache"

  name_prefix         = local.name_prefix
  vpc_id              = module.network.vpc_id
  isolated_subnet_ids = module.network.isolated_subnet_ids
  ecs_sg_id           = module.network.ecs_sg_id
  kms_key_arn         = module.kms.key_arns["c2c3"]
  node_type           = "cache.t4g.small"
}

module "cloudtrail" {
  source = "../../modules/cloudtrail"

  name_prefix = local.name_prefix
  kms_key_arn = module.kms.key_arns["logs"]
}

output "rds_endpoint" { value = module.database.endpoint }
output "redis_endpoint" { value = module.cache.endpoint }
output "kms_key_arns" { value = module.kms.key_arns }
