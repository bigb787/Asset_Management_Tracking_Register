variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "eu-west-2"
}

variable "environment" {
  description = "Deployment environment (dev / staging / prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project identifier used to name all resources"
  type        = string
  default     = "asset-tracker"
}

# ------------------------------------------------------------------
# Backend (bootstrap) — set in terraform/backend.tf or via CLI
# ------------------------------------------------------------------
variable "tf_state_bucket" {
  description = "S3 bucket that holds Terraform state (must already exist)"
  type        = string
  default     = "asset-tracker-tf-state"
}

variable "tf_state_lock_table" {
  description = "DynamoDB table used for Terraform state locking (must already exist)"
  type        = string
  default     = "asset-tracker-tf-locks"
}

# ------------------------------------------------------------------
# GitHub OIDC
# ------------------------------------------------------------------
variable "github_org" {
  description = "GitHub organisation or username (e.g. bigb787)"
  type        = string
  default     = "bigb787"
}

variable "github_repo" {
  description = "GitHub repository name (without org prefix)"
  type        = string
  default     = "Asset_Management_Tracking_Register"
}

# ------------------------------------------------------------------
# Lambda
# ------------------------------------------------------------------
variable "lambda_memory_mb" {
  description = "Lambda memory allocation in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout_sec" {
  description = "Lambda execution timeout in seconds"
  type        = number
  default     = 30
}

variable "lambda_runtime" {
  description = "Lambda runtime identifier"
  type        = string
  default     = "nodejs20.x"
}
