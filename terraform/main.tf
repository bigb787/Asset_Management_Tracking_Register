locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# ---------------------------------------------------------------------------
# DynamoDB — Asset table  (pay-per-request, ISO 27001: no over-provisioning)
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "assets" {
  name         = "${local.name_prefix}-assets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "assetId"

  attribute {
    name = "assetId"
    type = "S"
  }

  # GSI: query by assetType
  global_secondary_index {
    name            = "assetType-index"
    hash_key        = "assetType"
    projection_type = "ALL"
  }

  attribute {
    name = "assetType"
    type = "S"
  }

  # GSI: query by location
  global_secondary_index {
    name            = "location-index"
    hash_key        = "location"
    projection_type = "ALL"
  }

  attribute {
    name = "location"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${local.name_prefix}-assets"
  }
}

# ---------------------------------------------------------------------------
# S3 — Asset Exports bucket  (private, versioned, encrypted)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "exports" {
  bucket        = "${local.name_prefix}-exports-${data.aws_caller_identity.current.account_id}"
  force_destroy = false

  tags = {
    Name = "${local.name_prefix}-exports"
  }
}

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket                  = aws_s3_bucket.exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    id     = "expire-exports-30d"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda — package must be built before apply
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

# Lambda zip is pre-built by the CI pipeline (npm run build → zip dist/handler.js)
# and placed at dist/lambda.zip before terraform runs.
locals {
  lambda_zip_path = "${path.module}/../dist/lambda.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name_prefix}-api"
  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.lambda_exec.arn
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_sec

  environment {
    variables = {
      DYNAMODB_TABLE  = aws_dynamodb_table.assets.name
      S3_EXPORTS_BUCKET = aws_s3_bucket.exports.bucket
      ENVIRONMENT     = var.environment
    }
  }

  tracing_config {
    mode = "Active"
  }

  tags = {
    Name = "${local.name_prefix}-api"
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs]
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = 30
}

# ---------------------------------------------------------------------------
# API Gateway HTTP API  (v2 — lower cost, lower latency than REST API)
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "main" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId       = "$context.requestId"
      sourceIp        = "$context.identity.sourceIp"
      requestTime     = "$context.requestTime"
      protocol        = "$context.protocol"
      httpMethod      = "$context.httpMethod"
      resourcePath    = "$context.resourcePath"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      responseLength  = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = 30
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
