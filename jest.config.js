/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  verbose: false,
  collectCoverage: false,
  moduleFileExtensions: ['js', 'json'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.afterEnv.js'],
  testPathIgnorePatterns: ['/__tests__/setup\\.js$'],
  resetMocks: true,
};