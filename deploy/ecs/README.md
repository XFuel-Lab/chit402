# SP1 Prover on ECS Fargate (Succinct network mode)

Runs the prover in network mode (`SP1_PROVER=network`) as a single on/off Fargate task. No GPU: heavy proving is delegated to the Succinct prover network; this container only holds the circuit, builds witnesses, and submits.

Identifiers are not stored in this tree. Export them in the shell or in the untracked file `services/sp1-prover/aws-env.local.ps1` (see `aws-env.local.ps1.example`).

| Variable | Meaning |
|----------|---------|
| `AWS_ACCOUNT_ID` | 12-digit AWS account id |
| `AWS_REGION` | Region (examples use `us-east-1`) |
| `ECS_CLUSTER` | ECS cluster name |
| `ECR_REPOSITORY` | ECR repository name |
| `AWS_SECRET_ARN` | Secrets Manager ARN for the prover key |
| `SP1_PROVER_URL` | Base URL the gateway uses to reach the prover |
| `ALB_HOST` | Load balancer hostname, if you record one locally |

The task definition template is `sp1-prover-task.json`. Placeholders: `<AWS_ACCOUNT_ID>`, `<ECS_CLUSTER>`, `<ECR_REPOSITORY>`, `<AWS_SECRET_ARN>`.

```bash
bash deploy/ecs/register-task.sh deploy/ecs/sp1-prover-task.json
```

The gateway reaches the prover via `SP1_PROVER_URL`.

---

## Deploy identity permissions

The image push only needed ECR. This deploy step additionally needs: ECS
(`AmazonECS_FullAccess`), `iam:PassRole` for the task role, plus IAM role
management if you create `ecsTaskExecutionRole` yourself (or let the ECS console
create it for you). CloudWatch Logs `logs:CreateLogGroup` for the log group.

## 1. Get the secret ARN

```bash
aws secretsmanager describe-secret \
  --secret-id NETWORK_PRIVATE_KEY --region "$AWS_REGION" \
  --query ARN --output text
```

Put that value in `AWS_SECRET_ARN`. The template references `<AWS_SECRET_ARN>`.

## 2. Task execution role (`ecsTaskExecutionRole`)

If it doesn't already exist (the ECS console can auto-create it), create it with:
ECR pull + CloudWatch logs (`AmazonECSTaskExecutionRolePolicy`) and read
access to the prover key. The resource ARN is `AWS_SECRET_ARN` (or the same
secret's wildcard form).

## 3. Log group + register the task definition

```bash
aws logs create-log-group --log-group-name "/ecs/${ECS_CLUSTER}" --region "$AWS_REGION"
bash deploy/ecs/register-task.sh
```

## 4. Create the service

In the ECS console, open cluster `$ECS_CLUSTER` and create a service:

- Launch type Fargate, task family `$ECS_CLUSTER`, desired tasks 1
- Networking: pick your VPC and subnets
- Load balancer: attach an application load balancer, target group port 80,
  health check path `/health`, health check grace period 300s (key gen takes minutes)
- The load balancer gives a stable DNS name. Use it as `SP1_PROVER_URL`

## 5. Lock down the security group

The prover has no auth on `/prove`. On the load balancer security group, allow inbound
80/443 only from the gateway host (`<ORIGIN_HOST>/32`). Deny all else.

## 6. Wire the backend

On the gateway host `.env`:

```bash
SP1_PROVER_URL=http://<ALB_HOST>
```

Remove any stale prover URL overrides, then restart the gateway unit.

## On / Off

Scale the service in `$ECS_CLUSTER` to zero to stop paying for the container when no proofs are needed:

```bash
aws ecs update-service --cluster "$ECS_CLUSTER" --service sp1-prover \
  --desired-count 0 --region "$AWS_REGION"
aws ecs update-service --cluster "$ECS_CLUSTER" --service sp1-prover \
  --desired-count 1 --region "$AWS_REGION"
```

When off, inference still works; proofs report `unavailable`.

`GET /health` reports a `proofs` block:

```json
"proofs": {
  "signed_receipts": "always",
  "settlement_proof": "unavailable",
  "prover_configured": false,
  "allow_list_size": 0
}
```

`unavailable` means nothing is reachable. `allow_listed` means the prover is up but gated to named keys.

Scaling to zero stops the task. An idle load balancer keeps billing until it is deleted. If you delete it, the DNS name changes, so update `SP1_PROVER_URL` when it comes back.

Cold start is several minutes for proving-key generation. Scale up before a proof session, not during one.

For a public demo, run the prover off by default and only spin it up for allow-listed partners:

```bash
PROVER_ENABLED=false
PROVER_ALLOW_KEYS=
```

Public traffic keeps getting inference and signed receipts the whole time.
