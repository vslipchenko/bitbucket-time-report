/**
 * Bitbucket Task Report Extension - Popup UI Controller
 * Handles user interactions and orchestrates the PR extraction process
 */
document.addEventListener('DOMContentLoaded', function() {
  // Get references to UI elements
  const extractButton = document.getElementById('extractButton');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const copyButton = document.getElementById('copyButton');

  // Global state variables
  let extractedData = '';  // Final formatted output for clipboard
  let allPRs = [];         // Accumulated PR data from all pages

  /**
   * Main extraction process triggered by button click
   * Workflow: UUID detection → Navigation → PR extraction → Formatting
   */
  extractButton.addEventListener('click', async function() {
    try {
      showStatus('Getting current user UUID...', 'loading');
      extractButton.disabled = true;  // Prevent multiple simultaneous extractions
      allPRs = [];  // Reset accumulated data

      // Get reference to the active browser tab
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});

      // Ensure we're on Bitbucket domain for the extension to work
      if (!tab.url.includes('bitbucket.org')) {
        await chrome.tabs.update(tab.id, {url: 'https://bitbucket.org/'});
        await waitForPageLoad(2000);  // Allow time for navigation
      }

      // Step 1: Identify the current user via content script
      const uuidResponse = await chrome.tabs.sendMessage(tab.id, {action: 'getUserUUID'});

      if (!uuidResponse || !uuidResponse.uuid) {
        throw new Error('Could not retrieve user UUID. Please make sure you are logged in to Bitbucket.');
      }

      const userUUID = uuidResponse.uuid;
      
      // Step 2: Validate UUID format for security (prevent injection attacks)
      if (!userUUID) {
        throw new Error('UUID is null or undefined');
      }
      
      if (!userUUID.match(/^[a-f0-9-]{36}$/i)) {
        console.error('Invalid UUID format received:', userUUID);
        throw new Error('Invalid user UUID format received');
      }
      
      showStatus('Found user UUID. Loading settings...', 'loading');

      // Step 3: Load organization and project settings from storage
      const settings = await loadSettings();
      
      // Validate that settings are configured
      if (!settings.organization || !settings.project) {
        throw new Error('Extension not configured. Please set your organization and project in the extension options (right-click extension icon → Options).');
      }
      
      showStatus('Navigating to pull requests...', 'loading');

      // Step 4: Build dynamic URL using configured organization and project
      // URL format: https://bitbucket.org/<organization>/<project>/pull-requests/?state=MERGED&author={uuid}
      const prUrl = `https://bitbucket.org/${encodeURIComponent(settings.organization)}/${encodeURIComponent(settings.project)}/pull-requests/?state=MERGED&author={${encodeURIComponent(userUUID)}}`;
      await chrome.tabs.update(tab.id, {url: prUrl});
      await waitForPageLoad(4000);  // Allow time for page load and filtering

      // Step 5: Extract PR data from all pages (handles pagination automatically)
      await extractAllPullRequests(tab.id);

    } catch (error) {
      console.error('Extraction error:', error);
      // Don't expose detailed error information to user
      let userMessage = 'An error occurred during extraction.';
      if (error.message.includes('UUID')) {
        userMessage = 'Unable to identify user. Please ensure you are logged in to Bitbucket.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        userMessage = 'Network error. Please check your connection and try again.';
      }
      showStatus(userMessage, 'error');
      extractButton.disabled = false;
    }
  });

  /**
   * Copy button handler - copies formatted timeline to clipboard
   */
  copyButton.addEventListener('click', function() {
    navigator.clipboard.writeText(extractedData).then(() => {
      showStatus('Copied to clipboard!', 'success');
      setTimeout(() => {
        hideStatus();
      }, 2000);
    });
  });

  /**
   * Extracts PRs from all pages in the Bitbucket PR list
   * Handles pagination automatically by detecting and navigating through pages
   * @param {number} tabId - Chrome tab ID where extraction occurs
   */
  async function extractAllPullRequests(tabId) {
    let pageCount = 1;
    let hasMorePages = true;

    // Loop through all pages of PR results
    while (hasMorePages) {
      try {
        showStatus(`Extracting pull requests from page ${pageCount}...`, 'loading');

        // Extract PR data from the current page using content script
        const response = await chrome.tabs.sendMessage(tabId, {action: 'extractPRs'});

        if (response && response.prs && response.prs.length > 0) {
          allPRs.push(...response.prs);  // Accumulate results from all pages
          showStatus(`Found ${response.prs.length} PRs on page ${pageCount}. Total: ${allPRs.length}`, 'loading');
        }

        // Check if pagination controls indicate more pages
        const nextPageResponse = await chrome.tabs.sendMessage(tabId, {action: 'hasNextPage'});

        if (nextPageResponse && nextPageResponse.hasNext) {
          // Navigate to next page and continue extraction
          await chrome.tabs.sendMessage(tabId, {action: 'goToNextPage'});
          await waitForPageLoad(3000); // Allow time for page navigation
          pageCount++;
        } else {
          hasMorePages = false;  // No more pages, exit loop
        }

        // Safety check to prevent infinite loops
        if (pageCount > 20) {
          showStatus('Stopped after 20 pages to prevent infinite loop', 'error');
          break;
        }

      } catch (error) {
        console.error('Error on page', pageCount, ':', error);
        hasMorePages = false;
      }
    }

    // Process and format the extracted data for display and clipboard
    if (allPRs.length > 0) {
      // Remove potential duplicates from overlapping pagination
      const uniquePRs = [...new Set(allPRs)];
      
      // Group timeline entries by date for cleaner formatting
      // This groups multiple entries on the same day together
      const groupedByDate = new Map();
      
      for (const entry of uniquePRs) {
        // Parse date from timeline entry format "(July 29) B, D: Title"
        const dateMatch = entry.match(/^\(([^)]+)\)/);
        if (dateMatch) {
          const date = dateMatch[1]; // Extract date string like "July 29"
          
          if (!groupedByDate.has(date)) {
            groupedByDate.set(date, []);
          }
          
          groupedByDate.get(date).push(entry);
        }
      }
  
      // Format grouped entries for better readability
      // Only show date prefix on first entry per day
      const dateGroups = [];
      for (const [date, entries] of groupedByDate) {
        const processedEntries = entries.map((entry, index) => {
          if (index === 0) {
            // Keep the first entry with date prefix: "(July 29) B, D: Title"
            return entry;
          } else {
            // Remove date from subsequent entries: "B, D: Title"
            return entry.replace(/^\([^)]+\)\s*/, '');
          }
        });
        
        // Join entries for same date with single newlines
        const groupText = processedEntries.join('\n');
        dateGroups.push(groupText);
      }
      
      // Join different date groups with double newlines
      extractedData = dateGroups.join('\n\n');
      
      results.textContent = extractedData;
      results.style.display = 'block';
      copyButton.classList.remove('hidden');
      showStatus(`Extraction complete! Found ${uniquePRs.length} pull requests for current month across ${pageCount} pages`, 'success');
    } else {
      showStatus('No pull requests found for current month', 'success');
      results.style.display = 'none';
      copyButton.classList.add('hidden');
    }

    extractButton.disabled = false;
  }

  /**
   * Utility function to wait for page loading/navigation
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise} - Resolves after specified time
   */
  function waitForPageLoad(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Updates the status display with message and styling
   * @param {string} message - Status message to display
   * @param {string} type - CSS class type: 'loading', 'success', 'error'
   */
  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
  }

  /**
   * Hides the status display
   */
  function hideStatus() {
    status.classList.add('hidden');
  }

  /**
   * Loads organization and project settings from Chrome storage
   * @returns {Promise<{organization: string, project: string}>} - Settings object
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['bitbucketOrganization', 'bitbucketProject'], function(result) {
        const defaultSettings = {
          organization: '',
          project: ''
        };
        
        if (chrome.runtime.lastError) {
          console.warn('Error loading settings:', chrome.runtime.lastError);
          resolve(defaultSettings);
          return;
        }

        const settings = {
          organization: result.bitbucketOrganization || defaultSettings.organization,
          project: result.bitbucketProject || defaultSettings.project
        };

        console.log('Loaded settings:', settings);
        resolve(settings);
      });
    });
  }
});
