# Rafiki backend api

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) configured to [run as non-root user](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user)

### Testing

From the monorepo root directory:

```shell
yarn workspace backend test
```

### Running

From the monorepo root directory:

```shell
# Run database
docker-compose -f packages/backend/docker-compose.yml up -d

# Build backend API
yarn workspace backend build

# Run backend API
yarn workspace backend start

# Clean up
docker-compose -f packages/backend/docker-compose.yml stop
docker-compose -f packages/backend/docker-compose.yml rm
```
