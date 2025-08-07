# Bitbucket Time Report Extension - Jest Test Suite

Comprehensive Jest unit and integration tests for the Bitbucket Time Report Chrome Extension.

## 📁 Test Structure

```
tests/
├── package.json          # Jest dependencies and scripts
├── jest.config.js        # Jest configuration
├── jest.setup.js         # Test environment setup
├── content.test.js       # Unit tests for content script logic
├── popup.test.js         # Unit tests for popup functionality  
├── integration.test.js   # Integration tests for full workflows
└── README.md            # This file
```

## 🚀 Quick Start

### Installation
```bash
cd tests/
npm install
```

### Run Tests
```bash
# Run all tests
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Generate coverage report
npm run test:coverage

# Verbose output
npm run test:verbose
```

## 🧪 Test Categories

### 1. **Unit Tests (`content.test.js`)**
Tests core content script functionality in isolation:

- ✅ **Text Sanitization**: XSS protection, HTML tag removal, length limits
- ✅ **Date Extraction**: Merge dates vs approval dates, relative dates, priority system
- ✅ **PR Classification**: Feature vs Bug detection from title/branch keywords
- ✅ **Timeline Generation**: Progress entries, weekend skipping, chronological ordering

**Key Test Cases:**
```javascript
// Date priority testing
test('should prioritize merge date over approval date', () => {
  const rowText = 'DEP-6001: Test PR merged 2025-08-10 approved 2025-08-09';
  const result = extractDateFromText(rowText, 2025, 8);
  
  expect(result.dateString).toBe('2025-08-10');
  expect(result.dateType).toBe('merge');
  expect(result.priority).toBe(100);
});

// Timeline generation testing
test('should generate timeline with progress and done entries', () => {
  const mockPRs = [{ date: new Date('2025-08-05'), type: 'F', title: 'Test' }];
  const timeline = generateTimeline(mockPRs);
  
  expect(timeline.some(entry => entry.includes('P:'))).toBe(true); // Progress entries
  expect(timeline.some(entry => entry.includes('D:'))).toBe(true); // Done entries
});
```

### 2. **Popup Tests (`popup.test.js`)**
Tests UI controller and Chrome API integration:

- ✅ **Settings Management**: Loading/saving organization and project settings
- ✅ **UUID Validation**: Format validation and error handling
- ✅ **URL Generation**: Correct Bitbucket PR URLs with encoding
- ✅ **Content Waiting**: Progressive interval waiting for page readiness
- ✅ **Pagination Handling**: Multi-page PR extraction with safety limits
- ✅ **Error Handling**: User-friendly error messages and fallbacks

**Key Test Cases:**
```javascript
// Settings loading
test('should load settings from chrome storage', async () => {
  const settings = await loadSettings();
  expect(settings.organization).toBe('testorg');
  expect(chrome.storage.sync.get).toHaveBeenCalled();
});

// Pagination with safety limits
test('should stop pagination at safety limit', async () => {
  // Mock always having next page
  chrome.tabs.sendMessage.mockResolvedValue({ hasNext: true });
  
  const result = await processAllPullRequests(1);
  expect(result.pageCount).toBe(21); // Stops at safety limit
});
```

### 3. **Integration Tests (`integration.test.js`)**
Tests complete workflows with mock DOM and Chrome APIs:

- ✅ **Full Workflow**: UUID → Settings → Navigation → Extraction → Timeline
- ✅ **DOM Interaction**: Real Bitbucket page structure simulation
- ✅ **Date Detection Integration**: Priority system with realistic PR data
- ✅ **Timeline Generation**: Complete timeline with multiple PRs
- ✅ **Error Handling**: Malformed DOM, empty pages, edge cases
- ✅ **Performance**: Large dataset handling and efficiency

**Key Test Cases:**
```javascript
// Full workflow integration
test('should complete full extraction workflow successfully', async () => {
  // Creates mock Bitbucket DOM, extracts PRs, generates timeline
  const result = await mockExtraction();
  
  expect(result.length).toBeGreaterThan(0);
  expect(result.some(entry => entry.includes('D:'))).toBe(true);
  expect(result.some(entry => entry.includes('P:'))).toBe(true);
});

// Performance testing
test('should handle large datasets efficiently', () => {
  const largeDataset = createLargeDataset(1000);
  const result = processLargeDataset(largeDataset);
  
  expect(result.duration).toBeLessThan(1000); // Under 1 second
});
```

## 📊 Test Coverage

