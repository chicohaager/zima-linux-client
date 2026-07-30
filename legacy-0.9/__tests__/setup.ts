/**
 * Jest test setup
 * Runs before each test file
 */

// Mock Electron app
global.console = {
  ...console,
  // Suppress console output during tests (uncomment if needed)
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Set test environment
process.env.NODE_ENV = 'test';
