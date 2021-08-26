# Rafiki ilp connector

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) configured to [run as non-root user](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user)

### Testing

From the monorepo root directory:

```shell
# Build interledger service
yarn workspace interledger build

# Run tests
yarn workspace interledger test
```

### Running

From the monorepo root directory:

```shell
# Run database
docker-compose -f packages/interledger/docker-compose.yml up -d

# Build interledger service
yarn workspace interledger build

# Run interledger service
yarn workspace interledger start

# Clean up
docker-compose -f packages/interledger/docker-compose.yml stop
docker-compose -f packages/interledger/docker-compose.yml rm
```
