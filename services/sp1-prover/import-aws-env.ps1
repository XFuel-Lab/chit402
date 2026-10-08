# Load deploy identifiers from the environment or an untracked local file.
# Copy aws-env.local.ps1.example to aws-env.local.ps1 and fill it in there.
# Do not commit real values.
#
# AWS_ACCOUNT_ID, ECS_CLUSTER, ECS_SERVICE, ECR_REPOSITORY, AWS_SECRET_ARN,
# AWS_SECURITY_GROUP_ID,
# SP1_PROVER_URL, SP1_PROVER_HOST, SP1_PROVER_PORT, PROVER_DEPLOYMENT_NAME

$script:AwsEnvLoaded = $false

function Import-UntrackedAwsEnv {
    if ($script:AwsEnvLoaded) { return }
    $script:AwsEnvLoaded = $true

    $localPs1 = Join-Path $PSScriptRoot 'aws-env.local.ps1'
    if (Test-Path $localPs1) { . $localPs1 }

    $dotenv = @(
        (Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local'),
        (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.env.local')
    )
    $keys = @(
        'AWS_ACCOUNT_ID', 'ECS_CLUSTER', 'ECS_SERVICE', 'ECR_REPOSITORY', 'AWS_SECRET_ARN',
        'AWS_SECURITY_GROUP_ID',
        'SP1_PROVER_URL', 'SP1_PROVER_HOST', 'SP1_PROVER_PORT', 'PROVER_DEPLOYMENT_NAME',
        'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION'
    )
    foreach ($file in $dotenv) {
        if (-not (Test-Path $file)) { continue }
        foreach ($raw in Get-Content $file) {
            foreach ($key in $keys) {
                $prefix = "$key="
                if ($raw.StartsWith($prefix)) {
                    Set-Item -Path "Env:$key" -Value $raw.Substring($prefix.Length)
                }
            }
        }
    }
}

function Require-NamedEnv([string]$Name) {
    Import-UntrackedAwsEnv
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Set $Name in the environment or services/sp1-prover/aws-env.local.ps1 (untracked)."
    }
    return $value
}

function Require-AwsAccountId {
    $value = Require-NamedEnv 'AWS_ACCOUNT_ID'
    if ($value -notmatch '^\d{12}$') {
        throw 'AWS_ACCOUNT_ID must be the 12-digit AWS account id.'
    }
    return $value
}
