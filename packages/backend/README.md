# RAIO backend api

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) configured to [run as non-root user](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user)

### Testing

From the monorepo root directory:

```shell
yarn workspace backend test
```

## Docker build

In order to build the docker container run the following command.

```shell
yarn docker build backend -t rafiki-backend
```

## Configuration

### Redis connection

The connection can be configured by specifying the following environment variables.
The config is passed to `ioredis` - see https://github.com/luin/ioredis#tls-options.
| Variable | Default |
|-----------------------------|------------------|
| REDIS_HOST | "127.0.0.1" |
| REDIS_PORT | 6379 |
| REDIS_TLS_ENABLED | "false" |
| REDIS_TLS_CA_FILE_PATH | "/certs/ca.crt" |
| REDIS_TLS_KEY_FILE_PATH | "/certs/tls.key" |
| REDIS_TLS_CERT_FILE_PATH | "/certs/tls.crt" |
