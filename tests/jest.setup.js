// Jest setup file for Bitbucket Time Report Extension tests

// Mock Chrome APIs
global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn()
    },
    id: 'test-extension-id',
    lastError: null
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    update: jest.fn()
  },
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

// Mock DOM globals
global.document = document;
global.window = window;
global.navigator = navigator;

// Mock console to capture logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Helper to create mock DOM elements
global.createMockElement = (tagName, textContent = '', attributes = {}) => {
  const element = document.createElement(tagName);
  element.textContent = textContent;
  
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  
  return element;
};

// Helper to create mock PR rows
global.createMockPRRow = (prData) => {
  const {
    author = 'Vlad Slipchenko',
    ticketId = 'DEP-6001',
    title = 'Test PR',
    branch = 'feature/test',
    dateText = '2 days ago',
    approvals = []
  } = prData;
  
  const approvalText = approvals.map(approval => 
    `${approval.author} approved ${approval.date} (approved)`
  ).join(' ');
  
  const rowText = `${author} ${ticketId}: ${title} Branch: ${branch} ${branch} Branch: develop develop ${author} - #3550, updated ${dateText} ${approvalText}`;
  
  return createMockElement('tr', rowText);
};

// Mock Date for consistent testing
global.mockDate = (dateString) => {
  const MockDate = class extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(dateString);
      } else {
        super(...args);
      }
    }
    
    static now() {
      return new Date(dateString).getTime();
    }
  };
  
  global.Date = MockDate;
  return MockDate;
};

// Restore original Date
global.restoreDate = () => {
  global.Date = Date;
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  restoreDate();
});
