terraform {
  required_version = ">= 1.13"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Remote state: S3 + DynamoDB lock (DESIGN.md §15). The bucket and table are
  # created once per account by infra/terraform/bootstrap (run manually with
  # admin credentials — they cannot exist before state storage does).
  # Fill in the real bucket/table names once the AWS accounts exist (P0 Q1).
  backend "s3" {
    bucket         = "saath-tfstate-CHANGE_ME" # bootstrap output
    key            = "envs/dev/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "saath-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = "ap-south-1" # Mumbai — data residency (DESIGN.md §2.1)

  default_tags {
    tags = {
      Project     = "saath"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
