/** Unit-test config. Specs live next to source as `*.spec.ts`. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Transpile-only: `tsc --noEmit` is the type gate. ts-jest's own type-check
  // otherwise trips over a duplicate @langchain/core copy it resolves under
  // Jest's module system (tsc, with project references, resolves a single copy).
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
