'use strict'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseConfig = require('../../jest.config.base.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageName = require('./package.json').name

module.exports = {
  ...baseConfig,
  clearMocks: true,
  roots: [`<rootDir>/packages/${packageName}`],
  testEnvironment: `<rootDir>/packages/${packageName}/jest.environment.js`,
  testRegex: `(packages/${packageName}/.*/__tests__/.*|\\.(test|spec))\\.tsx?$`,
  moduleDirectories: ['.yarn'],
  modulePaths: [`<rootDir>/packages/${packageName}/src/`],
  name: packageName,
  displayName: packageName,
  rootDir: '../..'
}
