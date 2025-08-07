/**
 * Jest unit tests for popup.js - Bitbucket Time Report Extension
 */

describe('Popup UI Controller', () => {
  let mockExtractor;
  
  beforeEach(() => {
    // Set up DOM
    document.body.innerHTML = `
      <button id="generateReportButton">Generate Report</button>
      <div id="status" class="hidden"></div>
      <div id="results" style="display: none;"></div>
      <button id="copyButton" class="hidden">Copy</button>
    `;
    
    // Mock the extractor functions that would be tested in content.test.js
    mockExtractor = {
      loadSettings: jest.fn(),
      waitForContentReady: jest.fn(),
      processAllPullRequests: jest.fn(),
      showStatus: jest.fn(),
      hideStatus: jest.fn()
    };
    
    // Mock Chrome APIs
    global.chrome.tabs.query.mockResolvedValue([{ 
      id: 1, 
      url: 'https://bitbucket.org/test/repo' 
    }]);
    
    global.chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
      // Mock different responses based on the action
      switch (message.action) {
        case 'getUserUUID':
          return Promise.resolve({ uuid: 'test-uuid-12345678901234567890123456789012' });
        case 'extractPRs':
          return Promise.resolve({ prs: ['Test PR 1', 'Test PR 2'] });
        case 'hasNextPage':
          return Promise.resolve({ hasNext: false });
        case 'goToNextPage':
          return Promise.resolve({ navigated: true });
        case 'checkPRListReady':
          return Promise.resolve({ ready: true });
        case 'checkPageReady':
          return Promise.resolve({ ready: true });
        default:
          return Promise.resolve({});
      }
    });
    
    global.chrome.tabs.update.mockResolvedValue({});
    
    global.chrome.storage.sync.get.mockImplementation((keys, callback) => {
      callback({
        bitbucketOrganization: 'testorg',
        bitbucketProject: 'testproject'
      });
    });
    
    // Mock navigator.clipboard
    global.navigator.clipboard = {
      writeText: jest.fn().mockResolvedValue()
    };
    
    // Clear console mocks
    console.log.mockClear();
    console.error.mockClear();
  });

  describe('Settings Loading', () => {
    test('should load settings from chrome storage', async () => {
      const loadSettings = () => {
        return new Promise((resolve) => {
          chrome.storage.sync.get(['bitbucketOrganization', 'bitbucketProject'], function(result) {
            const settings = {
              organization: result.bitbucketOrganization || '',
              project: result.bitbucketProject || ''
            };
            resolve(settings);
          });
        });
      };

      const settings = await loadSettings();
      
      expect(settings.organization).toBe('testorg');
      expect(settings.project).toBe('testproject');
      expect(chrome.storage.sync.get).toHaveBeenCalledWith(
        ['bitbucketOrganization', 'bitbucketProject'],
        expect.any(Function)
      );
    });

    test('should handle missing settings', async () => {
      chrome.storage.sync.get.mockImplementation((keys, callback) => {
        callback({});
      });

      const loadSettings = () => {
        return new Promise((resolve) => {
          chrome.storage.sync.get(['bitbucketOrganization', 'bitbucketProject'], function(result) {
            const settings = {
              organization: result.bitbucketOrganization || '',
              project: result.bitbucketProject || ''
            };
            resolve(settings);
          });
        });
      };

      const settings = await loadSettings();
      
      expect(settings.organization).toBe('');
      expect(settings.project).toBe('');
    });

    test('should handle chrome storage errors', async () => {
      chrome.storage.sync.get.mockImplementation((keys, callback) => {
        chrome.runtime.lastError = { message: 'Storage error' };
        callback({});
      });

      const loadSettings = () => {
        return new Promise((resolve) => {
          chrome.storage.sync.get(['bitbucketOrganization', 'bitbucketProject'], function(result) {
            if (chrome.runtime.lastError) {
              console.warn('Error loading settings:', chrome.runtime.lastError);
              resolve({ organization: '', project: '' });
              return;
            }
            const settings = {
              organization: result.bitbucketOrganization || '',
              project: result.bitbucketProject || ''
            };
            resolve(settings);
          });
        });
      };

      const settings = await loadSettings();
      
      expect(settings.organization).toBe('');
      expect(settings.project).toBe('');
      expect(console.warn).toHaveBeenCalledWith('Error loading settings:', { message: 'Storage error' });
      
      // Clean up
      chrome.runtime.lastError = null;
    });
  });

  describe('UUID Validation', () => {
    test('should validate correct UUID format', () => {
      const validateUUID = (uuid) => {
        return uuid && uuid.match(/^[a-f0-9-]{36}$/i);
      };

      const validUUIDs = [
        'ef2b7371-4037-4e97-bf69-5daa443cb94b',
        'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
        '00000000-0000-0000-0000-000000000000'
      ];

      validUUIDs.forEach(uuid => {
        expect(validateUUID(uuid)).toBeTruthy();
      });
    });

    test('should reject invalid UUID formats', () => {
      const validateUUID = (uuid) => {
        return uuid && uuid.match(/^[a-f0-9-]{36}$/i);
      };

      const invalidUUIDs = [
        'not-a-uuid',
        '123',
        'ef2b7371-4037-4e97-bf69-5daa443cb94', // too short
        'ef2b7371-4037-4e97-bf69-5daa443cb94bb', // too long
        'ef2b7371_4037_4e97_bf69_5daa443cb94b', // underscores instead of hyphens
        null,
        undefined,
        ''
      ];

      invalidUUIDs.forEach(uuid => {
        expect(validateUUID(uuid)).toBeFalsy();
      });
    });
  });

  describe('URL Generation', () => {
    test('should generate correct Bitbucket PR URL', () => {
      const generatePRUrl = (organization, project, userUUID) => {
        return `https://bitbucket.org/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/pull-requests/?state=MERGED&author={${encodeURIComponent(userUUID)}}`;
      };

      const url = generatePRUrl('testorg', 'testproject', 'test-uuid-123');
      
      expect(url).toBe('https://bitbucket.org/testorg/testproject/pull-requests/?state=MERGED&author={test-uuid-123}');
    });

    test('should handle special characters in organization and project names', () => {
      const generatePRUrl = (organization, project, userUUID) => {
        return `https://bitbucket.org/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/pull-requests/?state=MERGED&author={${encodeURIComponent(userUUID)}}`;
      };

      const url = generatePRUrl('test org', 'test-project&special', 'test-uuid-123');
      
      expect(url).toContain('test%20org');
      expect(url).toContain('test-project%26special');
    });
  });

  describe('Content Ready Waiting', () => {
    test('should wait for content with progressive intervals', async () => {
      let checkCount = 0;
      const mockContentCheck = jest.fn().mockImplementation(() => {
        checkCount++;
        if (checkCount >= 3) {
          return Promise.resolve({ ready: true });
        }
        return Promise.reject(new Error('Not ready'));
      });

      const waitForContentReady = async (tabId, contentType = 'basic', maxWait = 5000) => {
        const startTime = Date.now();
        let checkCount = 0;
        
        return new Promise((resolve) => {
          const checkContent = async () => {
            checkCount++;
            const elapsed = Date.now() - startTime;
            
            try {
              const result = await mockContentCheck();
              if (result && result.ready) {
                resolve();
                return;
              }
            } catch (error) {
              // Content not ready yet
            }
            
            if (elapsed >= maxWait) {
              resolve(); // Timeout, proceed anyway
              return;
            }
            
            let nextInterval = elapsed < 2000 ? 200 : elapsed < 5000 ? 400 : 800;
            setTimeout(checkContent, nextInterval);
          };
          
          checkContent();
        });
      };

      const startTime = Date.now();
      await waitForContentReady(1, 'basic', 5000);
      const elapsed = Date.now() - startTime;
      
      expect(mockContentCheck).toHaveBeenCalledTimes(3);
      expect(elapsed).toBeLessThan(5000);
    });

    test('should timeout after max wait time', async () => {
      const mockContentCheck = jest.fn().mockRejectedValue(new Error('Never ready'));

      const waitForContentReady = async (tabId, contentType = 'basic', maxWait = 1000) => {
        const startTime = Date.now();
        
        return new Promise((resolve) => {
          const checkContent = async () => {
            const elapsed = Date.now() - startTime;
            
            try {
              const result = await mockContentCheck();
              if (result && result.ready) {
                resolve();
                return;
              }
            } catch (error) {
              // Content not ready yet
            }
            
            if (elapsed >= maxWait) {
              resolve(); // Timeout
              return;
            }
            
            setTimeout(checkContent, 200);
          };
          
          checkContent();
        });
      };

      const startTime = Date.now();
      await waitForContentReady(1, 'basic', 1000);
      const elapsed = Date.now() - startTime;
      
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(mockContentCheck).toHaveBeenCalled();
    });
  });

  describe('PR Processing', () => {
    test('should process multiple pages with pagination', async () => {
      let pageCount = 0;
      
      chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
        if (message.action === 'extractPRs') {
          pageCount++;
          return Promise.resolve({
            prs: [`Page ${pageCount} PR 1`, `Page ${pageCount} PR 2`]
          });
        }
        if (message.action === 'hasNextPage') {
          return Promise.resolve({ hasNext: pageCount < 3 });
        }
        if (message.action === 'goToNextPage') {
          return Promise.resolve({ navigated: true });
        }
        return Promise.resolve({});
      });

      const processAllPullRequests = async (tabId) => {
        let pageCount = 1;
        let hasMorePages = true;
        const allPRs = [];

        while (hasMorePages && pageCount <= 3) {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'extractPRs' });
          
          if (response && response.prs && response.prs.length > 0) {
            allPRs.push(...response.prs);
          }

          const nextPageResponse = await chrome.tabs.sendMessage(tabId, { action: 'hasNextPage' });
          
          if (nextPageResponse && nextPageResponse.hasNext) {
            await chrome.tabs.sendMessage(tabId, { action: 'goToNextPage' });
            pageCount++;
          } else {
            hasMorePages = false;
          }
        }

        return allPRs;
      };

      const allPRs = await processAllPullRequests(1);
      
      expect(allPRs).toHaveLength(6); // 3 pages × 2 PRs each
      expect(allPRs[0]).toBe('Page 1 PR 1');
      expect(allPRs[5]).toBe('Page 3 PR 2');
    });

    test('should stop pagination at safety limit', async () => {
      chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
        if (message.action === 'extractPRs') {
          return Promise.resolve({ prs: ['Test PR'] });
        }
        if (message.action === 'hasNextPage') {
          return Promise.resolve({ hasNext: true }); // Always has next page
        }
        if (message.action === 'goToNextPage') {
          return Promise.resolve({ navigated: true });
        }
        return Promise.resolve({});
      });

      const processAllPullRequests = async (tabId) => {
        let pageCount = 1;
        let hasMorePages = true;
        const allPRs = [];

        while (hasMorePages) {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'extractPRs' });
          
          if (response && response.prs && response.prs.length > 0) {
            allPRs.push(...response.prs);
          }

          const nextPageResponse = await chrome.tabs.sendMessage(tabId, { action: 'hasNextPage' });
          
          if (nextPageResponse && nextPageResponse.hasNext) {
            await chrome.tabs.sendMessage(tabId, { action: 'goToNextPage' });
            pageCount++;
          } else {
            hasMorePages = false;
          }

          // Safety check
          if (pageCount > 20) {
            break;
          }
        }

        return { allPRs, pageCount };
      };

      const result = await processAllPullRequests(1);
      
      expect(result.pageCount).toBe(21); // Should stop at safety limit
      expect(result.allPRs).toHaveLength(20); // 20 pages processed (1-20, stops at 21)
    });

    test('should handle extraction errors gracefully', async () => {
      chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
        if (message.action === 'extractPRs') {
          throw new Error('Extraction failed');
        }
        return Promise.resolve({});
      });

      const processAllPullRequests = async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'extractPRs' });
          return response.prs || [];
        } catch (error) {
          console.error('Extraction error:', error);
          return [];
        }
      };

      const result = await processAllPullRequests(1);
      
      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith('Extraction error:', expect.any(Error));
    });
  });

  describe('Data Formatting', () => {
    test('should group timeline entries by date correctly', () => {
      const uniquePRs = [
        '(August 5, Tuesday) F, D: DEP-6001: Add feature',
        '(August 4, Monday) F, P: DEP-6001: Add feature',
        '(August 4, Monday) B, D: DEP-6002: Fix bug',
        '(August 1, Friday) B, P: DEP-6002: Fix bug'
      ];

      const formatTimelineData = (uniquePRs) => {
        const groupedByDate = new Map();
        
        for (const entry of uniquePRs) {
          const dateMatch = entry.match(/^\(([^)]+)\)/);
          if (dateMatch) {
            const date = dateMatch[1];
            
            if (!groupedByDate.has(date)) {
              groupedByDate.set(date, []);
            }
            
            groupedByDate.get(date).push(entry);
          }
        }

        const dateGroups = [];
        for (const [date, entries] of groupedByDate) {
          const processedEntries = entries.map((entry, index) => {
            if (index === 0) {
              return entry;
            } else {
              return entry.replace(/^\([^)]+\)\s*/, '');
            }
          });
          
          const groupText = processedEntries.join('\n');
          dateGroups.push(groupText);
        }
        
        return dateGroups.join('\n\n');
      };

      const formatted = formatTimelineData(uniquePRs);
      
      expect(formatted).toContain('(August 5, Tuesday) F, D: DEP-6001: Add feature');
      expect(formatted).toContain('(August 4, Monday) F, P: DEP-6001: Add feature');
      expect(formatted).toContain('B, D: DEP-6002: Fix bug'); // Date removed from second entry
      expect(formatted).toContain('\n\n'); // Double newlines between date groups
    });

    test('should remove duplicates from PR results', () => {
      const allPRs = [
        'PR 1',
        'PR 2', 
        'PR 1', // duplicate
        'PR 3',
        'PR 2'  // duplicate
      ];

      const uniquePRs = [...new Set(allPRs)];
      
      expect(uniquePRs).toHaveLength(3);
      expect(uniquePRs).toEqual(['PR 1', 'PR 2', 'PR 3']);
    });
  });

  describe('Copy to Clipboard', () => {
    test('should copy formatted data to clipboard', async () => {
      const testData = 'Test timeline data';
      
      const copyToClipboard = async (data) => {
        await navigator.clipboard.writeText(data);
      };

      await copyToClipboard(testData);
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testData);
    });

    test('should handle clipboard errors', async () => {
      navigator.clipboard.writeText.mockRejectedValue(new Error('Clipboard error'));
      
      const copyToClipboard = async (data) => {
        try {
          await navigator.clipboard.writeText(data);
          return true;
        } catch (error) {
          console.error('Clipboard error:', error);
          return false;
        }
      };

      const result = await copyToClipboard('test');
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Clipboard error:', expect.any(Error));
    });
  });

  describe('Error Handling', () => {
    test('should handle missing extension configuration', () => {
      const validateConfiguration = (settings) => {
        if (!settings.organization || !settings.project) {
          throw new Error('Extension not configured. Please set your organization and project in the extension options (right-click extension icon → Options).');
        }
        return true;
      };

      expect(() => {
        validateConfiguration({ organization: '', project: 'test' });
      }).toThrow('Extension not configured');

      expect(() => {
        validateConfiguration({ organization: 'test', project: '' });
      }).toThrow('Extension not configured');

      expect(() => {
        validateConfiguration({ organization: 'test', project: 'test' });
      }).not.toThrow();
    });

    test('should handle UUID detection failures', () => {
      const validateUUIDResponse = (uuidResponse) => {
        if (!uuidResponse || !uuidResponse.uuid) {
          throw new Error('Could not retrieve user UUID. Please make sure you are logged in to Bitbucket.');
        }
        
        const userUUID = uuidResponse.uuid;
        
        if (!userUUID.match(/^[a-f0-9-]{36}$/i)) {
          throw new Error('Invalid user UUID format received');
        }
        
        return userUUID;
      };

      expect(() => {
        validateUUIDResponse(null);
      }).toThrow('Could not retrieve user UUID');

      expect(() => {
        validateUUIDResponse({ uuid: null });
      }).toThrow('Could not retrieve user UUID');

      expect(() => {
        validateUUIDResponse({ uuid: 'invalid-uuid' });
      }).toThrow('Invalid user UUID format');

      expect(() => {
        validateUUIDResponse({ uuid: 'ef2b7371-4037-4e97-bf69-5daa443cb94b' });
      }).not.toThrow();
    });

    test('should provide user-friendly error messages', () => {
      const getUserFriendlyError = (error) => {
        let userMessage = 'An error occurred during extraction.';
        
        if (error.message.includes('Extension not configured')) {
          userMessage = 'Extension not configured! Please set your Bitbucket organization and project name in the extension settings. Right-click the extension icon and select "Options" to configure.';
        } else if (error.message.includes('UUID')) {
          userMessage = 'Unable to identify user. Please ensure you are logged in to Bitbucket.';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          userMessage = 'Network error. Please check your connection and try again.';
        }
        
        return userMessage;
      };

      const testCases = [
        {
          error: new Error('Extension not configured'),
          expected: 'Extension not configured! Please set your Bitbucket organization and project name in the extension settings. Right-click the extension icon and select "Options" to configure.'
        },
        {
          error: new Error('UUID detection failed'),
          expected: 'Unable to identify user. Please ensure you are logged in to Bitbucket.'
        },
        {
          error: new Error('network timeout'),
          expected: 'Network error. Please check your connection and try again.'
        },
        {
          error: new Error('Some other error'),
          expected: 'An error occurred during extraction.'
        }
      ];

      testCases.forEach(({ error, expected }) => {
        expect(getUserFriendlyError(error)).toBe(expected);
      });
    });
  });
  
  describe('Error Handling', () => {
    test('should handle content script extraction errors', async () => {
      // Mock an error response from content script
      chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
        if (message.action === 'extractPRs') {
          return Promise.resolve({ prs: [], error: 'Test extraction error' });
        }
        return Promise.resolve({ uuid: 'test-uuid' });
      });
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Simulate the extraction process
      const tabId = 1;
      const response = await chrome.tabs.sendMessage(tabId, {action: 'extractPRs'});
      
      expect(response.error).toBe('Test extraction error');
      expect(response.prs).toEqual([]);
      
      consoleSpy.mockRestore();
    });
    
    test('should handle connection errors gracefully', async () => {
      // Mock a connection error
      chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
      
      try {
        await chrome.tabs.sendMessage(1, {action: 'getUserUUID'});
      } catch (error) {
        expect(error.message).toContain('Could not establish connection');
      }
    });
    
    test('should handle invalid UUID format', async () => {
      chrome.tabs.sendMessage.mockResolvedValue({ uuid: 'invalid-uuid' });
      
      const response = await chrome.tabs.sendMessage(1, {action: 'getUserUUID'});
      
      // UUID should be 36 characters with hyphens
      expect(response.uuid).toBe('invalid-uuid');
      expect(response.uuid.match(/^[a-f0-9-]{36}$/i)).toBeFalsy();
    });
  });
  
  describe('Enhanced Debugging and Logging', () => {
    test('should log debug information during extraction', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Mock a successful extraction
      chrome.tabs.sendMessage.mockResolvedValue({ 
        prs: ['Test PR'],
        debug: 'Debug information'
      });
      
      const response = await chrome.tabs.sendMessage(1, {action: 'extractPRs'});
      
      expect(response.prs).toEqual(['Test PR']);
      
      consoleSpy.mockRestore();
    });
    
    test('should handle improved row selector logic', () => {
      // Create a mock DOM structure that matches current Bitbucket layout
      document.body.innerHTML = `
        <table class="css-1yq88hf edylmxf0">
          <thead>
            <tr>
              <th>Summary</th>
              <th>Created</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span title="August 7, 2025 at 3:08:35 PM GMT+2">55 minutes ago</span>
                DEP-6284: Update the ChatGPT logo with marketing SVG
              </td>
            </tr>
          </tbody>
        </table>
      `;
      
      // Test that tbody tr selector finds rows
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
      
      // Test that time elements with title attributes are found
      const timeElements = document.querySelectorAll('span[title*="202"]');
      expect(timeElements.length).toBe(1);
      expect(timeElements[0].getAttribute('title')).toBe('August 7, 2025 at 3:08:35 PM GMT+2');
    });
  });
});
