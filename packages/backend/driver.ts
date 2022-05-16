import { driver } from '@smartlyio/oats'
// import { UnsupportedFeatureBehaviour } from '../src/driver';

// generate server from the shared openapi spec
// This example uses a specification file that contains compliant but unsupported nodes,
// such as 'securitySchemes' and 'security'
driver.generate({
  generatedValueClassFile: './tmp/server/types.generated.ts',
  generatedServerFile: './tmp/server/generated.ts',
  header: '/* tslint:disable variable-name only-arrow-functions*/',
  openapiFilePath: '/home/brandon/rafiki/open-api-spec.yaml',
  resolve: driver.compose(driver.generateFile(), driver.localResolve)
  // unsupportedFeatures: {
  //   security: UnsupportedFeatureBehaviour.ignore
  // }
})
