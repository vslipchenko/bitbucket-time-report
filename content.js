// Content script for enhanced PR extraction and pagination handling
(function() {
  'use strict';

  // Store extracted data globally for the extension
  window.bitbucketPRExtractor = {
    extractedPRs: [],
    isExtracting: false,

    // Sanitize text to prevent XSS and remove potentially harmful content
    sanitizeText: function(text) {
      if (!text || typeof text !== 'string') {
        return '';
      }
      
      // Remove any HTML tags, scripts, and potentially dangerous characters
      return text
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/javascript:/gi, '') // Remove javascript: protocols
        .replace(/data:/gi, '') // Remove data: protocols
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .trim()
        .substring(0, 500); // Limit length to prevent DoS
    },

    /**
     * Detects the current user's UUID from the Bitbucket page
     * Uses multiple detection methods to find the user's unique identifier
     * Required for building the correct PR filter URL
     * @returns {string|null} - User UUID or null if not found
     */
    getCurrentUserUUID: function() {
      try {
        console.log('Starting UUID detection...');
        
        // Method 1: Extract UUID from JavaScript variables in page scripts
        // Bitbucket often embeds user data in JSON objects within script tags
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          // Only process inline scripts or scripts from Bitbucket domain for security
          if (!script.src || script.src.includes('bitbucket.org')) {
            const content = script.textContent;
            if (!content) continue;
            
            // Multiple regex patterns to catch different JSON structures containing UUID
            const patterns = [
              /"user":\s*{[^}]*"uuid":\s*"([a-f0-9-]{36})"/,  // {"user":{"uuid":"abc-123"}}
              /"uuid":\s*"([a-f0-9-]{36})"/,                   // {"uuid":"abc-123"}
              /window\.BB\s*=\s*{[^}]*user[^}]*uuid[^}]*"([a-f0-9-]{36})"/,  // window.BB global
              /"currentUser"[^}]*"uuid":\s*"([a-f0-9-]{36})"/  // {"currentUser":{"uuid":"abc-123"}}
            ];

            for (const pattern of patterns) {
              const match = content.match(pattern);
              // Validate UUID format (36 chars with hyphens)
              if (match && match[1] && match[1].match(/^[a-f0-9-]{36}$/)) {
                console.log('Found UUID via script pattern');
                return match[1];
              }
            }
          }
        }

        // Method 2: Look for UUID in HTML data attributes
        // Some Bitbucket pages store user info in data-* attributes
        const userElements = document.querySelectorAll('[data-user-uuid], [data-current-user-uuid]');
        for (const element of userElements) {
          const uuid = element.getAttribute('data-user-uuid') || element.getAttribute('data-current-user-uuid');
          if (uuid && uuid.match(/^[a-f0-9-]{36}$/)) {
            console.log('Found UUID via data attributes');
            return uuid;
          }
        }

        // Method 3: Extract UUID from profile/user links in the page
        // Avatar and profile links often contain the user UUID in the URL
        const profileLinks = document.querySelectorAll('a[href*="/users/"], a[href*="/profile/"]');
        for (const link of profileLinks) {
          const href = link.getAttribute('href');
          // Match URLs like /users/{uuid} or /profile/{uuid}
          const match = href.match(/\/(?:users|profile)\/([a-f0-9-]{36})/);
          if (match) {
            console.log('Found UUID via profile links');
            return match[1];
          }
        }

        // Method 4: Check Bitbucket's global JavaScript variables
        // Bitbucket may expose user data via window.BB global object
        if (typeof window.BB !== 'undefined' && window.BB.user && window.BB.user.uuid) {
          const uuid = window.BB.user.uuid;
          if (uuid && uuid.match(/^[a-f0-9-]{36}$/)) {
            console.log('Found UUID via global variables');
            return uuid;
          }
        }

        // Method 5: Check HTML meta tags for user information
        // Sometimes user data is embedded in meta tags
        const metaTags = document.querySelectorAll('meta[name*="user"], meta[property*="user"]');
        for (const meta of metaTags) {
          const content = meta.getAttribute('content');
          if (content && content.match(/^[a-f0-9-]{36}$/)) {
            console.log('Found UUID via meta tags');
            return content;
          }
        }

        console.log('No UUID found using any method');
        return null;
      } catch (error) {
        console.error('Error getting user UUID:', error);
        return null;
      }
    },

    /**
     * Extracts pull request data from the current Bitbucket page
     * Processes only PRs from the current month and generates timeline entries
     * Handles various Bitbucket UI layouts through multiple selector strategies
     * @returns {Array} - Array of formatted timeline entries with progress and done states
     */
    extractPRsFromCurrentPage: function() {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const rawPRs = []; // Store raw PR data with dates for timeline processing

      console.log(`Looking for PRs from ${currentYear}-${String(currentMonth).padStart(2, '0')}`);

      // Multiple CSS selectors to handle different Bitbucket UI versions and layouts
      // Bitbucket frequently changes their DOM structure, so we try multiple approaches
      const prSelectors = [
        '[data-testid="pullrequest-row"]',  // Modern React-based Bitbucket
        '.pull-request-row',                // Older UI versions
        '.pr-row',
        '.pullrequest-list-item',
        '.pr-list-item',
        'tr[id*="pullrequest"]',           // Table-based layouts
        '.pullrequest-table tr',
        '.pr-table tr',
        '[data-qa="pr-row"]',              // QA testing attributes
        'tr',                              // Generic table row fallback
        '.pullrequest',
        '[class*="pullrequest"]',          // Any class containing "pullrequest"
        '[class*="pr-"]'                   // Any class starting with "pr-"
      ];

      // Find PR rows using the first successful selector
      let prRows = [];
      for (const selector of prSelectors) {
        prRows = document.querySelectorAll(selector);
        if (prRows.length > 0) {
          console.log(`Found ${prRows.length} rows using selector: ${selector}`);
          break; // Use the first selector that finds results
        }
      }

      console.log(`Total rows found: ${prRows.length}`);

      // Process each PR row to extract title, date, and other metadata
      for (const row of prRows) {
        try {
          // Get all text content for debugging and fallback extraction
          const rowText = row.textContent.trim();
          console.log('Processing row:', rowText);

          // Extract PR title using multiple selector strategies
          // Different Bitbucket layouts structure titles differently
          const titleSelectors = [
            'a[data-testid="pullrequest-title"]',  // Modern Bitbucket
            '.pr-title a',                         // Standard PR title link
            '.pullrequest-title a',
            'a[href*="/pull-requests/"]',          // Any link to PR page
            '.pr-link',
            '.pullrequest-link',
            'a[href*="/pull-request/"]',           // Alternative PR URL format
            'a',                                   // Generic link fallback
            '[class*="title"]'                     // Any element with "title" in class
          ];

          let titleElement = null;
          for (const selector of titleSelectors) {
            titleElement = row.querySelector(selector);
            if (titleElement && titleElement.textContent.trim()) break;
          }

          if (!titleElement) {
            console.log('No title element found in row');
            continue;
          }

          const title = window.bitbucketPRExtractor.sanitizeText(titleElement.textContent.trim());
          console.log('Found title:', title);

          // Extract branch name
          let branchName = '';
          const branchSelectors = [
            '[data-testid="source-branch"]',
            '.pr-branch',
            '.pullrequest-branch',
            '.source-branch',
            '.branch-name'
          ];

          for (const selector of branchSelectors) {
            const branchElement = row.querySelector(selector);
            if (branchElement) {
              branchName = window.bitbucketPRExtractor.sanitizeText(branchElement.textContent.trim());
              break;
            }
          }

          // If no branch element found, try to extract from other sources
          if (!branchName) {
            // Look for branch info in text content
            const branchMatch = rowText.match(/from\s+([^\s]+)\s+to/i) ||
                               rowText.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
            if (branchMatch) {
              branchName = branchMatch[1];
            }
          }

          // Extract the merge/update date of the pull request
          // This is crucial for filtering PRs by month and ordering timeline
          let prDate = null;

          // Method 1: Look for structured date elements (preferred)
          // HTML time elements and data attributes usually contain ISO dates
          const dateSelectors = [
            'time',                              // HTML5 time element
            '[data-testid="pr-updated-on"]',     // Modern Bitbucket test ID
            '.pr-date',                          // Generic PR date class
            '.pullrequest-date',
            '.updated-date',
            '.merge-date'
          ];

          for (const selector of dateSelectors) {
            const dateElement = row.querySelector(selector);
            if (dateElement) {
              // Try multiple date sources: datetime attribute, title tooltip, or text content
              let dateText = dateElement.getAttribute('datetime') ||
                            dateElement.getAttribute('title') ||
                            dateElement.textContent.trim();

              const tempDate = new Date(dateText);
              if (!isNaN(tempDate.getTime())) {
                prDate = tempDate;
                console.log('Found date from element:', dateText, '-> parsed as:', prDate);
                break;
              }
            }
          }

          // Method 2: Extract date from text content using regex patterns (fallback)
          // When structured elements don't contain dates, parse from visible text
          if (!prDate) {
            const datePatterns = [
              /updated\s+(\d{4}-\d{2}-\d{2})/i,  // "updated 2025-07-08"
              /(\d{4}-\d{2}-\d{2})/,             // Direct ISO date format
              /(\d{1,2}\/\d{1,2}\/\d{4})/,       // American MM/DD/YYYY format
              /(\d{1,2}-\d{1,2}-\d{4})/,         // European DD-MM-YYYY format
              /on\s+(\d{4}-\d{2}-\d{2})/i,       // "merged on 2025-07-08"
              /(\d{2}\s+\w{3}\s+\d{4})/i,        // "08 Jul 2025" format
              /(\w{3}\s+\d{1,2},?\s+\d{4})/i     // "Jul 8, 2025" or "Jul 8 2025"
            ];

            for (const pattern of datePatterns) {
              const match = rowText.match(pattern);
              if (match) {
                const tempDate = new Date(match[1]);
                if (!isNaN(tempDate.getTime())) {
                  prDate = tempDate;
                  console.log('Found date from text pattern:', match[1], '-> parsed as:', prDate);
                  break;
                }
              }
            }
          }

          // Method 3: Parse relative dates like "3 days ago" (last resort)
          // Convert relative time expressions to absolute dates
          if (!prDate) {
            const relativePatterns = [
              /(\d+)\s+seconds?\s+ago/i,
              /(\d+)\s+minutes?\s+ago/i,
              /(\d+)\s+hours?\s+ago/i,
              /(\d+)\s+days?\s+ago/i,
              /(\d+)\s+weeks?\s+ago/i,
              /(\d+)\s+months?\s+ago/i
            ];

            for (const pattern of relativePatterns) {
              const match = rowText.match(pattern);
              if (match) {
                const now = new Date();
                const value = parseInt(match[1]);

                // Calculate absolute date based on relative time unit
                if (pattern.source.includes('second')) {
                  prDate = new Date(now.getTime() - (value * 1000));
                } else if (pattern.source.includes('minute')) {
                  prDate = new Date(now.getTime() - (value * 60 * 1000));
                } else if (pattern.source.includes('hour')) {
                  prDate = new Date(now.getTime() - (value * 60 * 60 * 1000));
                } else if (pattern.source.includes('day')) {
                  prDate = new Date(now.getTime() - (value * 24 * 60 * 60 * 1000));
                } else if (pattern.source.includes('week')) {
                  prDate = new Date(now.getTime() - (value * 7 * 24 * 60 * 60 * 1000));
                } else if (pattern.source.includes('month')) {
                  // Handle month calculation more carefully to avoid date issues
                  prDate = new Date(now.getFullYear(), now.getMonth() - value, now.getDate());
                }

                console.log('Found relative date:', match[0], '-> parsed as:', prDate);
                break;
              }
            }
          }

          if (!prDate) {
            console.log('No date found for row:', rowText.substring(0, 100));
            continue;
          }

          console.log(`PR Date: ${prDate.getFullYear()}-${prDate.getMonth() + 1}-${prDate.getDate()}, Looking for: ${currentYear}-${currentMonth}`);

          // Only process PRs from the current month/year
          if (prDate.getFullYear() === currentYear && prDate.getMonth() + 1 === currentMonth) {
            console.log(`Date matches! Processing PR for ${prDate.getFullYear()}-${String(prDate.getMonth() + 1).padStart(2, '0')}-${String(prDate.getDate()).padStart(2, '0')}`);

            // Classify PR as Feature (F) or Bug (B) based on title and branch name
            // Default to Feature unless bug-related keywords are found
            let type = 'F';
            const lowerTitle = title.toLowerCase();
            const lowerBranch = branchName.toLowerCase();

            // Keywords that indicate bug fixes or maintenance work
            const bugKeywords = ['bug', 'fix', 'hotfix', 'patch', 'defect', 'issue'];
            if (bugKeywords.some(keyword => lowerTitle.includes(keyword) || lowerBranch.includes(keyword))) {
              type = 'B';
            }

            // Extract ticket/issue ID from various sources
            // Ticket ID is used for grouping related work and tracking
            let ticketId = '';
            const ticketPatterns = [
              /([A-Z]+-\d+)/i,  // Standard JIRA format like DEP-123, ABC-456
              /([A-Z]+\d+)/i,   // Alternative format without hyphen like ABC123
              /#(\d+)/,         // GitHub-style hash format like #3518
              /(\d+)/           // Fallback: just numbers like 123
            ];

            // Priority order: branch name (most reliable) → title → full row text
            const sources = [branchName, title, rowText];
            for (const source of sources) {
              for (const pattern of ticketPatterns) {
                const match = source.match(pattern);
                if (match) {
                  ticketId = match[1];
                  break;
                }
              }
              if (ticketId) break; // Stop at first successful extraction
            }

            // Fallback when no ticket ID pattern is found
            if (!ticketId) {
              ticketId = 'NO-TICKET';
            }

            // Clean the title - keep all ticket IDs as they provide valuable context
            let cleanTitle = title;

            // Only remove ticket ID if it's truly redundant (appears exactly as "TICKET-ID: " at start with no other content)
            // This is very conservative - we want to preserve ticket information in most cases
            if (ticketId !== 'NO-TICKET') {
              // Only remove if the entire title is just "TICKET-ID: description" and we extracted the same ticket ID
              // This prevents over-cleaning while removing truly redundant cases
              const exactRedundantPattern = new RegExp(`^${ticketId}:\\s*(.+)$`, 'i');
              const match = cleanTitle.match(exactRedundantPattern);

              if (match && match[1] && match[1].trim().length > 0) {
                // Check if the remaining part doesn't contain any other ticket IDs
                const remainingPart = match[1].trim();
                if (!/[A-Z]+-\d+/i.test(remainingPart)) {
                  // Safe to clean - it's just "ABC-6025: Add Links to Assets"
                  // But let's actually keep it for consistency
                  cleanTitle = title; // Keep original title with ticket ID
                  console.log('Keeping ticket ID in title for context:', title);
                } else {
                  // Contains other ticket IDs, definitely keep original
                  cleanTitle = title;
                }
              } else {
                // Not a simple "TICKET: description" format, keep original
                cleanTitle = title;
              }
            }

            // Remove branch prefixes that might have been included in the title
            const branchPrefixPatterns = [
              /^feature\/[^:]*:\s*/i,     // "feature/something: "
              /^feat\/[^:]*:\s*/i,     // "feat/something: "
              /^bugfix\/[^:]*:\s*/i,      // "bugfix/something: "
              /^bug\/[^:]*:\s*/i,     // "bug/something: "
              /^hotfix\/[^:]*:\s*/i,      // "hotfix/something: "
              /^hot\/[^:]*:\s*/i,      // "hotfix/something: "
              /^fix\/[^:]*:\s*/i,         // "fix/something: "
              /^chore\/[^:]*:\s*/i,       // "chore/something: "
              /^feat\/[^:]*:\s*/i,        // "feat/something: "
              /^task\/[^:]*:\s*/i,        // "task/something: "
              /^[a-zA-Z]+\/[^:]*:\s*/     // Any "prefix/something: " pattern
            ];

            for (const pattern of branchPrefixPatterns) {
              cleanTitle = cleanTitle.replace(pattern, '');
            }

            // Clean up any remaining artifacts
            cleanTitle = cleanTitle.trim();

            // Ensure we have a meaningful title
            if (!cleanTitle || cleanTitle.length < 3) {
              // Fallback to original title if cleaning went too far
              cleanTitle = title;
              console.log('Cleaning removed too much, using original title:', title);
            }

            // Store raw PR data for later processing
            rawPRs.push({
              date: prDate,
              type: type,
              ticketId: ticketId,
              title: cleanTitle,
              dateString: prDate.toISOString().split('T')[0] // YYYY-MM-DD format
            });

            console.log('Added PR data:', {
              date: prDate.toISOString().split('T')[0],
              type: type,
              ticketId: ticketId,
              title: cleanTitle
            });
          } else {
            console.log('Date does not match current month/year');
          }
        } catch (error) {
          console.error('Error processing PR row:', error, row);
        }
      }

      // Sort PRs chronologically (oldest first) for timeline generation
      rawPRs.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Generate timeline entries with both "Progress" and "Done" states
      // This creates a detailed work log showing when tasks were worked on vs completed
      const results = [];

      // Timeline will contain both progress entries (P:) and completion entries (D:)
      const timeline = [];

      // Process each PR to generate timeline entries
      for (let i = 0; i < rawPRs.length; i++) {
        const currentPR = rawPRs[i];
        const previousPR = rawPRs[i - 1];

        // Generate progress entries for work days between PRs
        // This fills timeline gaps with "in progress" indicators
        if (previousPR) {
          const previousDate = new Date(previousPR.date);
          const currentDate = new Date(currentPR.date);

          // Calculate gap between this PR and the previous one
          // Use UTC dates to avoid timezone/DST issues affecting day calculations
          const previousDateUTC = new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate());
          const currentDateUTC = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
          const timeDiff = currentDateUTC.getTime() - previousDateUTC.getTime();
          const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
          
          console.log(`Date calculation debug:
            Previous: ${previousDate.toISOString()} -> UTC: ${previousDateUTC.toISOString()}
            Current: ${currentDate.toISOString()} -> UTC: ${currentDateUTC.toISOString()}
            Time diff: ${timeDiff}ms, Day diff: ${daysDiff}`);

          console.log(`Gap between ${previousPR.dateString} and ${currentPR.dateString}: ${daysDiff} days`);
          console.log(`Will generate progress entries for ticket: ${currentPR.ticketId}: ${currentPR.title}`);

          // Generate progress entries for work days between PRs (excluding weekends)
          // This creates "in progress" timeline entries for each work day between PR completions
          if (daysDiff > 1) {
            // Create progress entries for each day between previous and current PR (exclusive of endpoints)
            for (let day = 1; day < daysDiff; day++) {
              // Calculate intermediate date using UTC to avoid timezone/DST issues
              const progressDate = new Date(previousDateUTC.getTime() + (day * 24 * 60 * 60 * 1000));
              
              // Skip weekends since employees don't work on Saturday (6) or Sunday (0)
              const dayOfWeek = progressDate.getDay();
              console.log(`Checking progress date: ${progressDate.toISOString().split('T')[0]} = ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}`);
              if (dayOfWeek === 0 || dayOfWeek === 6) {
                console.log(`Skipping weekend date: ${progressDate.toISOString().split('T')[0]} (${dayOfWeek === 0 ? 'Sunday' : 'Saturday'})`);
                continue;
              }
              
              const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                               'July', 'August', 'September', 'October', 'November', 'December'];
              const monthName = monthNames[progressDate.getMonth()];
              const dayNum = progressDate.getDate();

              timeline.push({
                date: progressDate,
                entry: `(${monthName} ${dayNum}) ${currentPR.type}, P: ${currentPR.title}`,
                dateString: progressDate.toISOString().split('T')[0]
              });
              console.log(`Added progress entry for ${progressDate.toISOString().split('T')[0]}: (${monthName} ${dayNum}) ${currentPR.type}, P: ${currentPR.title}`);
            }
          }
        }

        // Add the done entry for the current PR (skip if it's a weekend)
        const dayOfWeek = currentPR.date.getDay();
        console.log(`Processing done entry for ${currentPR.dateString}: dayOfWeek=${dayOfWeek} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
        
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends (Saturday = 6, Sunday = 0)
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
          const monthName = monthNames[currentPR.date.getMonth()];
          const dayNum = currentPR.date.getDate();

          timeline.push({
            date: currentPR.date,
            entry: `(${monthName} ${dayNum}) ${currentPR.type}, D: ${currentPR.title}`,
            dateString: currentPR.dateString
          });
          console.log(`Added done entry for ${currentPR.dateString}: (${monthName} ${dayNum}) ${currentPR.type}, D: ${currentPR.title}`);
        } else {
          console.log(`Skipping weekend done entry for ${currentPR.dateString} (${dayOfWeek === 0 ? 'Sunday' : 'Saturday'})`);
        }
      }

      // Sort timeline by date - NEWER TO OLDER (descending order as requested)
      timeline.sort((a, b) => b.date.getTime() - a.date.getTime());

      // Extract just the entries in chronological order (newest first)
      for (const item of timeline) {
        results.push(item.entry);
        console.log(`Timeline entry: ${item.dateString} - ${item.entry}`);
      }

      console.log(`Final results: ${results.length} entries generated from ${rawPRs.length} PRs`);
      return results;
    },

    /**
     * Detects if there are more pages of PR results to process
     * Searches for pagination "Next" buttons using multiple selectors
     * @returns {Element|null} - Next button element if found, null otherwise
     */
    hasNextPage: function() {
      const nextSelectors = [
        'a[data-testid="next-page"]',  // Modern Bitbucket pagination
        '.next-page',                  // Standard pagination class
        '.pagination-next',
        'a[aria-label="Next"]',        // Accessibility-friendly pagination
        'a[title="Next"]'              // Tooltip-based pagination
      ];

      for (const selector of nextSelectors) {
        const nextButton = document.querySelector(selector);
        // Check if button exists and is clickable (not disabled)
        if (nextButton && !nextButton.disabled && !nextButton.classList.contains('disabled')) {
          return nextButton;
        }
      }
      return null;
    },

    /**
     * Navigates to the next page of PR results
     * @returns {boolean} - true if navigation occurred, false if no next page
     */
    goToNextPage: function() {
      const nextButton = this.hasNextPage();
      if (nextButton) {
        nextButton.click();
        return true;
      }
      return false;
    }
  };

  /**
   * Message handler for communication with popup UI
   * Provides secure API for popup to interact with page content
   * Supports: UUID detection, PR extraction, pagination control
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Security: Validate message structure (allow messages from both popup and tabs)
    if (!request || typeof request.action !== 'string') {
      console.warn('Invalid message received - missing action');
      return false;
    }

    // Additional security: ensure sender is from our extension
    if (!sender.id || sender.id !== chrome.runtime.id) {
      console.warn('Invalid message received - unauthorized sender');
      return false;
    }

    // Security: Whitelist allowed actions to prevent unauthorized calls
    const allowedActions = ['getUserUUID', 'extractPRs', 'hasNextPage', 'goToNextPage'];
    if (!allowedActions.includes(request.action)) {
      console.warn('Unknown action requested:', request.action);
      return false;
    }

    try {
      // Route message to appropriate handler function
      switch (request.action) {
        case 'getUserUUID':
          // Get user's UUID for building filtered PR URLs
          const uuid = window.bitbucketPRExtractor.getCurrentUserUUID();
          sendResponse({uuid: uuid});
          break;
        case 'extractPRs':
          // Extract and process PR data from current page
          const prs = window.bitbucketPRExtractor.extractPRsFromCurrentPage();
          sendResponse({prs: prs});
          break;
        case 'hasNextPage':
          // Check if more pages exist for pagination
          const hasNext = !!window.bitbucketPRExtractor.hasNextPage();
          sendResponse({hasNext: hasNext});
          break;
        case 'goToNextPage':
          // Navigate to next page of results
          const navigated = window.bitbucketPRExtractor.goToNextPage();
          sendResponse({navigated: navigated});
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({error: 'Internal error occurred'});
    }
    
    return true; // Keep message channel open for async response
  });

})();
