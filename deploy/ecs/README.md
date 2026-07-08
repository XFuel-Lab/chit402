# SP1 Prover on ECS Fargate (Succinct network mode)

Runs the `sp1-prover` in **network mode** (`SP1_PROVER=network`) as a single
on/off Fargate task. No GPU: heavy proving is delegated to the Succinct prover
network; this container only holds the circuit, builds witnesses, and submits.

- **Region:** `us-east-1`  ·  **Account:** `187510174358`
- **Cluster:** `xfuel-sp1-prover`
- **Image:** `187510174358.dkr.ecr.us-east-1.amazonaws.com/xfuel-sp1-prover:network`
- **Secret:** `NETWORK_PRIVATE_KEY` injected from Secrets Manager (never in the image)

The backend (Lightsail) reaches this via `SP1_PROVER_URL`.

---

## Deploy identity permissions

The image push only needed ECR. This deploy step additionally needs: ECS
(`AmazonECS_FullAccess`), `iam:PassRole` for the task role, plus IAM role
management if you create `ecsTaskExecutionRole` yourself (or let the ECS console
create it for you). CloudWatch Logs `logs:CreateLogGroup` for the log group.

## 1. Get the secret ARN and put it in the task def

```bash
aws secretsmanager describe-secret \
  --secret-id NETWORK_PRIVATE_KEY --region us-east-1 \
  --query ARN --output text
```

Already wired in `sp1-prover-task.json`:
`arn:aws:secretsmanager:us-east-1:187510174358:secret:NETWORK_PRIVATE_KEY-eDxca0`

## 2. Task execution role (`ecsTaskExecutionRole`)

If it doesn't already exist (the ECS console can auto-create it), create it with:
ECR pull + CloudWatch logs (`AmazonECSTaskExecutionRolePolicy`) **and** read
access to the Succinct key:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:us-east-1:187510174358:secret:NETWORK_PRIVATE_KEY-*"
  }]
}
```

## 3. Log group + register the task definition

```bash
aws logs create-log-group --log-group-name /ecs/xfuel-sp1-prover --region us-east-1

aws ecs register-task-definition \
  --cli-input-json file://deploy/ecs/sp1-prover-task.json --region us-east-1
```

## 4. Create the service (ECS console — handles VPC/ALB)

ECS → Clusters → `xfuel-sp1-prover` → Create service:
- Launch type **Fargate**, task family `xfuel-sp1-prover`, desired tasks **1**
- Networking: pick your VPC + 2 subnets
- **Load balancer:** attach an **Application Load Balancer**, target group port **80**,
  health check path **`/health`**, health check grace period **300s** (key gen takes minutes)
- The ALB gives a stable DNS name → use it as `SP1_PROVER_URL`

## 5. Lock down the security group

The prover has **no auth** on `/prove`. On the ALB security group, allow inbound
80/443 **only from the Lightsail box IP** (`<LIGHTSAIL_IP>/32`). Deny all else.

## 6. Wire the backend

On the Lightsail `.env`:

```bash
SP1_PROVER_URL=http://<ALB-DNS-NAME>
```

Remove any stale `ZAN_PROVER_URL` / `SP1_FALLBACK_URL`, then:

```bash
npx pm2 restart xfuel-m2m --update-env
```

Receipts flip `proof.status: skipped → pending → complete`.

## On / Off (save cost when idle)

```bash
# OFF
aws ecs update-service --cluster xfuel-sp1-prover --service xfuel-sp1-prover \
  --desired-count 0 --region us-east-1
# ON  (allow ~3-5 min for key generation before the first proof)
aws ecs update-service --cluster xfuel-sp1-prover --service xfuel-sp1-prover \
  --desired-count 1 --region us-east-1
```

When OFF, inference still works (Theta/Claude); proofs report `unavailable`.