### Current Coverage Targets
- **Branches**: 80%
- **Functions**: 80%  
- **Lines**: 80%
- **Statements**: 80%

### Coverage Report
```bash
npm run test:coverage
```

Generates reports in multiple formats:
- **Terminal**: Text summary
- **HTML**: `coverage/lcov-report/index.html`
- **LCOV**: `coverage/lcov.info` (for CI integration)

## 🔧 Test Configuration

### Jest Setup (`jest.setup.js`)
- **Chrome API Mocks**: `chrome.tabs`, `chrome.storage`, `chrome.runtime`
- **DOM Helpers**: Mock element creation, PR row generation
- **Date Mocking**: Consistent date testing with `mockDate()`
- **Console Mocking**: Capture and test log output

### Custom Matchers
```javascript
// Date mocking for consistent testing
mockDate('2025-08-15T10:00:00Z');

// Mock PR row creation
const mockRow = createMockPRRow({
  ticketId: 'DEP-6001',
  title: 'Fix authentication bug',
  branch: 'bugfix/auth',
  dateText: '7 days ago',
  approvals: [{ author: 'Viktor', date: '2025-08-01' }]
});
```

## 🎯 Testing Strategies

### 1. **Unit Testing Approach**
- **Pure Functions**: Test logic functions in isolation
- **Mock Dependencies**: Chrome APIs, DOM elements, Date objects
- **Edge Cases**: Invalid inputs, malformed data, boundary conditions
- **Error Scenarios**: Network failures, missing permissions, invalid formats

### 2. **Integration Testing Approach**
- **Real Workflows**: End-to-end user scenarios
- **Mock Environment**: Realistic Bitbucket page structure
- **Data Flow**: Complete data transformation pipeline
- **Performance**: Large datasets and edge case handling

### 3. **Test Data Management**
```javascript
// Realistic test data
const mockBitbucketRows = [
  {
    text: 'Vlad Slipchenko DEP-6001: Fix auth bug Branch: bugfix/DEP-6001 merged 2025-08-15 Viktor approved 2025-08-14',
    expectedDate: '2025-08-15',
    expectedType: 'B',
    expectedPriority: 100
  }
];
```

## 🐛 Debugging Tests

### Debug Mode
```bash
# Run single test file
npm test -- content.test.js

# Run specific test
npm test -- --testNamePattern="should extract merge date"

# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Common Issues

**1. Date Mocking Problems**
```javascript
// ❌ Wrong - Date not properly mocked
test('should calculate relative date', () => {
  // Uses real current date
});

// ✅ Correct - Consistent date mocking
test('should calculate relative date', () => {
  mockDate('2025-08-15T10:00:00Z');
  // Now Date() always returns Aug 15, 2025
});
```

**2. Chrome API Mocking**
```javascript
// ❌ Wrong - Not mocked
chrome.tabs.sendMessage(1, { action: 'test' });

// ✅ Correct - Properly mocked
chrome.tabs.sendMessage.mockResolvedValue({ result: 'success' });
```

**3. Async Testing**
```javascript
// ❌ Wrong - Not awaiting async
test('should process PRs', () => {
  const result = processAllPullRequests(1); // Missing await
});

// ✅ Correct - Proper async handling
test('should process PRs', async () => {
  const result = await processAllPullRequests(1);
});
```

## 📈 Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: cd tests && npm install
      - name: Run tests
        run: cd tests && npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./tests/coverage/lcov.info
```

## 🔄 Test Maintenance

### Adding New Tests
1. **Identify Test Type**: Unit vs Integration
2. **Create Test Cases**: Follow existing patterns
3. **Mock Dependencies**: Use existing mocks or create new ones
4. **Verify Coverage**: Ensure adequate test coverage

### Updating Tests
1. **Keep Tests Current**: Update when implementation changes
2. **Maintain Mocks**: Update Chrome API mocks for new features
3. **Review Coverage**: Ensure coverage thresholds are met
4. **Document Changes**: Update test documentation

### Best Practices
- ✅ **Test Behavior, Not Implementation**: Focus on what, not how
- ✅ **Clear Test Names**: Describe expected behavior clearly
- ✅ **Arrange-Act-Assert**: Structure tests consistently
- ✅ **Independent Tests**: Each test should be runnable in isolation
- ✅ **Meaningful Assertions**: Test the right things with clear expectations

## 📚 Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Chrome Extension Testing](https://developer.chrome.com/docs/extensions/mv3/tut_testing/)
- [JSDOM Documentation](https://github.com/jsdom/jsdom)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

---

Run `npm test` to get started! 🧪
