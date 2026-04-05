output "api_endpoint" {
  description = "Base URL for the Asset Manager API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB assets table"
  value       = aws_dynamodb_table.assets.name
}

output "dynamodb_table_arn" {
  description = "ARN of the DynamoDB assets table"
  value       = aws_dynamodb_table.assets.arn
}

output "exports_bucket_name" {
  description = "S3 bucket for exported Excel files"
  value       = aws_s3_bucket.exports.bucket
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.api.function_name
}

output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.api.arn
}

output "github_actions_role_arn" {
  description = "IAM Role ARN for GitHub Actions OIDC — set as GH secret AWS_ROLE_ARN"
  value       = aws_iam_role.github_actions.arn
}

output "account_id" {
  description = "AWS Account ID"
  value       = data.aws_caller_identity.current.account_id
}
