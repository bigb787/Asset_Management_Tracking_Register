# ---------------------------------------------------------------------------
# Remote backend — S3 + DynamoDB locking
#
# BOOTSTRAP ONCE before first `terraform init`:
#   aws s3api create-bucket \
#     --bucket asset-tracker-tf-state \
#     --region eu-west-2 \
#     --create-bucket-configuration LocationConstraint=eu-west-2 \
#     --profile my-asset-project
#
#   aws s3api put-bucket-versioning \
#     --bucket asset-tracker-tf-state \
#     --versioning-configuration Status=Enabled \
#     --profile my-asset-project
#
#   aws dynamodb create-table \
#     --table-name asset-tracker-tf-locks \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST \
#     --region eu-west-2 \
#     --profile my-asset-project
# ---------------------------------------------------------------------------
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "asset-tracker-tf-state-755231954480"
    key            = "asset-tracker/prod/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "asset-tracker-tf-locks"
    encrypt        = true
  }
}

# Profile is used locally only (AWS_PROFILE=my-asset-project).
# In GitHub Actions, OIDC injects credentials via env vars automatically.
provider "aws" {
  region  = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
