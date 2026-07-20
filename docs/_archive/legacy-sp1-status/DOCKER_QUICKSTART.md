# Docker Quick Start for SP1 Prover

## Prerequisites

Make sure Docker Desktop is installed and running:
- Download from: https://www.docker.com/products/docker-desktop/

## Quick Commands

### Build the Docker image (first time - takes 10-15 minutes):
```powershell
cd C:\Users\seeha\xfuel-protocol\sp1-prover
docker-compose build
```

### Start the prover server:
```powershell
docker-compose up -d
```

### Check if it's running:
```powershell
docker-compose ps
docker-compose logs -f
```

### Test with example data:
```powershell
# Using curl (if installed)
curl -X POST http://localhost:8080/prove -H "Content-Type: application/json" -d @test-data\example.json

# Or using PowerShell:
Invoke-RestMethod -Uri http://localhost:8080/prove -Method Post -ContentType "application/json" -InFile test-data\example.json
```

### Stop the prover:
```powershell
docker-compose down
```

### View logs:
```powershell
docker-compose logs -f sp1-prover
```

### Rebuild after code changes:
```powershell
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## CLI Mode (One-off Proof Generation)

```powershell
# Generate a single proof
docker-compose run --rm sp1-prover ./host/target/release/prove prove --input test-data/example.json --output output/proof.json
```

## Troubleshooting

### "docker-compose command not found"
- Make sure Docker Desktop is running
- Or use: `docker compose` (without hyphen) for newer versions

### "Cannot connect to Docker daemon"
- Start Docker Desktop
- Wait for it to fully start (green icon in system tray)

### Build fails
- Make sure you're in the sp1-prover directory
- Check Docker has enough resources (Settings → Resources)

### Port 8080 already in use
- Change port in docker-compose.yml: `"8081:8080"`

## Performance

- **First build**: 10-15 minutes (downloads dependencies)
- **Subsequent builds**: 1-2 minutes (uses cache)
- **Proof generation**: 2-5 seconds per proof (CPU mode)

## Integration with Backend

Once running, your backend can call it:

```javascript
// backend/theta-bridge/src/prover.js
const SP1_PROVER_URL = 'http://localhost:8080';

const response = await axios.post(`${SP1_PROVER_URL}/prove`, depositData);
```

---

**Status:** Ready to use with `docker-compose up -d`
