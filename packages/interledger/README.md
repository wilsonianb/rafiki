# RAIO ilp connector

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
