# Contributing to this repository <!-- omit in toc -->

## Getting started <!-- omit in toc -->

Thank you for contributing to Rafiki :tada:

Before you begin:
- Have you read the [code of conduct](code_of_conduct.md)?
- Check out the [existing issues](https://github.com/coilhq/rafiki/issues) & see if we [accept contributions](#types-of-contributions) for your type of issue.

### Table of Contents <!-- omit in toc -->

- [Types of contributions](#types-of-contributions)
  - [:mega: Discussions](#mega-discussions)
  - [:beetle: Issues](#beetle-issues)
  - [:hammer_and_wrench: Pull requests](#hammer_and_wrench-pull-requests)
- [Working in the rafiki repository](#working-in-the-rafiki-repository)
  - [Workspaces](#workspaces)
    - [How to share scripts between workspaces?](#how-to-share-scripts-between-workspaces)
  - [Code quality](#code-quality)
    - [Linting](#linting)
    - [Formatting](#formatting)
    - [Testing](#testing)
    - [Commit hooks](#commit-hooks)
    - [Language](#language)
    - [CI](#ci)

## Types of contributions
You can contribute to Rafiki in several ways. 

### :mega: Discussions
Discussions are where we have conversations about Rafiki.

If you would like to discuss topics about the broader ecosystem, have a new idea, or want to show off your work - join us in [discussions](https://github.com/coilhq/rafiki/discussions).

### :beetle: Issues
We use Github issues to track tasks that contributors can help with. We haven't finalised labels yet for contributors to tackle. If you want to help with work related to an issue, please comment on the issue before starting work on it.

If you've found something that needs fixing, search open issues to see if someone else has reported the same thing. If it's something new, open an issue. We'll use the issue to have a conversation about the problem you want to fix.

### :hammer_and_wrench: Pull requests
Feel free to fork and create a pull request on changes you think you can contribute.

The team will review your pull request as soon as possible.

## Working in the rafiki repository

This project uses yarn 2. We use [zero-installs](https://yarnpkg.com/features/zero-installs)
which means you won't need to install dependencies when you clone the repo.
This does have [security implications](https://yarnpkg.com/features/zero-installs#does-it-have-security-implications)
that are checked in CI.

> DO NOT use `npm install`, this will cause the project to spontaneously self-destruct :boom:

```shell
# Clone with SSH
git clone git@github.com:coilhq/rafiki.git

# Build dependencies with install scripts
yarn install --immutable --immutable-cache
```

### Workspaces

We use [yarn workspaces](https://yarnpkg.com/features/workspaces) to manage the monorepo.
The [workspace](https://yarnpkg.com/cli/workspace) command should be used when
you want to run yarn commands in specific workspaces:

```shell
# Add a package (package_name) to a single workspace(workspace_name):
yarn workspace <workspace_name> add <package_name>

# Run a script on a single workspace(workspace_name):
yarn workspace <workspace_name> <script_name>
```

#### How to share scripts between workspaces?

Any script with a colon in its name (`build:foo`) can be called from any workspace.
Additionally, `$INIT_CWD` will always point to the directory running the script.

We utilize this to write shared scripts once:

```shell
# Lint in the current workspace
cd packages/backend
yarn lint # runs yarn lint:local

# OR use the workspaces command
yarn workspace backend lint # runs yarn lint:local in the packages/backend directory
```

### Labels

We use labels to communicate the intention of issues and prs.

- `discussions:` prefix denotes issues that can be converted to discussions.
- `good first issue` are great issues for newcomers to take on.
- `pkg:` prefix denotes issues/prs related to a specific package.
- `team:` prefix lets contributors know if the issue will be done by the core team or not.
- `triage` issues that the core team needs to assign labels to.
- `type:` prefix denotes a specific action/category to issues/prs.

Some labels will be automatically assigned to prs.

### Code quality

All the code quality tools used in the project are installed and configured at the root.
This allows for consistency across the monorepo. Allows new packages to be added with
minimal configuration overhead.

We try not to put config files in workspaces, unless absolutely necessary.

#### Linting

[Eslint](https://eslint.org/) is used for linting.

```shell
./.eslintrc.yml # config
./.eslintignore # ignore file
```

Eslint config should not be overridden in any packages.

#### Formatting

[Prettier](https://prettier.io/) is used for formatting.

```shell
./.prettierrc.yml # config
./.prettierignore # ignore file
```

Prettier config should not be overridden in any packages.

#### Testing

[Jest](https://jestjs.io/) is used for testing.

```shell
./jest.config.js # config used to configure projects and run all tests
./jest.config.base.js # (base jest config, imported by other packages)
./packages/*/jest.config.js # jest config file for package * (extends base.config.base.js)
```

Jest config at the root is intended to be a base config that should be extended by
each package to suit the package's testing requirements.

#### Commit hooks

[Husky](https://github.com/typicode/husky) provides git hooks.

```shell
./.husky/commit-msg # linting commit messages
./.husky/pre-commit # perform functions before committing
```

[Commitlint](https://commitlint.js.org/) is used for linting commit messages
so that they conform to [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/).

```shell
./commitlint.config.js # config
```

[Lint-staged](https://github.com/okonet/lint-staged) is used for linting and formatting staged files on commit.

```shell
./.lintstagedrc.yml # config
```

https://commitlint.js.org

#### Language

[Typescript](https://www.staging-typescript.org/) is the chosen language.

```shell
./tsconfig.json # config
```

Typescript config at the root is intended to be a base config that should be extended by
each package to suit the package's requirements.

#### CI

We use Github actions to manage our CI pipeline.

The workflows can be found in `.github/workflows`
