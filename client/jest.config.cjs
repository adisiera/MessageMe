module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
  testMatch: ['<rootDir>/src/tests/**/*.test.{js,jsx,ts,tsx}'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ] }] },
  moduleNameMapper: { '\\.css$': '<rootDir>/src/tests/styleMock.cjs' },
  clearMocks: true,
};
