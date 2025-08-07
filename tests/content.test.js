/**
 * Jest unit tests for content.js - Bitbucket Time Report Extension
 */

// Import the content script logic (we'll need to extract functions for testing)
// For now, we'll recreate the key functions as testable units

describe('Bitbucket PR Extractor', () => {
  let bitbucketPRExtractor;
  
  beforeEach(() => {
    // Reset the extractor before each test
    bitbucketPRExtractor = {
      sanitizeText: function(text) {
        if (!text || typeof text !== 'string') {
          return '';
        }
        
        return text
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/javascript:/gi, '') // Remove javascript: protocols
          .replace(/data:/gi, '') // Remove data: protocols
          .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
          .trim()
          .substring(0, 500); // Limit length to prevent DoS
      },
      
      extractDateFromText: function(rowText, currentYear, currentMonth) {
        const allDatesInText = [];
        
        // STEP 1: Extract relative dates first (they have high priority)
        const relativePatterns = [
          /(\d+)\s+days?\s+ago/g,
          /(\d+)\s+weeks?\s+ago/g,
          /(\d+)\s+months?\s+ago/g
        ];
        
        for (const pattern of relativePatterns) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(rowText)) !== null) {
            const now = new Date();
            const value = parseInt(match[1]);
            let calculatedDate = null;

            if (pattern.source.includes('day')) {
              calculatedDate = new Date(now.getTime() - (value * 24 * 60 * 60 * 1000));
            } else if (pattern.source.includes('week')) {
              calculatedDate = new Date(now.getTime() - (value * 7 * 24 * 60 * 60 * 1000));
            } else if (pattern.source.includes('month')) {
              calculatedDate = new Date(now.getFullYear(), now.getMonth() - value, now.getDate());
            }

            if (calculatedDate) {
              allDatesInText.push({
                date: calculatedDate,
                dateString: `${match[1]} ${match[0].includes('day') ? 'days' : match[0].includes('week') ? 'weeks' : 'months'} ago (${calculatedDate.toISOString().split('T')[0]})`,
                context: rowText.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20),
                isRelative: true,
                priority: 90,
                dateType: 'relative'
              });
            }
          }
        }
        
        // STEP 2: Find ALL absolute date patterns first
        const datePatterns = [
          /(\d{4}-\d{2}-\d{2})/g,                    // 2025-08-10
          /(\d{1,2}\/\d{1,2}\/\d{4})/g,              // 08/10/2025
          /(\d{1,2}-\d{1,2}-\d{4})/g,                // 08-10-2025
          /(\w{3}\s+\d{1,2},?\s+\d{4})/g,           // Aug 10, 2025
          /(\d{1,2}\s+\w{3}\s+\d{4})/g              // 10 Aug 2025
        ];
        
        const foundDates = [];
        for (const pattern of datePatterns) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(rowText)) !== null) {
            const tempDate = new Date(match[1]);
            if (!isNaN(tempDate.getTime())) {
              foundDates.push({
                dateString: match[1],
                date: tempDate,
                index: match.index,
                fullMatch: match[0]
              });
            }
          }
        }
        
        // STEP 3: Classify each found date based on context and prioritize
        for (const foundDate of foundDates) {
          // Use a smaller context window focused on words immediately before the date
          const contextStart = Math.max(0, foundDate.index - 15);
          const contextEnd = foundDate.index + foundDate.fullMatch.length + 5;
          const context = rowText.substring(contextStart, contextEnd);
          const contextLower = context.toLowerCase();
          
          let priority = 0;
          let dateType = 'unknown';
          
          // Check for merge context with highest priority
          if (contextLower.includes('merged') || contextLower.includes('merge')) {
            priority = 100;
            dateType = 'merge';
          } else if (contextLower.includes('approved') || contextLower.includes('approval')) {
            priority = 1;
            dateType = 'approval';
          } else if (contextLower.includes('created') || contextLower.includes('updated')) {
            priority = 2;
            dateType = 'creation/update';
          } else {
            priority = 50;
            dateType = 'unclear';
          }
          
          allDatesInText.push({
            date: foundDate.date,
            dateString: foundDate.dateString,
            context: context,
            isRelative: false,
            priority: priority,
            dateType: dateType
          });
        }
        
        // STEP 4: Filter to current month and select best date
        const currentMonthDates = allDatesInText.filter(d => 
          d.date.getFullYear() === currentYear && d.date.getMonth() + 1 === currentMonth
        );
        
        if (currentMonthDates.length > 0) {
          currentMonthDates.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.isRelative !== b.isRelative) return a.isRelative ? -1 : 1;
            return b.date.getTime() - a.date.getTime();
          });
          
          return currentMonthDates[0];
        }
        
        return null;
      },
      
      classifyPR: function(title, branchName) {
        let type = 'F'; // Default to Feature
        const lowerTitle = title.toLowerCase();
        const lowerBranch = branchName.toLowerCase();
        const bugKeywords = ['bug', 'fix', 'hotfix', 'patch', 'defect', 'issue'];
        
        if (bugKeywords.some(keyword => lowerTitle.includes(keyword) || lowerBranch.includes(keyword))) {
          type = 'B';
        }
        
        return type;
      },
      
      generateTimeline: function(rawPRs) {
        if (!rawPRs || rawPRs.length === 0) return [];
        
        // Sort PRs chronologically (oldest first)
        rawPRs.sort((a, b) => a.date.getTime() - b.date.getTime());
        
        const timeline = [];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        for (let i = 0; i < rawPRs.length; i++) {
          const currentPR = rawPRs[i];
          const previousPR = rawPRs[i - 1];
          
          // For first PR, generate progress entries from month start
          if (i === 0) {
            const currentDate = new Date(currentPR.date);
            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const daysDiff = Math.floor((currentDate.getTime() - monthStart.getTime()) / (1000 * 3600 * 24));
            
            for (let day = 0; day < daysDiff; day++) {
              const progressDate = new Date(monthStart.getTime() + (day * 24 * 60 * 60 * 1000));
              const dayOfWeek = progressDate.getDay();
              
              if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
                const monthName = monthNames[progressDate.getMonth()];
                const dayNum = progressDate.getDate();
                const dayName = dayNames[progressDate.getDay()];
                
                timeline.push({
                  date: progressDate,
                  entry: `(${monthName} ${dayNum}, ${dayName}) ${currentPR.type}, P: ${currentPR.title}`,
                  dateString: progressDate.toISOString().split('T')[0]
                });
              }
            }
          }
          
          // Generate progress entries between PRs
          if (previousPR) {
            const timeDiff = currentPR.date.getTime() - previousPR.date.getTime();
            const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
            
            for (let day = 1; day < daysDiff; day++) {
              const progressDate = new Date(previousPR.date.getTime() + (day * 24 * 60 * 60 * 1000));
              const dayOfWeek = progressDate.getDay();
              
              if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
                const monthName = monthNames[progressDate.getMonth()];
                const dayNum = progressDate.getDate();
                const dayName = dayNames[progressDate.getDay()];
                
                timeline.push({
                  date: progressDate,
                  entry: `(${monthName} ${dayNum}, ${dayName}) ${currentPR.type}, P: ${currentPR.title}`,
                  dateString: progressDate.toISOString().split('T')[0]
                });
              }
            }
          }
          
          // Add done entry for current PR (skip weekends)
          const dayOfWeek = currentPR.date.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            const monthName = monthNames[currentPR.date.getMonth()];
            const dayNum = currentPR.date.getDate();
            const dayName = dayNames[currentPR.date.getDay()];
            
            timeline.push({
              date: currentPR.date,
              entry: `(${monthName} ${dayNum}, ${dayName}) ${currentPR.type}, D: ${currentPR.title}`,
              dateString: currentPR.dateString
            });
          }
        }
        
        // Sort timeline newest to oldest
        timeline.sort((a, b) => b.date.getTime() - a.date.getTime());
        
        return timeline.map(item => item.entry);
      }
    };
  });

  describe('sanitizeText', () => {
    test('should remove HTML tags', () => {
      const input = '<script>alert("xss")</script>Normal text<div>more</div>';
      const result = bitbucketPRExtractor.sanitizeText(input);
      expect(result).toBe('alert("xss")Normal textmore');
    });

    test('should remove javascript: protocols', () => {
      const input = 'javascript:alert("xss") Normal text';
      const result = bitbucketPRExtractor.sanitizeText(input);
      expect(result).toBe('alert("xss") Normal text');
    });

    test('should remove data: protocols', () => {
      const input = 'data:text/html,<script>alert("xss")</script> Normal text';
      const result = bitbucketPRExtractor.sanitizeText(input);
      expect(result).toBe('text/html,alert("xss") Normal text');
    });

    test('should handle null and undefined inputs', () => {
      expect(bitbucketPRExtractor.sanitizeText(null)).toBe('');
      expect(bitbucketPRExtractor.sanitizeText(undefined)).toBe('');
      expect(bitbucketPRExtractor.sanitizeText('')).toBe('');
    });

    test('should limit text length to 500 characters', () => {
      const longText = 'a'.repeat(1000);
      const result = bitbucketPRExtractor.sanitizeText(longText);
      expect(result.length).toBe(500);
    });
  });

  describe('extractDateFromText', () => {
    beforeEach(() => {
      // Mock current date as August 15, 2025
      mockDate('2025-08-15T10:00:00Z');
    });

    test('should extract explicit merge date with highest priority', () => {
      const rowText = 'DEP-6001: Test PR merged 2025-08-10 approved 2025-08-09';
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeTruthy();
      expect(result.dateString).toBe('2025-08-10');
      expect(result.dateType).toBe('merge');
      expect(result.priority).toBe(100);
    });

    test('should extract relative date and calculate correctly', () => {
      const rowText = 'DEP-6002: Test PR updated 5 days ago approved 2025-08-09';
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeTruthy();
      expect(result.isRelative).toBe(true);
      expect(result.dateType).toBe('relative');
      expect(result.priority).toBe(90);
      // 5 days ago from 2025-08-15 should be 2025-08-10
      expect(result.date.toISOString().split('T')[0]).toBe('2025-08-10');
    });

    test('should prioritize merge date over approval date', () => {
      const rowText = 'DEP-6003: Test PR Viktor approved 2025-08-12 merged 2025-08-11';
      
      // Test the extraction step by step
      const allDatesInText = [];
      
      // Test merge pattern directly
      const mergePattern = /merged\s+(\d{4}-\d{2}-\d{2})/gi;
      const mergeMatch = mergePattern.exec(rowText);
      if (mergeMatch) {
        allDatesInText.push({
          date: new Date(mergeMatch[1]),
          dateString: mergeMatch[1],
          context: 'merged context',
          isRelative: false,
          priority: 100,
          dateType: 'merge'
        });
      }
      
      expect(allDatesInText.length).toBe(1);
      expect(allDatesInText[0].dateString).toBe('2025-08-11');
      expect(allDatesInText[0].dateType).toBe('merge');
      
      // Now test the actual function
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeTruthy();
      expect(result.dateString).toBe('2025-08-11');
      expect(result.dateType).toBe('merge');
      expect(result.priority).toBe(100);
    });

    test('should prioritize relative date over approval date when no merge date', () => {
      const rowText = 'DEP-6004: Test PR Viktor approved 2025-08-12 Alex approved 2025-08-11 3 days ago';
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeTruthy();
      expect(result.isRelative).toBe(true);
      expect(result.priority).toBe(90);
      expect(result.date.toISOString().split('T')[0]).toBe('2025-08-12'); // 3 days ago from Aug 15
    });

    test('should filter out dates from other months', () => {
      const rowText = 'DEP-6005: Test PR merged 2025-07-31 approved 2025-07-30';
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeNull();
    });

    test('should handle various date formats', () => {
      const testCases = [
        {
          text: 'merged on Aug 10, 2025',
          expected: 'Aug 10, 2025',
          priority: 100
        },
        {
          text: 'merged 08/10/2025',
          expected: '08/10/2025', 
          priority: 100
        },
        {
          text: 'updated 2025-08-10',
          expected: '2025-08-10',
          priority: 2
        }
      ];

      testCases.forEach(({ text, expected, priority }) => {
        const result = bitbucketPRExtractor.extractDateFromText(text, 2025, 8);
        expect(result).toBeTruthy();
        expect(result.dateString).toBe(expected);
        expect(result.priority).toBe(priority);
      });
    });

    test('should return null when no valid dates found', () => {
      const rowText = 'DEP-6006: Test PR with no valid dates some text here';
      const result = bitbucketPRExtractor.extractDateFromText(rowText, 2025, 8);
      
      expect(result).toBeNull();
    });
  });

  describe('classifyPR', () => {
    test('should classify as Bug when title contains bug keywords', () => {
      const testCases = [
        'Fix authentication bug',
        'Hotfix for login issue',
        'Patch security defect',
        'Resolve critical issue'
      ];

      testCases.forEach(title => {
        const result = bitbucketPRExtractor.classifyPR(title, 'feature/test');
        expect(result).toBe('B');
      });
    });

    test('should classify as Bug when branch contains bug keywords', () => {
      const testCases = [
        'bugfix/auth-issue',
        'hotfix/security-patch',
        'fix/login-bug'
      ];

      testCases.forEach(branch => {
        const result = bitbucketPRExtractor.classifyPR('Add new feature', branch);
        expect(result).toBe('B');
      });
    });

    test('should classify as Feature by default', () => {
      const result = bitbucketPRExtractor.classifyPR('Add new dashboard', 'feature/dashboard');
      expect(result).toBe('F');
    });

    test('should prioritize title keywords over branch', () => {
      const result = bitbucketPRExtractor.classifyPR('Fix critical bug', 'feature/something');
      expect(result).toBe('B');
    });

    test('should be case insensitive', () => {
      expect(bitbucketPRExtractor.classifyPR('FIX Critical BUG', 'FEATURE/test')).toBe('B');
      expect(bitbucketPRExtractor.classifyPR('Add feature', 'BUGFIX/test')).toBe('B');
    });
  });

  describe('generateTimeline', () => {
    beforeEach(() => {
      mockDate('2025-08-15T10:00:00Z');
    });

    test('should generate timeline for single PR', () => {
      const rawPRs = [{
        date: new Date('2025-08-05'),
        dateString: '2025-08-05',
        type: 'F',
        title: 'Add dashboard',
        ticketId: 'DEP-6001'
      }];

      const timeline = bitbucketPRExtractor.generateTimeline(rawPRs);
      
      // Should have progress entries from Aug 1-4 (skipping weekend Aug 2-3) + done entry Aug 5
      expect(timeline.length).toBeGreaterThan(0);
      
      // Check for done entry
      expect(timeline.some(entry => entry.includes('August 5') && entry.includes('D:'))).toBe(true);
      
      // Check for progress entries
      expect(timeline.some(entry => entry.includes('P:'))).toBe(true);
      
      // Verify descending order (newest first)
      const dates = timeline.map(entry => {
        const match = entry.match(/\((\w+ \d+),/);
        return match ? match[1] : '';
      });
      
      // First entry should be latest date
      expect(dates[0]).toContain('August 5');
    });

    test('should generate timeline for multiple PRs', () => {
      const rawPRs = [
        {
          date: new Date('2025-08-05'),
          dateString: '2025-08-05',
          type: 'B',
          title: 'Fix auth bug',
          ticketId: 'DEP-6001'
        },
        {
          date: new Date('2025-08-10'),
          dateString: '2025-08-10',
          type: 'F',
          title: 'Add dashboard',
          ticketId: 'DEP-6002'
        }
      ];

      const timeline = bitbucketPRExtractor.generateTimeline(rawPRs);
      
      // Should have entries for both PRs
      expect(timeline.some(entry => entry.includes('Fix auth bug') && entry.includes('D:'))).toBe(true);
      expect(timeline.some(entry => entry.includes('Add dashboard') && entry.includes('D:'))).toBe(true);
      
      // Should have progress entries between PRs
      expect(timeline.some(entry => entry.includes('Add dashboard') && entry.includes('P:'))).toBe(true);
    });

    test('should skip weekend dates', () => {
      const rawPRs = [{
        date: new Date('2025-08-04'), // Monday
        dateString: '2025-08-04',
        type: 'F',
        title: 'Test feature',
        ticketId: 'DEP-6001'
      }];

      const timeline = bitbucketPRExtractor.generateTimeline(rawPRs);
      
      // Should not have entries for Saturday (Aug 2) or Sunday (Aug 3)
      expect(timeline.some(entry => entry.includes('August 2'))).toBe(false);
      expect(timeline.some(entry => entry.includes('August 3'))).toBe(false);
      
      // Should have entry for Friday (Aug 1) and Monday (Aug 4)
      expect(timeline.some(entry => entry.includes('August 1'))).toBe(true);
      expect(timeline.some(entry => entry.includes('August 4'))).toBe(true);
    });

    test('should handle empty PR array', () => {
      const timeline = bitbucketPRExtractor.generateTimeline([]);
      expect(timeline).toEqual([]);
    });

    test('should handle null/undefined input', () => {
      expect(bitbucketPRExtractor.generateTimeline(null)).toEqual([]);
      expect(bitbucketPRExtractor.generateTimeline(undefined)).toEqual([]);
    });

    test('should format entries correctly', () => {
      const rawPRs = [{
        date: new Date('2025-08-05'), // Tuesday
        dateString: '2025-08-05',
        type: 'B',
        title: 'Fix login bug',
        ticketId: 'DEP-6001'
      }];

      const timeline = bitbucketPRExtractor.generateTimeline(rawPRs);
      
      // Find the done entry
      const doneEntry = timeline.find(entry => entry.includes('D:'));
      expect(doneEntry).toMatch(/^\(August \d+, \w+\) [FB], D: .+$/);
      
      // Find a progress entry
      const progressEntry = timeline.find(entry => entry.includes('P:'));
      expect(progressEntry).toMatch(/^\(August \d+, \w+\) [FB], P: .+$/);
    });

    test('should sort timeline in descending order by date', () => {
      const rawPRs = [
        {
          date: new Date('2025-08-01'),
          dateString: '2025-08-01',
          type: 'F',
          title: 'First PR',
          ticketId: 'DEP-6001'
        },
        {
          date: new Date('2025-08-05'),
          dateString: '2025-08-05',
          type: 'B',
          title: 'Second PR',
          ticketId: 'DEP-6002'
        }
      ];

      const timeline = bitbucketPRExtractor.generateTimeline(rawPRs);
      
      // Extract dates from timeline entries
      const timelineDates = timeline.map(entry => {
        const match = entry.match(/\((\w+ \d+),/);
        if (match) {
          const [, dateStr] = match;
          const [month, day] = dateStr.split(' ');
          return parseInt(day);
        }
        return 0;
      });
      
      // Should be in descending order (latest dates first)
      for (let i = 0; i < timelineDates.length - 1; i++) {
        expect(timelineDates[i]).toBeGreaterThanOrEqual(timelineDates[i + 1]);
      }
    });
  });
});
